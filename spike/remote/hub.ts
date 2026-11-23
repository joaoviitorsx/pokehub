// Orquestra o acesso remoto: liga/desliga o servidor (fila serial com contador de geração), rede doméstica fixada, certificados, pareamento
// (pedido "Permitir?" na janela do PC + confirmação nativa), PIN, aparelhos, auditoria e o bloqueio do sono. Sem Electron: tudo entra por `deps` (testável).
import { join } from 'node:path';
import { discoverNetwork, type Bind, type NetSelection } from './ip';
import { ensureCerts, formatFingerprint, type CertResult, type SecretBox } from './certs';
import { Pairing, PinGuard, createPowerGuard, formatCode, hashPin, validPin, type Blocker, type PinStore } from './guards';
import { createRemoteServer, type PairInfo, type RemoteApi, type RemoteServer, type ServerDeps } from './server';
import { RemoteStore, validPort, type AuditRow } from './store';
import { createAlertEngine, type AlertEngine, type AlertProfile, type CaptureSource } from './alerts';
import { createPush, type Push, type PushFetch } from './push';
import { createActions, type AccountPort, type Actions, type ShopPort } from './actions';
import { MAX_CAP_GOLD } from './store';
import type { RemoteAlert, RemoteDevice, RemotePurchase, RemoteSpend, RemoteStatus } from '../contracts/remote';

/** Confirmação NATIVA do sistema (fora da página): quem controla a janela do app não aprova sozinho. */
export type NativeConfirm = (options: {title: string; message: string; detail: string; confirmLabel: string}) => Promise<boolean>;
export interface HubDeps {
  dbPath: string; dir: string; uiDir: string; iconPath: string; api: RemoteApi; running(): number; blocker: Blocker;
  net?: () => Promise<NetSelection>; now?: () => number; onChange?: () => void; onPairRequest?: () => void; certOptions?: {restrict?: boolean};
  networkPollMs?: number; requestTimeoutMs?: number; portOverride?: number; approveDelayMs?: number;
  secretBox?: SecretBox; nativeConfirm?: NativeConfirm;
  /** R3: de onde vêm as capturas e as contas; sem isto não há alertas nem push. `fetcher` só para testes/Electron (`net.fetch`). */
  alerts?: {captures: CaptureSource; profiles(): readonly AlertProfile[]; fetcher?: PushFetch};
  /** R4: Loja rápida e ações de conta do hub + aviso no PC (notificação do sistema). Sem isto o celular não age. */
  actions?: {shop: ShopPort; account: AccountPort; notify(title: string, body: string): void; dayOf?(ms: number): string; tz?: string};
  /** Só para testes: troca a fábrica do servidor e os limites/tempos dele. */
  serverFactory?: (deps: ServerDeps) => RemoteServer; serverLimits?: ServerDeps['limits']; serverTiming?: ServerDeps['timing'];
}
export class RemoteUserError extends Error {}
const MSG_START = 'Não foi possível ligar o acesso remoto. Verifique se a porta está livre e se há rede privada (Wi-Fi de casa).';
const MSG_NO_NET = 'Sem rede privada (Wi-Fi de casa) disponível. Conecte-se à rede de casa e marque-a como Privada.';
const MSG_CONFIRM = 'Não foi possível abrir a confirmação do sistema.';
export const APPROVE_DELAY_MS = 1500;
const LOOPBACK: Bind = {address: '127.0.0.1', netmask: '255.0.0.0', name: 'loopback'};

