/*
 * Lives em segundo plano (Twitch e Kick, ver spike/domain/streams.ts): cada perfil pode ter UMA conta de cada plataforma, com sessão
 * própria (`persist:pokehubtw-<id>` / `persist:pokehubkk-<id>`), separada do jogo. O que muda entre as plataformas vem do `PlatformSpec`.
 * Twitch:
 * Com o canal definido e a conta logada, uma janela oculta abre o canal mudo e em 160p, sem limitar timers em segundo plano, para
 * a Twitch contar o tempo assistido. A cada 10–60 s um script no mundo isolado lê o saldo de pontos e se a live está no ar.
 * O que o PokéHub clica na Twitch (e nada além): o baú de bônus (só com "Coletar baú" ligado na conta), o play do player se ele
 * parou com a live no ar e o botão do saldo ao pedir "Recompensas". Resgatar uma recompensa é sempre do usuário, na janela à vista.
 * Nenhuma senha passa pelo PokéHub: o login é feito pelo usuário na página da Twitch.
 */
import { BrowserWindow, session as electronSession, type Session, type WebContents } from 'electron';
import type { TwitchAccount, TwitchInfo, TwitchState } from '../contracts/twitch';
import { OFFLINE_RECHECK_MS, OFFLINE_RELOAD_MS, OFFLINE_SLEEP_MS, probeDelay, parseBalance, RESUME_SCRIPT, sanitizeProbe, stateOf, TWITCH_STAGGER_MS, TWITCH_START_DELAY_MS, twitchRequestAllowed, type TwitchProbe } from '../domain/twitch';
import type { PlatformSpec } from '../domain/streams';
import { streamPartitionFor } from './partition';
import { lockSession, SAFE_DIALOGS } from './runtime-guards';
import { clearAllSessionData } from './partition-wipe';
import type { TwitchLink, TwitchStore } from './twitch-store';

const SCRIPT_TIMEOUT_MS = 6_000;
const RETRY_MS = 60_000;
const LOGIN_RE = /^[a-z0-9_-]{3,25}$/;

interface Runner {
  id: string;
  win: BrowserWindow | null;
  login: string | null;
  probe: TwitchProbe | null;
  failed: boolean;
  balance: number | null;
  earned: number;
  claimed: number;
  since: string | null;
  offlineSince: number | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  probing: boolean;
  state: TwitchState;
  /** banda limitada aplicada (janela escondida da plataforma com `throttleKbps`) */
  throttled: boolean;
  /** chave do CSS que esconde o chat (aplicado só com a janela escondida) */
  cssKey: string | null;
  /** live fora do ar há muito tempo: janela fechada para liberar memória; acorda em `wake` */
  sleeping: boolean;
  wake: ReturnType<typeof setTimeout> | undefined;
  reloadedOffline: boolean;
}
export interface TwitchDeps {
  platform: PlatformSpec;
  store: TwitchStore;
  /** Perfis existentes (id e nome mostrado no título da janela). */
  profiles: () => {id: string; label: string}[];
  iconPath: string;
  devTools: boolean;
  /** Lista nova para a interface (já com debounce aqui dentro). */
  emit: (info: TwitchInfo) => void;
  /** Enfileira o apagamento da pasta da sessão da Twitch no próximo início. */
  wipe: (profileId: string) => void;
  /** O app está saindo: fechar a janela da Twitch fecha de verdade (senão ela só se esconde). */
  quitting: () => boolean;
}

const withTimeout = <T>(promise: Promise<T>, ms = SCRIPT_TIMEOUT_MS) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise,new Promise<never>((_resolve,reject) => { timer = setTimeout(() => reject(new Error('timeout')),ms); })]).finally(() => clearTimeout(timer));
};
const run = (contents: WebContents, code: string) => withTimeout(contents.executeJavaScriptInIsolatedWorld(999,[{code}]) as Promise<unknown>);

export function createTwitchService(deps: TwitchDeps) {
  const spec = deps.platform;
  const partition = (id: string) => streamPartitionFor(spec.partitionPrefix as 'pokehubtw-' | 'pokehubkk-', id);
  const runners = new Map<string, Runner>();
  const prepared = new WeakSet<Session>();
  let disposed = false;
  const startTimers = new Set<ReturnType<typeof setTimeout>>();
  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '';

  const known = (id: unknown): id is string => typeof id === 'string' && deps.profiles().some(profile => profile.id === id);
  const labelOf = (id: string) => deps.profiles().find(profile => profile.id === id)?.label ?? 'Conta';
  const runnerOf = (id: string): Runner => {
    let runner = runners.get(id);
    if (!runner) { runner = {id, win:null, login:null, probe:null, failed:false, balance:null, earned:0, claimed:0, since:null, offlineSince:null, timer:undefined, retry:undefined, probing:false, state:'starting', throttled:false, cssKey:null, sleeping:false, wake:undefined, reloadedOffline:false}; runners.set(id,runner); }
    return runner;
  };
  const alive = (runner: Runner): runner is Runner & {win: BrowserWindow} => Boolean(runner.win && !runner.win.isDestroyed() && !runner.win.webContents.isDestroyed());
  /** A mesma conta da Twitch já está em um perfil vinculado antes deste: só o primeiro assiste (uma conta da Twitch por conta do jogo). */
  const duplicateOf = (runner: Runner) => {
    if (!runner.login) return false;
    const links = deps.store.list(), mine = links.findIndex(link => link.profileId === runner.id);
    return links.some((link,index) => index < mine && link.enabled && runners.get(link.profileId)?.login === runner.login); // perfil pausado não bloqueia
  };
  const currentState = (runner: Runner, link: TwitchLink | null) => stateOf({enabled:link?.enabled === true, channel:deps.store.channel(), login:runner.login, duplicate:duplicateOf(runner), failed:runner.failed, probe:runner.probe});

  function accountOf(link: TwitchLink, channel: string): TwitchAccount {
    const runner = runnerOf(link.profileId);
    const state = stateOf({enabled:link.enabled, channel, login:runner.login, duplicate:duplicateOf(runner), failed:runner.failed, probe:runner.probe});
    if (state === 'duplicate' && alive(runner) && !runner.win.isVisible()) queueMicrotask(() => close(link.profileId)); // a mesma conta não assiste duas vezes
    if (state === 'watching' && runner.state !== 'watching') runner.since = new Date().toISOString();
    if (state !== 'watching') runner.since = null;
    runner.state = state;
    return {profileId:link.profileId, enabled:link.enabled, autoClaim:link.autoClaim, sound:link.sound, login:runner.login, state, balance:runner.balance, earned:runner.earned, claimed:runner.claimed, since:runner.since, visible:alive(runner) && runner.win.isVisible()};
  }
  function info(): TwitchInfo {
    const channel = deps.store.channel();
    const ids = new Set(deps.profiles().map(profile => profile.id));
    return {platform:spec.id, channel, accounts:deps.store.list().filter(link => ids.has(link.profileId)).map(link => accountOf(link,channel))};
  }
  /** Avisa a interface no máximo a cada 250 ms e só quando algo mudou. */
  function changed() {
    if (disposed || emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = undefined;
      try { const next = info(); const signature = JSON.stringify(next); if (signature !== lastSignature) { lastSignature = signature; deps.emit(next); } } catch { /* banco fechando */ }
    },250);
  }

  // Sessão da plataforma: sem downloads e sem permissões; rede só https/wss; sem o "Electron" no user agent (o Cloudflare da Kick o barra).
  function prepare(id: string): Session {
    const browserSession = electronSession.fromPartition(partition(id));
    if (prepared.has(browserSession)) return browserSession;
    prepared.add(browserSession);
    lockSession(browserSession);
    try { browserSession.setUserAgent(browserSession.getUserAgent().replace(/\s(Electron|PokeHub|pokehub-spike)\/\S+/gi,'')); } catch { /* segue com o padrão */ }
    browserSession.webRequest.onBeforeRequest((details,callback) => { try { callback({cancel:!twitchRequestAllowed(details.url)}); } catch { callback({cancel:true}); } });
    // entrar/sair muda vários cookies em sequência: uma releitura só, 600 ms depois da última mudança
    let cookieTimer: ReturnType<typeof setTimeout> | undefined;
    browserSession.cookies.on('changed',(_event,cookie) => {
      if (!spec.tokenCookies.includes(cookie.name) && cookie.name !== spec.nameCookie) return;
      clearTimeout(cookieTimer);
      cookieTimer = setTimeout(() => { if (!disposed) void readLogin(id).then(() => afterLogin(id)); },600);
    });
    return browserSession;
  }
  async function readLogin(id: string): Promise<string | null> {
    if (disposed || !deps.store.get(id)) return null; // desvinculado: nada a ler
    const runner = runnerOf(id);
    try {
      const browserSession = prepare(id);
      const tokens = await Promise.all(spec.tokenCookies.map(name => browserSession.cookies.get({url:spec.cookieUrl,name})));
      const logged = tokens.some(list => list.length > 0);
      const login = logged && spec.nameCookie ? await browserSession.cookies.get({url:spec.cookieUrl,name:spec.nameCookie}) : [];
      const name = logged ? decodeURIComponent(login[0]?.value ?? '').toLowerCase() : '';
      // sem cookie confiável (Kick): vale o nome que a página mostrou no menu da conta
      runner.login = logged ? (LOGIN_RE.test(name) ? name : runner.probe?.user ?? 'conta') : spec.loginByProbe && runner.probe?.user && !runner.probe.loggedOut ? runner.probe.user : null;
    } catch { runner.login = null; }
    changed();
    return runner.login;
  }
  /** Ação do usuário (canal, ligar/desligar, Ver): acorda uma conta que estava dormindo com a live fora do ar. */
  const wakeNow = (id: string) => { const runner = runners.get(id); if (runner?.sleeping) { runner.sleeping = false; clearTimeout(runner.wake); runner.probe = null; runner.offlineSince = null; } };
  /** Entrou (ou saiu) na plataforma: com tudo certo, a janela vai para o canal; sem login, fica na página de entrada. */
  function afterLogin(id: string) {
    const runner = runners.get(id), link = deps.store.get(id);
    if (!runner || !link || disposed) return;
    // Kick: sem cookie confiável, abre o canal escondido uma vez para a página dizer se está logada
    const tentar = !runner.login && spec.loginByProbe && runner.probe === null && !alive(runner);
    if (runner.sleeping) { changed(); return; } // dormindo (live fora do ar): o despertador reabre
    if ((runner.login || tentar) && link.enabled && deps.store.channel() && !duplicateOf(runner)) {
      if (alive(runner)) { if (!isChannelPage(runner.win.webContents.getURL())) goChannel(runner); } else open(id,false);
    } else if (!runner.login && alive(runner) && !runner.win.isVisible()) close(id); // saiu da Twitch com a janela escondida: libera os recursos
    changed();
  }
  const isChannelPage = (url: string) => { const channel = deps.store.channel(); if (!channel) return false; try { const parsed = new URL(url), want = new URL(spec.channelUrl(channel)); return parsed.hostname === want.hostname && parsed.pathname.replace(/\/+$/,'').toLowerCase() === want.pathname.toLowerCase(); } catch { return false; } };
  function goChannel(runner: Runner) {
    const channel = deps.store.channel();
    if (!alive(runner) || !channel) return;
    runner.probe = null; runner.failed = false; runner.offlineSince = null;
    void runner.win.webContents.loadURL(spec.channelUrl(channel)).catch(() => undefined);
    schedule(runner,probeDelay('starting'));
    changed();
  }
  function applySound(runner: Runner) {
    if (!alive(runner)) return;
    const link = deps.store.get(runner.id);
    const muted = !(runner.win.isVisible() && !runner.win.isMinimized() && link?.sound === true);
    try { if (runner.win.webContents.isAudioMuted() !== muted) runner.win.webContents.setAudioMuted(muted); } catch { /* janela fechando */ }
  }

  /**
   * Banda limitada só com a janela escondida e a live tocando (Kick: o player desce para ~480p sozinho). À vista, banda livre.
   * Usa a emulação de rede do Chromium na própria janela (debugger do webContents; não abre porta de depuração).
   */
  async function applyThrottle(runner: Runner) {
    const kbps = spec.throttleKbps;
    if (!kbps || !alive(runner)) return;
    const contents = runner.win.webContents;
    const want = !runner.win.isVisible() && runner.probe?.playing === true;
    if (want === runner.throttled) return;
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
      await contents.debugger.sendCommand('Network.enable');
      await contents.debugger.sendCommand('Network.emulateNetworkConditions', {offline:false, latency:0, downloadThroughput: want ? kbps * 1000 / 8 : -1, uploadThroughput:-1});
      runner.throttled = want;
    } catch { /* DevTools aberto ou janela fechando: segue sem limite */ }
  }

  async function applyHideCss(runner: Runner) {
    if (!alive(runner)) return;
    const contents = runner.win.webContents, hidden = !runner.win.isVisible();
    try {
      if (hidden && !runner.cssKey && isChannelPage(contents.getURL())) runner.cssKey = await contents.insertCSS(spec.hideCss);
      else if (!hidden && runner.cssKey) { const key = runner.cssKey; runner.cssKey = null; await contents.removeInsertedCSS(key); }
    } catch { runner.cssKey = null; }
  }
  /** Live fora do ar por muito tempo e janela escondida: fecha (libera a memória) e reabre em 10 min para conferir. */
  function sleep(runner: Runner) {
    const offlineProbe = runner.probe;
    close(runner.id);
    runner.sleeping = true; runner.probe = offlineProbe; // segue mostrando "Canal offline"
    clearTimeout(runner.wake);
    runner.wake = setTimeout(() => { runner.sleeping = false; runner.probe = null; runner.offlineSince = null; afterLogin(runner.id); }, OFFLINE_RECHECK_MS);
    changed();
  }

  /** Abre (ou reaproveita) a janela da conta. `show`: à vista (login, Ver, Recompensas); senão oculta, só contando pontos. */
  function open(id: string, show: boolean, url?: string): Runner {
    const runner = runnerOf(id);
    if (alive(runner)) {
      if (url && runner.win.webContents.getURL() !== url) void runner.win.webContents.loadURL(url).catch(() => undefined);
      if (show) { if (runner.win.isMinimized()) runner.win.restore(); runner.win.show(); runner.win.focus(); }
      return runner;
    }
    prepare(id);
    const win = new BrowserWindow({show:false, width:1120, height:700, minWidth:640, minHeight:420, title:`${spec.nome} · ${labelOf(id)}`, icon:deps.iconPath, backgroundColor:'#0e0e10', autoHideMenuBar:true,
      webPreferences:{partition:partition(id), sandbox:true, contextIsolation:true, nodeIntegration:false, spellcheck:false, devTools:deps.devTools, backgroundThrottling:false, autoplayPolicy:'no-user-gesture-required', ...SAFE_DIALOGS}});
    win.removeMenu();
    runner.win = win; runner.probe = null; runner.failed = false;
    const contents = win.webContents;
    contents.setAudioMuted(true); // nasce mudo; o som só liga à vista e com a opção da conta
    contents.setWindowOpenHandler(() => ({action:'deny'}));
    const guard = (event: {preventDefault(): void}, target: string) => { if (!spec.isAllowedNavigation(target)) event.preventDefault(); };
    // só o quadro principal fica preso à plataforma: anúncios e o captcha do login rodam em iframes de outros domínios
    contents.on('will-navigate',event => { if (event.isMainFrame) guard(event,event.url); });
    contents.on('will-redirect',event => { if (event.isMainFrame) guard(event,event.url); });
    win.on('page-title-updated',event => { event.preventDefault(); }); // o título é sempre "Twitch · <conta>" (o evento que troca o título é o da janela)
    const lowQuality = spec.lowQualityScript;
    if (lowQuality) contents.on('did-finish-load',() => {
      // primeira vez nesta sessão: grava a menor qualidade nas preferências do player (Twitch: 160p) e recarrega o canal já nela
      void run(contents,lowQuality).then(changedQuality => { if (changedQuality === true && isChannelPage(contents.getURL())) contents.reload(); }).catch(() => undefined);
    });
    contents.on('did-fail-load',(_event,code,_description,_url,mainFrame) => { if (mainFrame && code !== -3) { runner.failed = true; retryLater(runner); changed(); } });
    contents.on('render-process-gone',() => { runner.failed = true; retryLater(runner); changed(); });
    for (const name of ['show','hide','minimize','restore'] as const) win.on(name as 'show',() => { applySound(runner); void applyThrottle(runner); void applyHideCss(runner); changed(); });
    contents.on('did-navigate',() => { runner.cssKey = null; }); // página nova: o CSS inserido some junto
    win.on('close',event => { if (!deps.quitting() && !disposed) { event.preventDefault(); win.hide(); } }); // fechar só esconde: continua contando
    win.once('closed',() => { if (runner.win === win) { runner.win = null; runner.throttled = false; clearTimeout(runner.timer); clearTimeout(runner.retry); runner.probe = null; changed(); } });
    runner.throttled = false; runner.cssKey = null; runner.sleeping = false; clearTimeout(runner.wake);
    void contents.loadURL(url ?? spec.channelUrl(deps.store.channel())).catch(() => undefined);
    if (show) { win.show(); win.focus(); }
    schedule(runner,probeDelay('starting'));
    changed();
    return runner;
  }
  function close(id: string) {
    const runner = runners.get(id);
    if (!runner) return;
    clearTimeout(runner.timer); clearTimeout(runner.retry); clearTimeout(runner.wake); runner.sleeping = false;
    const win = runner.win; runner.win = null; runner.probe = null; runner.failed = false; runner.offlineSince = null;
    if (win && !win.isDestroyed()) { try { win.destroy(); } catch { /* já fechando */ } }
    changed();
  }
  function retryLater(runner: Runner) {
    clearTimeout(runner.retry);
    runner.retry = setTimeout(() => { if (alive(runner) && runner.failed) { runner.failed = false; runner.win.webContents.reload(); schedule(runner,probeDelay('starting')); } },RETRY_MS);
  }
  function schedule(runner: Runner, delay: number) {
    clearTimeout(runner.timer);
    runner.timer = setTimeout(() => void probe(runner),delay);
  }
  /** Uma leitura da página: saldo, live no ar, player tocando; retoma o player e coleta o baú se for o caso. */
  async function probe(runner: Runner) {
    if (disposed || !alive(runner) || runner.probing) return;
    const link = deps.store.get(runner.id);
    if (!link || !link.enabled) { close(runner.id); return; }
    const contents = runner.win.webContents;
    runner.probing = true;
    try {
      if (contents.isLoadingMainFrame()) return;
      const visible = runner.win.isVisible();
      // escondida e fora do canal (o usuário navegou na janela e a fechou): volta ao canal
      if (!visible && runner.login && deps.store.channel() && !isChannelPage(contents.getURL())) { goChannel(runner); return; }
      if (!isChannelPage(contents.getURL())) { runner.probe = null; return; }
      const result = sanitizeProbe(await run(contents,spec.probeScript));
      runner.probe = result;
      if (!result) return;
      if (spec.loginByProbe) {
        // Kick: a página diz se está logada (menu da conta) ou não (botão de entrar)
        const before = runner.login;
        if (result.user) runner.login = result.user;
        else if (result.loggedOut) runner.login = null;
        if (before !== runner.login) queueMicrotask(() => afterLogin(runner.id));
        if (!runner.login) { if (!visible) queueMicrotask(() => close(runner.id)); return; } // sem conta: não fica assistindo anônimo (gasta recurso à toa)
      }
      void applyThrottle(runner);
      void applyHideCss(runner);
      const balance = parseBalance(result.balance);
      if (balance !== null) {
        if (runner.balance !== null && balance > runner.balance && balance - runner.balance < 100_000) runner.earned += balance - runner.balance; // só ganhos; gastar (resgate) não desconta
        runner.balance = balance;
      }
      if (result.live && !result.playing && result.paused && !result.gate && !visible) await run(contents,RESUME_SCRIPT).catch(() => undefined);
      if (spec.claimScript && result.claimable && link.autoClaim && result.live) { if (await run(contents,spec.claimScript).catch(() => false) === true) runner.claimed++; }
      if (!result.live) {
        runner.offlineSince ??= Date.now();
        if (!visible && Date.now() - runner.offlineSince >= OFFLINE_SLEEP_MS) { queueMicrotask(() => sleep(runner)); return; }
        if (!visible && Date.now() - runner.offlineSince >= OFFLINE_RELOAD_MS && !runner.reloadedOffline) { runner.reloadedOffline = true; contents.reload(); }
      } else { runner.offlineSince = null; runner.reloadedOffline = false; }
    } catch { runner.probe = null; }
    finally {
      runner.probing = false;
      changed();
      if (alive(runner)) schedule(runner,probeDelay(currentState(runner,deps.store.get(runner.id))));
    }
  }

  const channelReady = () => deps.store.channel() !== '';
  /** Abre as contas ligadas e logadas, escalonado depois das sessões do jogo. */
  function start() {
    let delay = TWITCH_START_DELAY_MS;
    for (const link of deps.store.list()) {
      if (!known(link.profileId)) continue;
      const timer = setTimeout(() => { startTimers.delete(timer); void readLogin(link.profileId).then(() => afterLogin(link.profileId)); },delay);
      startTimers.add(timer);
      delay += TWITCH_STAGGER_MS;
    }
    changed();
  }
  const refused = (message: string): never => { throw new TwitchRefused(message); };
  return {
    info,
    start,
    setChannel(value: unknown): TwitchInfo {
      const before = deps.store.channel();
      let channel = '';
      try { channel = deps.store.setChannel(value); } catch { refused(`Nome de canal inválido. Use o nome (ex.: canal_oficial) ou o link do canal na ${spec.nome}.`); }
      if (channel !== before) {
        for (const runner of runners.values()) { runner.balance = null; runner.earned = 0; runner.claimed = 0; }
        for (const link of deps.store.list()) { wakeNow(link.profileId); if (!channel) close(link.profileId); else afterLogin(link.profileId); }
      }
      changed();
      return info();
    },
    /** Vincula a conta (cria a linha) e abre a janela à vista: no login da Twitch, ou no canal se já entrou. */
    async link(id: unknown): Promise<TwitchInfo> {
      if (!known(id)) refused('Perfil não encontrado.');
      const profileId = id as string;
      deps.store.link(profileId);
      const login = await readLogin(profileId);
      open(profileId,true,login ? (channelReady() ? spec.channelUrl(deps.store.channel()) : spec.homeUrl) : spec.loginUrl);
      return info();
    },
    /** Desvincula: fecha a janela, apaga a sessão da Twitch (sai da conta) e enfileira a pasta para apagar no próximo início. */
    async unlink(id: unknown): Promise<TwitchInfo> {
      if (!known(id)) refused('Perfil não encontrado.');
      const profileId = id as string;
      close(profileId);
      try { await clearAllSessionData(prepare(profileId)); } catch { /* segue: a pasta é apagada no próximo início */ }
      deps.store.unlink(profileId); deps.wipe(profileId); runners.delete(profileId);
      changed();
      return info();
    },
    update(id: unknown, patch: unknown): TwitchInfo {
      if (!known(id) || !deps.store.get(id as string)) refused(`Vincule a ${spec.nome} nesta conta primeiro.`);
      const profileId = id as string;
      const link = deps.store.update(profileId,patch);
      const runner = runnerOf(profileId);
      wakeNow(profileId);
      if (!link.enabled) close(profileId); else afterLogin(profileId);
      if (patch && typeof patch === 'object' && 'enabled' in patch) for (const other of deps.store.list()) if (other.profileId !== profileId) afterLogin(other.profileId); // pausar libera a mesma conta da Twitch em outro perfil
      applySound(runner);
      changed();
      return info();
    },
    /** Mostra a janela da conta (ver a live, entrar ou trocar de conta da Twitch). */
    async show(id: unknown): Promise<TwitchInfo> {
      if (!known(id) || !deps.store.get(id as string)) refused(`Vincule a ${spec.nome} nesta conta primeiro.`);
      const profileId = id as string;
      const login = await readLogin(profileId);
      open(profileId,true,alive(runnerOf(profileId)) ? undefined : !login ? spec.loginUrl : channelReady() ? spec.channelUrl(deps.store.channel()) : spec.homeUrl);
      return info();
    },
    /** Mostra a janela no canal com o painel de recompensas aberto; o resgate é do usuário. */
    async rewards(id: unknown): Promise<TwitchInfo> {
      if (!known(id) || !deps.store.get(id as string)) refused(`Vincule a ${spec.nome} nesta conta primeiro.`);
      if (!channelReady()) refused('Defina o canal primeiro.');
      const profileId = id as string;
      if (!await readLogin(profileId)) refused(`Entre na ${spec.nome} nesta conta primeiro.`);
      const runner = open(profileId,true,spec.channelUrl(deps.store.channel()));
      const contents = runner.win?.webContents;
      const rewards = spec.rewardsScript;
      if (contents && rewards) {
        const click = () => { void run(contents,rewards).catch(() => undefined); };
        if (contents.isLoadingMainFrame()) contents.once('did-stop-loading',() => setTimeout(click,2500)); else click();
      }
      return info();
    },
    hide(id: unknown): TwitchInfo { const runner = typeof id === 'string' ? runners.get(id) : undefined; if (runner && alive(runner)) runner.win.hide(); return info(); },
    /** Perfil apagado: fecha a janela e apaga a sessão da Twitch no próximo início (a linha some em cascata). */
    removeProfile(id: string) { close(id); runners.delete(id); deps.wipe(id); changed(); },
    dispose() {
      disposed = true; clearTimeout(emitTimer);
      for (const timer of startTimers) clearTimeout(timer);
      startTimers.clear();
      for (const id of [...runners.keys()]) { const runner = runners.get(id)!; clearTimeout(runner.timer); clearTimeout(runner.retry); clearTimeout(runner.wake); if (runner.win && !runner.win.isDestroyed()) { try { runner.win.destroy(); } catch { /* saindo */ } } runner.win = null; }
    },
  };
}
export class TwitchRefused extends Error {}
export type TwitchService = ReturnType<typeof createTwitchService>;