export function createRemoteHub(deps: HubDeps) {
  const now = deps.now ?? Date.now, net = deps.net ?? (() => discoverNetwork());
  const store = new RemoteStore(deps.dbPath);
  const pairing = new Pairing(now), power = createPowerGuard(deps.blocker);
  const iso = () => new Date(now()).toISOString();
  const allowLoopback = deps.portOverride !== undefined; // 127.0.0.1 só em testes/porta de teste (B5)
  let server: RemoteServer | null = null, certs: CertResult | null = null, addresses: string[] = [], bound: Bind[] = [], port = 0, error: string | null = null;
  let want = store.getEnabled(), gen = 0, chain: Promise<unknown> = Promise.resolve(), poll: ReturnType<typeof setInterval> | undefined;
  let netState: 'ok' | 'rede_nova' | 'sem_rede' = 'ok', netLabel = store.getNetPin()?.label ?? '', caNotice: string | null = null, aclOk = true, notice: string | null = null;
  type Request = {info: PairInfo; since: number; contested: boolean; deciding: boolean; settle: (allow: boolean) => void; timer: ReturnType<typeof setTimeout>};
  let request: Request | null = null, paired: string | null = null, revealed = true, closed = false;
  let engine: AlertEngine | null = null, pushLib: Push | null = null, actions: Actions | null = null;
  const changed = () => { engine?.update(); try { deps.onChange?.(); } catch { /* ouvinte */ } };
  /** Chave VAPID criada só quando precisa (1ª assinatura/consulta); se foi refeita, as assinaturas antigas não valem mais. */
  const getPush = (): Push | null => {
    if (!deps.alerts) return null;
    if (!pushLib) { try { pushLib = createPush({dir: deps.dir, box: deps.secretBox, fetcher: deps.alerts.fetcher}); if (pushLib.replaced) store.clearPush(); } catch { return null; } }
    return pushLib;
  };
  if (deps.alerts) engine = createAlertEngine({store, push: getPush, captures: deps.alerts.captures, profiles: deps.alerts.profiles, running: () => server?.listening() ?? false, streams: () => server?.streamCount() ?? 0, publish: (event, data, filter) => server?.publish(event, data, filter), now});
  const audit = (deviceId: string | null, action: string, detail: string | null = null) => { try { store.audit(deviceId, action, detail, iso()); } catch { /* auditoria */ } };
  const alertUser = (text: string) => { notice = text; changed(); };
  const pinStore: PinStore = {get: k => store.pinState(k), set: (k, s) => store.setPinState(k, s), delete: k => store.clearPinState(k), actionsDisabled: () => store.getActionsDisabled(), setActionsDisabled: v => store.setActionsDisabled(v)};
  const pin = new PinGuard(() => store.getPinHash(), now, {
    onLock: (id, level, until) => { actions?.clearElevations(id); audit(id, 'pin_bloqueado', `nível ${level} até ${new Date(until).toISOString()}`); changed(); },
    onRevoke: id => { const name = store.getDevice(id)?.name ?? 'aparelho'; if (server ? server.revoke(id) : store.revokeDevice(id)) { audit(id, 'aparelho_revogado_pin', name); alertUser(`“${name}” foi revogado depois de várias tentativas erradas de PIN.`); } },
    onDisable: () => { actions?.clearElevations(); audit(null, 'acoes_desligadas', '10 erros de PIN no dia'); alertUser('Ações pelo celular desligadas: 10 erros de PIN em um dia. Religue em Acesso remoto quando quiser.'); },
  }, pinStore);

  if (deps.actions) {
    const a = deps.actions;
    actions = createActions({store, pin, now, accounts: () => deps.api.accounts(), shop: a.shop, account: a.account, publish: (deviceId, event, data) => server?.publish(event, data, id => id === deviceId), notifyPc: a.notify, pushDevices: (label, text) => { void engine?.notifyAction(label, text); }, audit, dayOf: a.dayOf, tz: a.tz});
  }

  /** Fila serial: ligar, desligar e reiniciar nunca se sobrepõem. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => { const run = chain.then(task, task); chain = run.then(() => undefined, () => undefined); return run; };
  const baseUrl = () => addresses[0] ? `https://${addresses[0]}:${port}` : null;
  const clearPoll = () => { clearInterval(poll); poll = undefined; };

  const confirmPair = (info: PairInfo, signal: AbortSignal) => new Promise<boolean>(resolve => {
    const settle = (allow: boolean) => { if (!request || request.info !== info) return; clearTimeout(request.timer); request = null; if (allow) paired = info.name; resolve(allow); changed(); };
    request = {info, since: now(), contested: false, deciding: false, settle, timer: setTimeout(() => settle(false), deps.requestTimeoutMs ?? 60_000)};
    signal.addEventListener('abort', () => settle(false), {once: true});
    if (signal.aborted) { settle(false); return; }
    changed(); try { deps.onPairRequest?.(); } catch { /* janela */ }
  });

  /** Liga o servidor. `adopt` = o usuário acabou de ligar/liberar a rede: fixa a rede atual. Aborta e fecha tudo se a geração mudou, o acesso foi desligado ou o hub fechou. */
  async function start(g: number, adopt: boolean): Promise<void> {
    if (server || closed) return;
    const alive = () => g === gen && want && !closed;
    const sel = await net().catch(() => null);
    if (!alive()) return;
    if (!sel || (!sel.binds.length && !allowLoopback)) { error = sel?.error ?? MSG_NO_NET; netState = 'sem_rede'; changed(); throw new RemoteUserError(error); }
    const pinned = store.getNetPin();
    if (!adopt && pinned && sel.binds.length && sel.pin !== pinned.pin) { netState = 'rede_nova'; netLabel = pinned.label; error = null; audit(null, 'rede_nova', sel.label); changed(); return; } // nunca religa sozinho em outra rede
    const binds = [...sel.binds, ...(allowLoopback ? [LOOPBACK] : [])];
    let set: CertResult;
    try { set = ensureCerts(join(deps.dir), binds.map(b => b.address), {...deps.certOptions, box: deps.secretBox, subnets: sel.subnets}); } catch { error = MSG_START; changed(); throw new RemoteUserError(MSG_START); } // as chaves ficam só em disco (0600, cifradas quando possível)
    const created = (deps.serverFactory ?? createRemoteServer)({store, certs: () => set, api: deps.api, pairing, confirmPair, onContested: () => { if (request) { request.contested = true; audit(null, 'pareamento_contestado', request.info.ip); changed(); } }, uiDir: deps.uiDir, iconPath: deps.iconPath, now, alerts: engine ?? undefined, actions: actions ?? undefined, onActivity: () => engine?.update(), limits: deps.serverLimits, timing: deps.serverTiming});
    let listened: number;
    try { listened = await created.listen(binds, deps.portOverride ?? store.getPort()); } catch { error = MSG_START; changed(); throw new RemoteUserError(MSG_START); }
    if (!alive()) { await created.close(); return; } // desligaram (ou outra geração assumiu) enquanto abria a porta
    server = created; certs = set; bound = binds; port = listened; addresses = sel.binds.length ? sel.binds.map(b => b.address) : [LOOPBACK.address]; error = null; netState = 'ok'; aclOk = set.aclOk;
    if (adopt || !pinned) { store.setNetPin(sel.pin, sel.label); if (!pinned) audit(null, 'rede_fixada', sel.label); }
    netLabel = sel.label; if (set.caRegenerated) { caNotice = 'A rede mudou e o certificado do PokéHub foi refeito. Reinstale o certificado no celular ao parear.'; audit(null, 'ca_refeita', sel.subnets.join(',')); }
    server.sweepExpired();
    audit(null, 'acesso_remoto_ligado', sel.label);
    changed();
  }
  async function stopServer(): Promise<void> {
    pairing.cancel();
    request?.settle(false);
    actions?.clearElevations(); // desligar, trocar de rede ou reiniciar: ninguém continua "elevado"
    const current = server; server = null;
    await current?.close();
    changed();
  }
  /** A cada poucos segundos: rede igual → segue (e reabre se o IP mudou); rede diferente ou sumiu → para e espera o usuário. */
  async function netCheck(g: number): Promise<void> {
    if (g !== gen || closed || !want) return;
    server?.sweepExpired();
    const sel = await net().catch(() => null);
    if (g !== gen || closed || !want || !sel) return;
    const pinned = store.getNetPin(), same = sel.binds.length > 0 && pinned !== null && sel.pin === pinned.pin;
    if (server) {
      if (!sel.binds.length) { await stopServer(); netState = 'sem_rede'; audit(null, 'rede_perdida'); changed(); }
      else if (!same) { await stopServer(); netState = 'rede_nova'; audit(null, 'rede_nova', sel.label); alertUser('Rede nova detectada. O acesso remoto parou até você liberar esta rede.'); }
      else if (sel.binds.length !== bound.filter(b => b !== LOOPBACK).length || sel.binds.some(b => !bound.some(o => o.address === b.address))) { await stopServer(); await start(g, false).catch(() => undefined); } // mesmo Wi-Fi, IP novo: reabre e renova o certificado
    } else if (same) { await start(g, false).catch(() => undefined); }
    else if (!sel.binds.length) { if (netState !== 'sem_rede') { netState = 'sem_rede'; changed(); } }
    else if (netState !== 'rede_nova') { netState = 'rede_nova'; audit(null, 'rede_nova', sel.label); alertUser('Rede nova detectada. O acesso remoto só volta quando você liberar esta rede.'); }
    power.update(server?.listening() ?? false, deps.running());
  }
  const ensurePoll = () => { if (poll || closed) return; poll = setInterval(() => { void serial(() => netCheck(gen)).catch(() => undefined); }, deps.networkPollMs ?? 30_000); poll.unref(); };
  const confirmNative = async (options: Parameters<NativeConfirm>[0]): Promise<boolean> => { if (!deps.nativeConfirm) throw new RemoteUserError(MSG_CONFIRM); try { return await deps.nativeConfirm(options) === true; } catch { throw new RemoteUserError(MSG_CONFIRM); } };

  const self = {
    store, pin,
    async boot(): Promise<void> {
      want = store.getEnabled();
      if (want) { const g = ++gen; try { await serial(() => start(g, false)); } catch { /* status.error */ } if (g === gen && want) ensurePoll(); }
      power.update(server?.listening() ?? false, deps.running());
    },
    async setEnabled(value: boolean): Promise<void> {
      const g = ++gen; want = value;
      if (!value) { store.setEnabled(false); clearPoll(); }
      try {
        await serial(async () => {
          if (value) { await start(g, true); if (g === gen && want && server) { store.setEnabled(true); ensurePoll(); } }
          else { await stopServer(); netState = 'ok'; audit(null, 'acesso_remoto_desligado'); }
        });
      } catch (e) { if (g === gen) want = store.getEnabled(); throw e; } finally { power.update(server?.listening() ?? false, deps.running()); changed(); }
    },
    /** "Rede nova detectada: liberar aqui?": confirma no sistema, fixa a rede atual e religa. */
    async allowNetwork(): Promise<void> {
      if (!want || closed) throw new RemoteUserError('Ligue o acesso remoto primeiro.');
      const sel = await net().catch(() => null);
      if (!sel?.binds.length) throw new RemoteUserError(sel?.error ?? MSG_NO_NET);
      if (!await confirmNative({title: 'PokéHub — liberar rede', message: `Liberar o acesso remoto na rede “${sel.label || 'atual'}”?`, detail: 'Só libere na sua rede de casa. Quem estiver nela poderá tentar parear com o código que você gerar. O certificado do celular será refeito para esta rede.', confirmLabel: 'Liberar'})) return;
      const g = ++gen;
      await serial(async () => { await stopServer(); store.setNetPin(sel.pin, sel.label); netLabel = sel.label; netState = 'ok'; notice = null; audit(null, 'rede_liberada', sel.label); await start(g, true); if (g === gen && want && server) ensurePoll(); });
      power.update(server?.listening() ?? false, deps.running()); changed();
    },
    enabled: () => !closed && store.getEnabled(),
    streamCount: () => server?.streamCount() ?? 0,
    isListening: () => server?.listening() ?? false,
    status(): RemoteStatus {
      const info = pairing.info(), base = baseUrl(), fp = certs?.fingerprint ?? null, first = store.countDevices() === 0;
      return {
        enabled: store.getEnabled(), running: server?.listening() ?? false, port: port || store.getPort(), urls: addresses.map(ip => `https://${ip}:${port}`), error,
        network: {state: netState, label: netLabel}, fingerprint: fp ? formatFingerprint(fp) : null, caNotice, aclOk, notice, actionsDisabled: store.getActionsDisabled(),
        pairing: info && base && fp ? {code: revealed ? formatCode(info.code) : '', codeHidden: !revealed, expiresAt: info.expiresAt, attemptsLeft: info.attemptsLeft, attemptsByIp: info.byIp, caUrl: `${base}/ca.crt`, iosUrl: `${base}/ca.mobileconfig`, bootstrapUrl: `${base}/#fp=${fp}`, fingerprint: formatFingerprint(fp)} : null,
        request: request ? {name: request.info.name, nickname: request.info.nickname, ua: request.info.ua, ip: request.info.ip, sas: request.info.sas, contested: request.contested, since: request.since, deciding: request.deciding} : null,
        paired, pinSet: store.getPinHash() !== null, devices: store.countDevices(), firstPairing: first, dailyCapGold: store.getDailyCapGold(),
      };
    },
    startPairing(): RemoteStatus { if (!server) throw new RemoteUserError('Ligue o acesso remoto primeiro.'); pairing.start(); paired = null; revealed = store.countDevices() > 0; audit(null, 'pareamento_iniciado'); changed(); return this.status(); },
    /** Primeiro pareamento: o código só aparece depois que o usuário confere a impressão digital no celular. */
    revealCode(): RemoteStatus { revealed = true; changed(); return this.status(); },
    cancelPairing(): void { pairing.cancel(); request?.settle(false); changed(); },
    async decide(allow: boolean): Promise<void> {
      const r = request; if (!r || r.deciding) return;
      if (allow !== true) { r.settle(false); return; }
      if (now() - r.since < (deps.approveDelayMs ?? APPROVE_DELAY_MS)) throw new RemoteUserError('Aguarde um instante e confira o número antes de permitir.');
      r.deciding = true; changed();
      try {
        const ok = await confirmNative({title: 'PokéHub — permitir aparelho', message: `Permitir “${r.info.name}” (${r.info.ip}) a ver suas contas?`, detail: `O celular deve estar mostrando o número ${r.info.sas}.${r.contested ? ' ATENÇÃO: o código foi digitado por mais de um aparelho.' : ''} Se não foi você, recuse.`, confirmLabel: 'Permitir'});
        if (request === r) r.settle(ok);
      } catch (e) { if (request === r) { r.deciding = false; changed(); } throw e; }
    },
    async setPin(value: unknown): Promise<void> { if (!validPin(value)) throw new RemoteUserError('O PIN precisa ter 6 dígitos.'); store.setPinHash(await hashPin(value)); pin.reset(); actions?.clearElevations(); audit(null, 'pin_definido'); changed(); },
    clearPin(): void { store.setPinHash(null); pin.reset(); actions?.clearElevations(); audit(null, 'pin_removido'); changed(); },
    /** Religa as ações pelo celular depois dos 10 erros de PIN no dia (e zera os contadores). */
    reenableActions(): void { pin.reset(); audit(null, 'acoes_religadas'); notice = null; changed(); },
    dismissNotice(): void { notice = null; changed(); },
    /** "Pode agir" muda o que o celular faz: passa por confirmação nativa. */
    async setCanAct(id: unknown, value: unknown): Promise<RemoteDevice[]> {
      if (typeof id !== 'string' || typeof value !== 'boolean') throw new RemoteUserError('Pedido inválido.');
      const device = store.getDevice(id); if (!device) throw new RemoteUserError('Aparelho não encontrado.');
      if (!await confirmNative({title: 'PokéHub — permissão de ações', message: `${value ? 'Permitir' : 'Bloquear'} ações de “${device.name}”?`, detail: value ? 'Com “pode agir” o celular poderá comprar na Loja (dentro do teto diário), recarregar, suspender e retomar contas e ligar o Modo leve, sempre com PIN. Só permita para um aparelho seu.' : 'O celular volta a só ver.', confirmLabel: value ? 'Permitir' : 'Bloquear'})) return self.devices();
      store.setCanAct(id, value); if (!value) actions?.clearElevations(id); audit(id, value ? 'pode_agir_ligado' : 'pode_agir_desligado', device.name); changed(); return self.devices();
    },
    devices: (): RemoteDevice[] => store.listDevices().map(d => ({...d, push: store.pushCount(d.id)})),
    /** Últimos alertas (histórico do banco), para o painel do PC. */
    alerts: (limit = 20): RemoteAlert[] => store.listAlerts(limit),
    /** Relatório de estado de uma conta (alimenta "conta caiu/voltou"). */
    reportState: (id: string, state: string) => engine?.reportState(id, state),
    /** "Enviar teste": push de teste aos aparelhos deste dispositivo (3 a cada 10 min). */
    async pushTest(id: unknown): Promise<{sent: number}> {
      if (typeof id !== 'string' || !store.getDevice(id)) throw new RemoteUserError('Aparelho não encontrado.');
      if (!engine || store.pushCount(id) === 0) throw new RemoteUserError('Este aparelho não ativou as notificações.');
      const sent = await engine.sendTest(id);
      if (sent === null) throw new RemoteUserError('Aguarde alguns minutos para enviar outro teste.');
      audit(id, 'push_teste', `${sent} enviado(s)`); changed(); return {sent};
    },
    audit: (): AuditRow[] => store.listAudit(100),
    revoke(id: unknown): boolean { if (typeof id !== 'string') return false; const ok = server ? server.revoke(id) : store.revokeDevice(id); actions?.forget(id); if (ok) audit(id, 'aparelho_revogado'); changed(); return ok; },
    /** R4: histórico de compras do celular (últimas 50) e gasto de hoje por conta, para o painel do PC. */
    purchases: (): RemotePurchase[] => actions?.purchases() ?? [],
    spendToday: (): RemoteSpend[] => actions?.spendToday() ?? [],
    /** Teto diário de ouro por conta (SÓ no PC). Aumentar pede confirmação nativa e derruba as elevações de PIN. */
    async setDailyCap(value: unknown): Promise<number> {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_CAP_GOLD) throw new RemoteUserError('Teto inválido.');
      const old = store.getDailyCapGold();
      if (value === old) return old;
      if (value > old && !await confirmNative({title: 'PokéHub — teto diário do celular', message: `Aumentar o teto diário de compras pelo celular para ${value.toLocaleString('pt-BR')} de ouro por conta?`, detail: 'Um aparelho com permissão poderá gastar mais ouro por dia (sempre com PIN). Todas as elevações de PIN serão encerradas.', confirmLabel: 'Aumentar'})) return old;
      store.setDailyCapGold(value); if (value > old) actions?.clearElevations();
      audit(null, 'teto_diario', `${old} → ${value} de ouro por conta`); changed(); return value;
    },
    setPort(value: unknown): void { if (!validPort(value)) throw new RemoteUserError('Porta inválida.'); store.setPort(value); },
    publish: (event: string, data: unknown) => server?.publish(event, data),
    updatePower: () => !closed && power.update(server?.listening() ?? false, deps.running()), // o sono só é segurado com o servidor de fato escutando
    async close(): Promise<void> { if (closed) return; closed = true; gen++; engine?.close(); clearPoll(); power.update(false, 0); const done = serial(stopServer); try { store.close(); } catch { /* já fechado */ } await done; }, // o banco fecha já; a porta fecha junto
  };
  return self;
}
export type RemoteHub = ReturnType<typeof createRemoteHub>;
