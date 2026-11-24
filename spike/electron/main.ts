import { app, BrowserWindow, WebContentsView, globalShortcut, ipcMain, dialog, shell, net, Tray, Menu, Notification, nativeImage, powerSaveBlocker, safeStorage, session, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { effectiveFocus, initialFocus, layout, SIDE_MAX, SIDE_MIN, SIDE_PANEL, sideWidth, TOP_BAR } from './layout';
import { huntSnapshot, HUNT_UNAVAILABLE, type HuntTarget } from './hunt-snapshot';
import { marketScan, MARKET_UNAVAILABLE } from './market-scan';
import { createMarketReader } from './market-read';
import { createMarketBadges } from './market-badges';
import { createFichaReview } from './ficha-review';
import { createDeadlines } from './deadlines';
import { DAY_TYPE_SCRIPT, sanitizeDayType, teamPick } from './team-pick';
import { dayTypeNotice } from '../domain/team-pick';
import { readFileSync, writeFileSync } from 'node:fs';
import { alertLabel, type MarketAlertHit } from '../domain/market-alerts';
import { createShop, SHOP_UNAVAILABLE } from './shop';
import { createCaptureService, parseQuery } from './captures';
import { alertsOf, alertText } from '../domain/captures';
import type { ShopProgress } from '../domain/shop';
import { isAllowedGameUrl, isAllowedSessionNavigation, isOAuthProviderUrl } from './navigation';
import { createControlShortcut, createGhostWindow, createScreenTarget, installNavigationLock, type GhostWindow } from './screen-target';
import { createChangeNotifier, screenNotice } from './screen-notify';
import { ProfileStore } from './profile-store';
import { partitionFor } from './partition';
import { PreferencesStore } from './preferences-store';
import { closeContents } from './close-contents';
import { groupMetrics, summarizeMetrics, type DiagnosticsBaseline } from './diagnostics';
import { canReadHunt, classifyLoadFailure, classifyLoadRejection, isMainFrameLoading, offlineRetryDelay, statusChanged } from './session-status';
import { audioMuted, mergeDisableFeatures, startupPlan, windowChrome } from './performance';
import { isExpandShortcut, isSideShortcut, shortcutFocus, shortcutIndex } from './workspace-shortcuts';
import { acquireSingleInstance } from './single-instance';
import { dangerousSwitches, restrictUserData } from './hardening';
import { debounced, runningCount, TRAY_HINT, trayAction, trayIconSize, trayMenuItems, trayTooltip, type TrayEvent } from './tray';
import { resetSession, restartSession, openSessionSafely, mountSessionView } from './session-recovery';
import { approvedHostsOf, catalogIdOf, createAuditCache, CATALOG, checkExtension, findInstalled, HUNT_ID, hostsCovered, resolveExtensionPath } from './extension-check';
import type { AuditFinding, AuditVerdict, ExtensionInfo } from '../contracts/extensions';
import { createNetworkPolicyStore, createUnknownLog, decide, hostOf } from './network-policy';
import type { NetworkInfo } from '../contracts/network';
import { createUpdater, type Updater } from './updater';
import type { UpdateInfo } from '../contracts/update';
import type { PerformancePrefs, TrayPrefs } from '../contracts/preferences';
import { ProfileLimitError, type ProfileInput } from '../domain/profiles';
import { createRemoteHub, type RemoteHub } from '../remote/hub';
import { createRemoteApi } from '../remote/api';
import { registerRemoteIpc } from '../remote/ipc';
import { clearAllSessionData, createWipeQueue, findOrphans, KICK_PREFIX, runPendingWipes, TWITCH_PREFIX, type WipeQueue } from './partition-wipe';
import { createTwitchService, TwitchRefused, type TwitchService } from './twitch';
import { TwitchStore } from './twitch-store';
import type { StreamPlatform, TwitchInfo } from '../contracts/twitch';
import { isPlatform, PLATFORMS } from '../domain/streams';
import { guardNewContents, isAppFrameUrl, lockSession, SAFE_DIALOGS } from './runtime-guards';
import { createAccountLock } from './account-lock';
import { readJsonBounded } from './bounded-body';
import { openDatabase } from './database';
import { smokeConfig, writeSmokeResult } from './smoke';
import { remoteSmoke, type RemoteSmoke } from './smoke-remote';

let window: BrowserWindow;
let store: ProfileStore;
let preferences: PreferencesStore;
let updater: Updater;
const views = new Map<string, WebContentsView>();
const huntDocuments = new WeakMap<Electron.WebContents, object>();
const states = new Map<string, string>();
const resetting = new Set<string>();
let focused: string | null = null;
let editing = false;
// Arrasto da borda da lateral: as views nativas ficam por cima do renderer e engolem o ponteiro, então somem até soltar.
let dragging = false;
let dragTimer: ReturnType<typeof setTimeout> | undefined;
const DRAG_FAILSAFE_MS = 10_000;
let sideOpen = false;
let sidePanel = SIDE_PANEL;
let sideAccount: string | null = null; // conta escolhida na lateral: é a mostrada quando a grade não cabe ao lado dela
let autoFocused: string | null = null;
let diagnosticsBaseline: DiagnosticsBaseline | null = null;
let externalNoticeOpen = false;
const suspended = new Set<string>(); // contas suspensas: só em memória; ao reiniciar o app todas abrem
let perf: PerformancePrefs = {lite: false, muteUnfocused: false};
let tray: Tray | null = null;
let ghost: GhostWindow | null = null; // R5: janela fantasma (captura com a janela na bandeja)
const screenTargets = new WeakMap<WebContentsView, ReturnType<typeof createScreenTarget>>();
const CONTROL_SHORTCUT = 'CommandOrControl+Shift+F12'; // encerra TODO controle remoto (registrado só enquanto alguém controla)
let remote: RemoteHub | null = null; // acesso remoto pelo celular (spike/remote); só liga se o usuário ativar
let trayPrefs: TrayPrefs = {onClose:true, onMinimize:true, hintShown:false};
let quitting = false; // before-quit: a partir daqui fechar a janela encerra de verdade
const refreshTray = debounced(() => updateTray(), 300);
const mutedState = new WeakMap<Electron.WebContents, boolean>();
const startupTimers = new Set<ReturnType<typeof setTimeout>>();
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let resizePending = false;
const RESIZE_THROTTLE_MS = 33;
// Evita um processo renderer ocioso de reserva por site (Chromium); preserva flags já definidas.
app.commandLine.appendSwitch('disable-features', mergeDisableFeatures(app.commandLine.getSwitchValue('disable-features'), ['SpareRendererForSitePerProcess']));
const gameUrl = 'https://pokeidle.io/app';
// Extensões de terceiros (/hunt, Smart Market...): carregadas da pasta do navegador do usuário, nunca copiadas.
interface ExtState {id: string; catalogId: string | null; name: string; version: string | null; path: string; enabled: boolean; verdict: AuditVerdict | null; findings: AuditFinding[]; hosts: string[]; approvedHosts: string[]; pending: boolean; error: string | null; loadable: boolean}
let extensions: ExtState[] = [];
const extErrors = new Map<string, string>(); // falhas de carga por extensão; as sessões seguem abertas sem ela
let extBusy = false;
const auditCache = createAuditCache();
let extensionsLoaded = false; // a primeira leitura (assíncrona) das extensões terminou: as sessões esperam por ela
let extensionsReady: Promise<void> = Promise.resolve();
const extLoaded = new WeakMap<Electron.Session, Map<string, {id: string; path: string}>>();
const catalogName = (id: string | null) => CATALOG.find(entry => entry.id === id)?.name;
const BLOCKED_PREFIX = 'Bloqueada pela auditoria: ';
const findingText = (finding: AuditFinding) => finding.kind === 'skipped' ? (finding.file ? `${finding.detail} (${finding.file})` : finding.detail) : `${finding.detail} em ${finding.file}`;
const machine = () => ({platform:process.platform, home:app.getPath('home'), localAppData:process.env.LOCALAPPDATA});
type RefreshMode = 'cached' | 'verify' | 'force';
// A auditoria roda assíncrona e é guardada por (pasta, versão, .js com tamanho/mtime): 'verify' só faz stat, 'force' relê.
async function refreshExtensions(mode: RefreshMode = 'verify') {
  const next: ExtState[] = [];
  for (const row of preferences.listExtensions()) {
    const rowCatalog = CATALOG.some(entry => entry.id === row.id) ? row.id : null;
    const path = rowCatalog ? resolveExtensionPath(row.path) : row.path; // o Chrome troca a pasta da versão ao atualizar
    if (path !== row.path) { try { preferences.setExtensionPath(row.id,path); } catch { /* caminho já usado por outra linha: segue com o antigo na lista */ } }
    // privilégios do catálogo (hosts pré-aprovados, /hunt) só quando o caminho REAL está na pasta de extensões de um navegador
    const catalogId = rowCatalog && catalogIdOf(path,machine()) === rowCatalog ? rowCatalog : null;
    const approvedHosts = approvedHostsOf(catalogId ?? '',row.approvedHosts);
    const base = {id:row.id, catalogId, path, enabled:row.enabled, findings:[] as AuditFinding[], hosts:[] as string[], approvedHosts, pending:false};
    const check = checkExtension(path);
    if (!check.ok) { next.push({...base, name:catalogName(catalogId) ?? (path.split(/[\\/]/).filter(Boolean).pop() ?? 'Extensão'), version:null, verdict:'bloqueada' as const, error:check.error, loadable:false}); continue; }
    if (mode === 'force') auditCache.forget(path);
    const audit = await auditCache.get(path,check.version,mode !== 'cached');
    const reasons = [...new Set(audit.findings.filter(finding => finding.kind === 'eval' || finding.kind === 'skipped').map(findingText))].slice(0,3);
    const pending = audit.verdict === 'externa' && !hostsCovered(audit.hosts,approvedHosts); // host novo ou ainda não aprovado: não carrega
    next.push({...base, name:check.name, version:check.version, findings:audit.findings, hosts:audit.hosts, pending, verdict:audit.verdict, error:audit.verdict === 'bloqueada' ? `${BLOCKED_PREFIX}${reasons.join('; ')}.` : null, loadable:audit.verdict !== 'bloqueada' && !pending});
  }
  extensions = next;
  auditCache.prune(next.map(extension => extension.path));
  for (const id of [...extErrors.keys()]) if (!extensions.some(extension => extension.id === id)) extErrors.delete(id);
}
const loadedIn = (session: Electron.Session, extension: ExtState) => {
  const loaded = extLoaded.get(session)?.get(extension.id);
  return Boolean(loaded && loaded.path === extension.path && session.extensions.getExtension(loaded.id));
};
// A lateral "Caçar" só lê o ranking quando a /hunt está carregada nesta sessão.
function hasHunt(session: Electron.Session) {
  const hunt = extensions.find(extension => extension.catalogId === HUNT_ID);
  return Boolean(hunt && hunt.enabled && hunt.loadable && loadedIn(session,hunt));
}
// Revalida logo antes de carregar (stat barato; se algo mudou, audita de novo): fecha a janela entre auditar e carregar.
async function stillAudited(extension: ExtState): Promise<boolean> {
  if (await auditCache.unchanged(extension.path,extension.version)) return true;
  const audit = await auditCache.get(extension.path,extension.version,true);
  if (audit.verdict !== 'bloqueada' && hostsCovered(audit.hosts,extension.approvedHosts)) return true;
  extension.loadable = false;
  return false;
}
// Rede das contas: só o jogo, o login e os hosts aprovados das extensões carregadas nesta sessão; o resto é registrado ou cancelado.
let networkStore: ReturnType<typeof createNetworkPolicyStore>;
const unknownHosts = createUnknownLog();
function installNetworkPolicy(session: Electron.Session, account: string) {
  session.webRequest.onBeforeRequest((details, callback) => {
    try {
      const approved = extensions.filter(extension => extension.enabled && extension.loadable && loadedIn(session,extension)).flatMap(extension => extension.approvedHosts);
      const verdict = decide(details.url,networkStore.policy(),approved);
      if (verdict === 'record') { const host = hostOf(details.url); if (host) unknownHosts.record(account,host); }
      callback({cancel:verdict === 'block'});
    } catch { callback({cancel:networkStore?.policy().mode === 'bloquear'}); }
  });
}
function networkInfo(): NetworkInfo {
  const {mode,allowlist} = networkStore.policy();
  return {mode, allowlist:[...allowlist], unknown:unknownHosts.list(account => store.list().find(profile => profile.id === account)?.label ?? 'Conta removida')};
}
// Deixa a sessão só com as extensões habilitadas e válidas. Nunca rejeita: falha de extensão não pode impedir a sessão de abrir.
function syncExtensions(session: Electron.Session): Promise<void> | null {
  try {
    const wanted = extensions.filter(extension => extension.enabled && extension.loadable);
    const kept = new Map<string, {id: string; path: string}>();
    for (const extension of wanted) if (loadedIn(session,extension)) kept.set(extension.id,extLoaded.get(session)!.get(extension.id)!);
    const keptIds = new Set([...kept.values()].map(loaded => loaded.id));
    for (const extension of session.extensions.getAllExtensions()) if (!keptIds.has(extension.id)) session.extensions.removeExtension(extension.id);
    extLoaded.set(session,kept);
    const pending = wanted.filter(extension => !kept.has(extension.id));
    if (pending.length === 0) return null;
    return (async () => {
      for (const extension of pending) {
        try {
          if (!await stillAudited(extension)) { extErrors.set(extension.id,'A extensão mudou depois da auditoria e não foi carregada. Abra Extensões para auditar de novo.'); continue; }
          const loaded = await session.extensions.loadExtension(extension.path,{allowFileAccess:false}); kept.set(extension.id,{id:loaded.id,path:extension.path}); extErrors.delete(extension.id);
        } catch { extErrors.set(extension.id,'Não foi possível carregar a extensão em uma sessão. A sessão segue aberta sem ela.'); console.error('Falha ao carregar uma extensão.'); }
      }
    })();
  } catch { console.error('Falha ao sincronizar as extensões.'); return null; }
}
function extensionList(): ExtensionInfo[] {
  const contents = [...views.values()].filter(view => !view.webContents.isDestroyed());
  return extensions.map(extension => {
    let loaded = 0;
    for (const view of contents) { try { if (loadedIn(view.webContents.session,extension)) loaded++; } catch { /* sessão encerrando */ } }
    return {id:extension.id, catalogId:extension.catalogId, name:extension.name, version:extension.version, path:extension.path, enabled:extension.enabled, loaded, sessions:contents.length, verdict:extension.verdict, findings:extension.findings, hosts:extension.hosts, approvedHosts:extension.approvedHosts, pending:extension.pending, error:extension.error ?? extErrors.get(extension.id) ?? null};
  });
}
async function applyExtensions(mode: RefreshMode = 'verify'): Promise<ExtensionInfo[]> {
  await refreshExtensions(mode);
  await Promise.all([...views.values()].map(view => view.webContents.isDestroyed() ? null : syncExtensions(view.webContents.session)));
  return extensionList();
}
async function detectExtensions(): Promise<ExtensionInfo[]> {
  for (const found of findInstalled({platform:process.platform, home:app.getPath('home'), localAppData:process.env.LOCALAPPDATA})) {
    if (!checkExtension(found.path).ok) continue;
    const rows = preferences.listExtensions();
    const same = rows.find(row => row.id === found.id);
    if (same) { if (same.path !== found.path && !rows.some(row => row.path === found.path)) preferences.setExtensionPath(found.id,found.path); }
    else if (!rows.some(row => row.path === found.path)) preferences.addExtension({id:found.id,path:found.path,enabled:true});
  }
  return applyExtensions('force');
}
async function addExtension(): Promise<ExtensionInfo[]> {
  const {canceled, filePaths} = await dialog.showOpenDialog(window,{title:'Pasta da extensão (a pasta com o manifest.json)',buttonLabel:'Usar esta pasta',properties:['openDirectory']});
  const path = filePaths[0];
  if (canceled || !path) return applyExtensions('cached');
  const check = checkExtension(path);
  if (!check.ok) throw new ExtensionRefused(check.error);
  const rows = preferences.listExtensions();
  if (rows.some(row => row.path === path)) throw new ExtensionRefused('Essa pasta já está na lista.');
  if (rows.length >= MAX_EXTENSIONS) throw new ExtensionRefused(`O limite é de ${MAX_EXTENSIONS} extensões. Remova alguma antes de adicionar outra.`);
  const catalogId = catalogIdOf(path,machine());
  preferences.addExtension({id:catalogId && !rows.some(row => row.id === catalogId) ? catalogId : randomUUID(),path,enabled:true});
  return applyExtensions('force');
}
class ExtensionRefused extends Error {}
const MAX_EXTENSIONS = 16;
async function invokeExtensions(event: IpcMainInvokeEvent, action: () => ExtensionInfo[] | Promise<ExtensionInfo[]>) {
  if (!trusted(event)) return {ok:false, error:'Origem não autorizada.'};
  if (extBusy) return {ok:false, error:'Aguarde a operação anterior das extensões terminar.'};
  extBusy = true;
  try { return {ok:true, data:await action()}; }
  catch (error) { return {ok:false, error:error instanceof ExtensionRefused ? error.message : 'Não foi possível atualizar as extensões. Tente novamente.'}; }
  finally { extBusy = false; }
}
async function explainBlockedPopup() {
  if (externalNoticeOpen || window.isDestroyed()) return;
  externalNoticeOpen = true;
  try {
    const {response} = await dialog.showMessageBox(window, {
      type:'info', title:'Janela externa bloqueada',
      message:'O jogo tentou abrir uma janela externa. O login do Google pode exigir um navegador.',
      detail:'Você pode entrar com usuário e senha no jogo, quando disponível, ou abrir o site oficial no navegador. A sessão do navegador é separada das sessões do PokéHub.',
      buttons:['Continuar no PokéHub','Abrir site no navegador'], defaultId:0, cancelId:0, noLink:true,
    });
    if (response === 1) await shell.openExternal(gameUrl);
  } catch { if (!window.isDestroyed()) dialog.showErrorBox('PokéHub','Não foi possível abrir o navegador. Acesse https://pokeidle.io/app diretamente.'); }
  finally { externalNoticeOpen = false; }
}
// Retratos das espécies: mesmo endereço público que a extensão /hunt consulta, pedido pela sessão padrão (a do renderer,
// sem login do jogo) e sem cookies. Só números de looktype já validados entram na URL.
const sprites = async (looks: number[]) => {
  const response = await net.fetch(`https://pokeidle.io/tracker/api/sprites?lt=${looks.join(',')}`,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4000)});
  if (!response.ok) throw new Error();
  return readJsonBounded(response); // corpo lido em fluxo, no máximo 64 KB (mesmo sem content-length)
};
const appIndex = join(__dirname,'../../dist/index.html'), appUrl = pathToFileURL(appIndex).href; // a única página que pode chamar o IPC
const trusted = (event: IpcMainInvokeEvent) => Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame && event.senderFrame === window.webContents.mainFrame && isAppFrameUrl(event.senderFrame.url,appUrl));
const accountLock = createAccountLock(); // uma ação por conta: leitura do Market e Loja não se sobrepõem
let wipeQueue: WipeQueue; // apagamento de partições no próximo início (ver partition-wipe.ts)
// Lives em segundo plano (Twitch e Kick, ver twitch.ts): uma loja, uma fila de apagamento e um serviço por plataforma.
const streamWipe: Partial<Record<StreamPlatform, WipeQueue>> = {};
const streamStores: Partial<Record<StreamPlatform, TwitchStore>> = {};
const streams: Partial<Record<StreamPlatform, TwitchService>> = {};
// Lives: ações assíncronas só da janela do PokéHub; a plataforma é validada; recusas trazem a mensagem para a interface.
async function invokeStream(event: IpcMainInvokeEvent, platform: unknown, action: (service: TwitchService) => TwitchInfo | Promise<TwitchInfo>) {
  const service = isPlatform(platform) ? streams[platform] : undefined;
  if (!trusted(event) || !service) return {ok:false, error:'Origem não autorizada.'};
  try { return {ok:true, data:await action(service)}; }
  catch (error) { return {ok:false, error:error instanceof TwitchRefused ? error.message : 'Não foi possível concluir a ação da live. Tente novamente.'}; }
}
function report(id: string, state: string) {
  const changed = statusChanged(states.get(id),state);
  states.set(id,state);
  if (changed) refreshTray.call();
  if (changed && !window.isDestroyed()) window.webContents.send('session:status', {id,state});
  if (changed) remote?.publish('state',{accounts:remoteAccounts()});
  if (changed) remote?.reportState(id,state); // "conta caiu/voltou" (alertas do acesso remoto)
}
const remoteAccounts = () => store.list().map(p => ({id:p.id, label:p.label, color:p.colorToken, state:states.get(p.id) ?? 'loading', suspended:suspended.has(p.id)}));
// View oculta fora da área da janela, com o mesmo tamanho: no Electron 44 uma WebContentsView com setVisible(false) ainda
// recebia o mouse (o Gerenciar e a lateral ficavam sem clique). Fora da tela ela segue desenhando/capturável (R5) sem cobrir a interface.
const PARK_X = -32000;
function parkView(view: WebContentsView, size?: {width: number; height: number} | null) {
  try { const b = view.getBounds(); const w = size?.width ?? b.width, h = size?.height ?? b.height; if (b.x !== PARK_X || b.width !== w || b.height !== h) view.setBounds({x:PARK_X, y:0, width:w, height:h}); } catch { /* view fechando */ }
}
function arrange() {
  const profiles = store.list();
  if (!profiles.length) {
    if (autoFocused !== null) { autoFocused = null; if (!window.isDestroyed()) window.webContents.send('workspace:auto-focus', null); }
    return;
  }
  const [width = 0, height = TOP_BAR] = window.getContentSize();
  const index = focused === null ? null : profiles.findIndex(p => p.id === focused);
  const side = sideWidth(width, sideOpen, sidePanel);
  const preferred = sideOpen && sideAccount ? profiles.findIndex(p => p.id === sideAccount) : -1;
  const effective = effectiveFocus(width, height, profiles.length, index !== null && index >= 0 ? index : null, side, Math.max(preferred,0));
  const nextAuto = effective.automatic ? profiles[effective.index ?? 0]?.id ?? null : null;
  if (nextAuto !== autoFocused) { autoFocused = nextAuto; if (!window.isDestroyed()) window.webContents.send('workspace:auto-focus', nextAuto); }
  const bounds = layout(width, Math.max(height,TOP_BAR), profiles.length, effective.index, side);
  const muting = perf.lite || perf.muteUnfocused;
  profiles.forEach((profile,i) => {
    const view = views.get(profile.id); const b = bounds[i];
    if (!view) return;
    const show = !editing && !dragging && Boolean(b);
    view.setVisible(show); if (show && b) view.setBounds(b); else parkView(view,b);
    const muted = audioMuted(muting,!editing && Boolean(b)); // som só na conta visível (em foco); o arrasto não muda o som
    if (!view.webContents.isDestroyed() && mutedState.get(view.webContents) !== muted) { mutedState.set(view.webContents,muted); try { view.webContents.setAudioMuted(muted); } catch { /* sessão encerrando */ } }
  });
}
// Durante o resize o layout é refeito no máximo a cada ~33 ms, e sempre uma última vez ao parar.
function arrangeSoon() {
  if (resizeTimer) { resizePending = true; return; }
  arrange();
  resizeTimer = setTimeout(() => { resizeTimer = undefined; if (resizePending) { resizePending = false; try { if (!window.isDestroyed()) arrange(); } catch { console.error('Falha ao reorganizar as sessões.'); } } },RESIZE_THROTTLE_MS);
}
function setDrag(active: boolean) {
  clearTimeout(dragTimer);
  dragging = active;
  if (!active) { arrange(); return; }
  // se o renderer nunca avisar o fim (travou, recarregou), as sessões voltam sozinhas
  dragTimer = setTimeout(() => { try { if (!window.isDestroyed()) setDrag(false); } catch { console.error('Falha ao restaurar as sessões após o arrasto.'); } }, DRAG_FAILSAFE_MS);
  for (const view of views.values()) { try { view.setVisible(false); parkView(view); } catch { /* sessão encerrando */ } }
}
function registerShortcuts(contents: Electron.WebContents, profileId: string | null = null) {
  contents.on('before-input-event', (event, input) => {
    // Ctrl+Shift+Enter: expande a conta (a da view que recebeu a tecla) ou volta à grade; a interface decide
    if (isExpandShortcut(input)) { event.preventDefault(); if (!window.isDestroyed()) window.webContents.send('workspace:toggle-expand',profileId); return; }
    if (isSideShortcut(input)) { event.preventDefault(); if (!window.isDestroyed()) window.webContents.send('workspace:toggle-side'); return; } // a interface decide se a lateral pode abrir
    if (editing || resetting.size > 0 || shortcutIndex(input) === undefined) return;
    try {
      const target = shortcutFocus(input, store.list().map(profile => profile.id));
      if (target === undefined) return;
      event.preventDefault();
      focused = target; arrange();
      if (!window.isDestroyed()) window.webContents.send('workspace:focus', target);
    } catch { console.error('Não foi possível alterar o foco.'); }
  });
}
function addView(id: string) {
  const view = new WebContentsView({webPreferences:{partition:partitionFor(id), sandbox:true, contextIsolation:true, nodeIntegration:false, spellcheck:false, devTools:!app.isPackaged, ...SAFE_DIALOGS}});
  huntDocuments.set(view.webContents, {});
  let attached = false;
  let atProvider = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const reportCurrent = (state: string) => {
    if (views.get(id) !== view || window.isDestroyed()) return;
    report(id,state);
    if (state === 'ready') attempt = 0;
    if (state !== 'offline' || retry) return;
    const delay = offlineRetryDelay(attempt);
    if (delay === null) return;
    attempt++;
    retry = setTimeout(() => { retry = undefined; if (views.get(id) === view && !resetting.has(id) && !view.webContents.isDestroyed() && states.get(id) === 'offline') view.webContents.reload(); }, delay);
  };
  mountSessionView({
    configure: () => {
      registerShortcuts(view.webContents,id);
      view.webContents.setWindowOpenHandler(() => { void explainBlockedPopup(); return {action:'deny'}; });
      lockSession(view.webContents.session); // sem downloads e sem permissões
      installNetworkPolicy(view.webContents.session,id);
      // durante o controle remoto a conta só navega em pokeidle.io (nada de login do Google/Discord pelo celular)
      installNavigationLock(view.webContents,{id, controlling:key => remote?.controlling(key) ?? false, allowedSession:isAllowedSessionNavigation, allowedGame:isAllowedGameUrl, gameUrl, onViolation:key => { remote?.endControlOf(key,'navegacao'); }}); // will-navigate/redirect/frame-navigate + volta ao jogo se a página sair dele durante o controle
      view.webContents.once('destroyed', () => clearTimeout(retry));
      view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) huntDocuments.set(view.webContents, {}); });
      view.webContents.on('did-start-loading', () => { if (isMainFrameLoading(view.webContents.isLoadingMainFrame())) reportCurrent('loading'); }); // subframe não reabre o "carregando"
      view.webContents.on('did-navigate', (_event, url) => { atProvider = isOAuthProviderUrl(url); if (atProvider) reportCurrent('auth_required'); });
      const loaded = () => { if (states.get(id) === 'loading') reportCurrent(atProvider ? 'auth_required' : 'ready'); };
      view.webContents.on('did-finish-load', loaded);
      // subframe ou navegação abortada reabrem o "carregando" sem novo did-finish-load do frame principal: sem isto o estado ficava preso
      view.webContents.on('did-stop-loading', loaded);
      view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame) { const state = classifyLoadFailure(code); if (state) reportCurrent(state); } });
      view.webContents.on('render-process-gone', () => reportCurrent('error'));
    },
    attach: () => { window.contentView.addChildView(view); attached = true; views.set(id,view); },
    dispose: () => { clearTimeout(retry); try { if (attached) window.contentView.removeChildView(view); } finally { if (!view.webContents.isDestroyed()) view.webContents.close(); } },
  });
  const load = () => {
    if (views.get(id) !== view || view.webContents.isDestroyed()) return; // sessão fechada enquanto a extensão carregava
    void view.webContents.loadURL(gameUrl).catch((error: unknown) => { const state = classifyLoadRejection(error); if (state && states.get(id) !== 'offline' && states.get(id) !== 'error') reportCurrent(state); });
  };
  const start = () => {
    if (views.get(id) !== view || view.webContents.isDestroyed()) return;
    const pending = syncExtensions(view.webContents.session); // content scripts em document_start exigem a extensão antes do loadURL
    if (pending) void pending.then(load); else load();
  };
  if (extensionsLoaded) start(); else void extensionsReady.then(start); // a auditoria inicial roda em segundo plano; a interface já está de pé
}
function closeView(id: string) {
  const view = views.get(id); if (!view) return;
  views.delete(id); states.delete(id);
  try { window.contentView.removeChildView(view); } finally { if (!view.webContents.isDestroyed()) view.webContents.close(); }
}
async function closeViewAwaited(id: string) {
  const view = views.get(id); if (!view) return;
  window.contentView.removeChildView(view);
  try {
    await closeContents(view.webContents);
    if (views.get(id) === view) { views.delete(id); states.delete(id); }
  } catch (error) {
    if (view.webContents.isDestroyed()) {
      if (views.get(id) === view) { views.delete(id); states.delete(id); }
      if (!window.isDestroyed()) report(id,'error');
    } else if (!window.isDestroyed()) {
      try { window.contentView.addChildView(view); arrange(); } catch { console.error('Falha ao restaurar uma sessão.'); }
    }
    throw error;
  }
}
function openView(id: string) {
  return openSessionSafely(id, {open: addView, cleanup: closeView, cleanupFailed: () => console.error('Falha ao liberar uma sessão.'), failed: sessionId => report(sessionId,'error')});
}
function invoke<T>(event: IpcMainInvokeEvent, action: () => T) {
  if (!trusted(event)) return {ok:false, error:'Origem não autorizada.'};
  try { return {ok:true,data:action()}; } catch { return {ok:false,error:'Não foi possível concluir a operação. Confira os dados e tente novamente.'}; }
}
// Página de uma conta pronta para leitura (ranking do /hunt); null se a sessão não está utilizável.
function readable(profileId: string): Electron.WebContents | null {
  const view = views.get(profileId);
  if (!view || view.webContents.isDestroyed() || resetting.has(profileId)) return null;
  return canReadHunt(states.get(profileId), view.webContents.isLoadingMainFrame()) ? view.webContents : null;
}
let metricsAt = -Infinity, metricsReads = 0, metricsList: ReturnType<typeof app.getAppMetrics> = [];
function readMetrics() {
  const now = performance.now();
  if (now - metricsAt >= 1000) { metricsList = app.getAppMetrics(); metricsAt = now; metricsReads++; }
  return {list:metricsList, first:metricsReads <= 1};
}
if (process.platform === 'win32') app.setAppUserModelId('local.pokehub.desktop'); // a barra de tarefas usa o ícone do app (mesmo appId do electron-builder)
// Bandeja: a janela some, as sessões continuam vivas (views intactas); só o ícone fica nos ícones ocultos.
// Ações de conta compartilhadas: o IPC do PC e o acesso remoto (celular, com PIN e "Pode agir") chamam exatamente as mesmas funções.
const SUSPEND_FAILED = 'Não foi possível suspender a conta.';
function reloadAccount(id: unknown) { if (typeof id !== 'string' || resetting.has(id) || !views.has(id)) throw new Error(); views.get(id)?.webContents.reload(); }
async function suspendAccount(id: unknown): Promise<{ok:true;data:undefined} | {ok:false;error:string}> {
  if (typeof id !== 'string' || resetting.has(id) || suspended.has(id) || !views.has(id) || !store.list().some(profile => profile.id === id)) return {ok:false,error:SUSPEND_FAILED};
  resetting.add(id); suspended.add(id);
  try {
    await closeViewAwaited(id);
    if (!window.isDestroyed()) { report(id,'suspended'); arrange(); }
    refreshTray.call();
    return {ok:true,data:undefined};
  } catch { suspended.delete(id); return {ok:false,error:SUSPEND_FAILED}; }
  finally { resetting.delete(id); }
}
function resumeAccount(id: unknown) {
  if (typeof id !== 'string' || resetting.has(id) || !suspended.has(id) || !store.list().some(profile => profile.id === id)) throw new Error();
  suspended.delete(id);
  if (!openView(id)) { suspended.add(id); throw new Error(); }
  report(id,'loading'); arrange(); refreshTray.call();
}
function setLiteMode(lite: boolean): boolean {
  try { perf = preferences.setPerformance({lite}); arrange(); updateTray(); if (!window.isDestroyed()) window.webContents.send('performance:changed',perf); return true; } catch { console.error('Falha ao salvar o Modo leve.'); return false; }
}
function showWindow() {
  if (!window || window.isDestroyed()) return;
  ghost?.reveal(); // se a janela estava "fantasma" (alguém assistindo), volta a ser a janela de verdade
  try { updater?.checkIfStale(); } catch { /* atualizador indisponível */ } // reabriu pela bandeja: confere atualização se a última verificação é antiga
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function hideToTray() {
  if (!tray || window.isDestroyed()) return;
  window.hide();
  if (trayPrefs.hintShown) return;
  try { trayPrefs = preferences.setTray({hintShown:true}); } catch { console.error('Falha ao salvar o aviso da bandeja.'); }
  try {
    if (process.platform === 'win32') tray.displayBalloon({title:'PokéHub', content:TRAY_HINT, iconType:'info'});
    else if (Notification.isSupported()) new Notification({title:'PokéHub', body:TRAY_HINT}).show();
  } catch { console.error('Falha ao mostrar o aviso da bandeja.'); }
}
function updateTray() {
  if (!tray || tray.isDestroyed() || !store) return;
  remote?.updatePower();
  try {
    const profiles = store.list();
    tray.setToolTip(trayTooltip(runningCount(profiles,states)) + (remote?.screenTooltip() ?? '')); // + "tela remota: celular em conta" enquanto alguém vê/controla
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems({
      profiles, states, lite:perf.lite, open:showWindow, quit:() => app.quit(),
      remote:remote ? {enabled:remote.enabled(), toggle:() => { void remote?.setEnabled(!remote.enabled()).catch(() => console.error('Falha ao alternar o acesso remoto.')).finally(() => { refreshTray.call(); if (!window.isDestroyed()) window.webContents.send('remote:changed'); }); }} : undefined,
      focus:id => { showWindow(); if (window.isDestroyed() || !store.list().some(profile => profile.id === id)) return; focused = id; arrange(); window.webContents.send('workspace:focus',id); },
      setLite:lite => { setLiteMode(lite); },
    })));
  } catch { console.error('Falha ao atualizar a bandeja.'); }
}
function createTray() {
  try {
    const icon = nativeImage.createFromPath(join(__dirname,'../../build/icon.png')).resize({width:trayIconSize(process.platform)});
    tray = new Tray(icon);
    tray.on('click',showWindow);
    updateTray();
  } catch { tray = null; console.error('Não foi possível criar o ícone da bandeja.'); }
}
const smoke = smokeConfig(); // só com POKEHUB_SMOKE=1 + pasta temporária existente; ver smoke.ts
if (smoke) app.setPath('userData',smoke.dir);
// Build instalado não aceita depuração remota/inspetor (qualquer processo local poderia ler as sessões).
const debugBlocked = app.isPackaged && dangerousSwitches(name => app.commandLine.hasSwitch(name)).length > 0;
if (debugBlocked) app.quit();
const primary = !debugBlocked && acquireSingleInstance(app, showWindow);
if (primary) app.whenReady().then(() => {
  restrictUserData(app.getPath('userData'));
  wipeQueue = createWipeQueue(join(app.getPath('userData'),'pending-wipes.json'));
  try { runPendingWipes(app.getPath('userData'),wipeQueue); } catch { console.error('Falha ao apagar dados de sessões removidas.'); } // ANTES de qualquer sessão existir
  for (const [platform,file,prefix] of [['twitch','pending-twitch-wipes.json',TWITCH_PREFIX],['kick','pending-kick-wipes.json',KICK_PREFIX]] as const) {
    streamWipe[platform] = createWipeQueue(join(app.getPath('userData'),file));
    try { runPendingWipes(app.getPath('userData'),streamWipe[platform]!,undefined,prefix); } catch { console.error('Falha ao apagar sessões de live removidas.'); }
  }
  guardNewContents(app);
  lockSession(session.defaultSession);
  const databasePath = join(app.getPath('userData'),'pokehub.sqlite');
  store = new ProfileStore(databasePath);
  preferences = new PreferencesStore(databasePath);
  for (const platform of ['twitch','kick'] as const) streamStores[platform] = new TwitchStore(databasePath,platform);
  networkStore = createNetworkPolicyStore(join(app.getPath('userData'),'network-policy.json'));
  perf = preferences.getPerformance();
  trayPrefs = preferences.getTray();
  focused = initialFocus(perf.lite ? 'focus-first' : preferences.getStartupMode(), store.list().map(profile => profile.id)); // Modo leve começa em Foco
  window = new BrowserWindow({title:'PokéHub',icon:join(__dirname,'../../build/icon.png'),backgroundColor:'#0f1218',...windowChrome(process.platform),width:1280,height:800,minWidth:700,minHeight:480,webPreferences:{preload:join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false,devTools:!app.isPackaged}});
  if (process.platform !== 'darwin') window.removeMenu(); // no macOS o menu fica na barra do sistema e mantém copiar/colar
  updater = createUpdater({autoCheck:() => preferences.getAutoUpdateCheck(), onStatus:status => { if (!window.isDestroyed()) window.webContents.send('update:status',status); }});
  registerShortcuts(window.webContents);
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window,{type:'question',title:'Alterações não salvas',message:'Há alterações não salvas ou uma operação em andamento. Deseja sair mesmo assim?',buttons:['Continuar no PokéHub','Sair mesmo assim'],defaultId:0,cancelId:0,noLink:true});
    if (choice === 1) event.preventDefault(); else quitting = false; // ficou: o próximo fechar volta a seguir a bandeja
  });
  ipcMain.handle('profiles:list', event => invoke(event, () => store.list()));
  ipcMain.handle('preferences:get', event => invoke(event, () => preferences.getStartupMode()));
  ipcMain.handle('preferences:set', (event,mode: unknown) => invoke(event, () => preferences.setStartupMode(mode)));
  ipcMain.handle('performance:get', event => invoke(event, () => preferences.getPerformance()));
  ipcMain.handle('performance:set', (event,value: unknown) => invoke(event, () => { perf = preferences.setPerformance(value); arrange(); refreshTray.call(); return perf; }));
  const winState = () => ({maximized:window.isMaximized(), focused:window.isFocused()});
  const pushWinState = () => { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('window:state',winState()); };
  ipcMain.handle('window:state', event => invoke(event, winState));
  ipcMain.handle('window:minimize', event => invoke(event, () => { window.minimize(); }));
  ipcMain.handle('window:toggleMaximize', event => invoke(event, () => { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }));
  ipcMain.handle('window:close', event => invoke(event, () => { window.close(); })); // passa pelo evento 'close': a bandeja continua valendo
  for (const name of ['maximize','unmaximize','focus','blur','restore'] as const) window.on(name as 'focus', pushWinState);
  ipcMain.handle('tray:get', event => invoke(event, () => trayPrefs));
  ipcMain.handle('tray:set', (event,value: unknown) => invoke(event, () => { trayPrefs = preferences.setTray(value); return trayPrefs; }));
  ipcMain.handle('extensions:list', event => invokeExtensions(event, () => applyExtensions('verify')));
  ipcMain.handle('extensions:detect', event => invokeExtensions(event, detectExtensions));
  ipcMain.handle('extensions:add', event => invokeExtensions(event, addExtension));
  ipcMain.handle('extensions:toggle', (event,id: unknown,enabled: unknown) => invokeExtensions(event, () => { if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error(); preferences.setExtensionEnabled(id,enabled); return applyExtensions('cached'); }));
  ipcMain.handle('extensions:remove', (event,id: unknown) => invokeExtensions(event, () => { if (typeof id !== 'string') throw new Error(); preferences.removeExtension(id); return applyExtensions('cached'); }));
  // aprova os hosts externos que a auditoria acha AGORA; `hosts` (o que a tela mostrou) precisa ser o mesmo conjunto
  ipcMain.handle('extensions:approve', (event,id: unknown,hosts: unknown) => invokeExtensions(event, async () => {
    if (typeof id !== 'string' || (hosts !== undefined && (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')))) throw new Error();
    await refreshExtensions('verify');
    const extension = extensions.find(item => item.id === id);
    if (!extension || extension.verdict !== 'externa' || extension.hosts.length === 0) throw new ExtensionRefused('Esta extensão não precisa de aprovação.');
    const shown = hosts as string[] | undefined;
    if (shown && (shown.length !== extension.hosts.length || shown.some(host => !extension.hosts.includes(host)))) throw new ExtensionRefused('A extensão mudou desde a última leitura. Revise os sites e tente de novo.');
    preferences.setApprovedHosts(id,extension.hosts);
    return applyExtensions();
  }));
  for (const platform of ['twitch','kick'] as const) streams[platform] = createTwitchService({platform:PLATFORMS[platform], store:streamStores[platform]!, profiles:() => store.list(), iconPath:join(__dirname,'../../build/icon.png'), devTools:!app.isPackaged, emit:info => { if (!window.isDestroyed()) window.webContents.send('stream:changed',info); }, wipe:id => { streamWipe[platform]!.add(id); }, quitting:() => quitting});
  ipcMain.handle('stream:get', (event,platform: unknown) => invokeStream(event, platform, service => service.info()));
  ipcMain.handle('stream:channel', (event,platform: unknown,value: unknown) => invokeStream(event, platform, service => service.setChannel(value)));
  ipcMain.handle('stream:link', (event,platform: unknown,id: unknown) => invokeStream(event, platform, service => service.link(id)));
  ipcMain.handle('stream:unlink', (event,platform: unknown,id: unknown) => invokeStream(event, platform, service => service.unlink(id)));
  ipcMain.handle('stream:update', (event,platform: unknown,id: unknown,patch: unknown) => invokeStream(event, platform, service => service.update(id,patch)));
  ipcMain.handle('stream:show', (event,platform: unknown,id: unknown) => invokeStream(event, platform, service => service.show(id)));
  ipcMain.handle('stream:hide', (event,platform: unknown,id: unknown) => invokeStream(event, platform, service => service.hide(id)));
  ipcMain.handle('stream:rewards', (event,platform: unknown,id: unknown) => invokeStream(event, platform, service => service.rewards(id)));
  ipcMain.handle('network:get', event => invoke(event, networkInfo));
  ipcMain.handle('network:mode', (event,mode: unknown) => invoke(event, () => { networkStore.setMode(mode); return networkInfo(); }));
  ipcMain.handle('network:allow', (event,host: unknown) => invoke(event, () => { unknownHosts.forget(networkStore.allow(host)); return networkInfo(); }));
  ipcMain.handle('network:disallow', (event,host: unknown) => invoke(event, () => { networkStore.disallow(host); return networkInfo(); }));
  ipcMain.handle('extensions:store', async (event,id: unknown) => { // só as lojas do catálogo, por id: o renderer nunca envia URL
    const entry = CATALOG.find(item => item.id === id);
    if (!trusted(event) || !entry) return {ok:false,error:'Extensão desconhecida.'};
    try { await shell.openExternal(entry.store); return {ok:true,data:undefined}; } catch { return {ok:false,error:'Não foi possível abrir o navegador.'}; }
  });
  const updateInfo = (): UpdateInfo => ({version:app.getVersion(), packaged:app.isPackaged === true, autoCheck:preferences.getAutoUpdateCheck(), status:updater.status()});
  ipcMain.handle('update:get', event => invoke(event, updateInfo));
  ipcMain.handle('update:auto', (event,enabled: unknown) => invoke(event, () => { preferences.setAutoUpdateCheck(enabled); return updateInfo(); }));
  ipcMain.handle('update:check', async event => { if (!trusted(event)) return {ok:false,error:'Origem não autorizada.'}; await updater.check(true); return {ok:true,data:updateInfo()}; });
  ipcMain.handle('update:download', async event => { if (!trusted(event)) return {ok:false,error:'Origem não autorizada.'}; await updater.download(); return {ok:true,data:updateInfo()}; });
  ipcMain.handle('update:install', event => invoke(event, () => { if (!updater.install()) throw new Error(); }));
  ipcMain.handle('workspace:initial-focus', event => invoke(event, () => focused));
  ipcMain.handle('profiles:create', (event,input: ProfileInput) => invoke(event, () => { const profile = store.create(input); openView(profile.id); arrange(); refreshTray.call(); return profile; }));
  ipcMain.handle('profiles:update', (event,id: unknown,input: ProfileInput) => invoke(event, () => { if (typeof id !== 'string') throw new Error(); const profile = store.update(id,input); refreshTray.call(); return profile; }));
  ipcMain.handle('profiles:remove', async (event,id: unknown,wipe: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível remover o perfil.'};
    resetting.add(id);
    try {
      if (!store.list().some(profile => profile.id === id)) throw new Error();
      await closeViewAwaited(id);
      try { store.remove(id); } catch (error) { if (!window.isDestroyed()) openView(id); throw error; }
      suspended.delete(id);
      for (const service of Object.values(streams)) service.removeProfile(id); // as contas de live vinculadas saem junto (o vínculo some em cascata; a sessão é apagada no próximo início)
      if (wipe !== false) wipeQueue.add(id); // apaga o login em disco no próximo início (a pasta fica em uso até lá)
      if (focused === id) focused = null;
      refreshTray.call();
      if (!window.isDestroyed()) arrange();
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'Não foi possível remover o perfil. Verifique o estado e tente novamente.'}; }
    finally { resetting.delete(id); }
  });
  ipcMain.handle('profiles:orphans', event => invoke(event, () => ({count:findOrphans(app.getPath('userData'),store.list().map(profile => profile.id),wipeQueue).length})));
  ipcMain.handle('profiles:wipeOrphans', event => invoke(event, () => ({queued:findOrphans(app.getPath('userData'),store.list().map(profile => profile.id),wipeQueue).filter(id => wipeQueue.add(id)).length})));
  const huntTarget = (profileId: string): HuntTarget | null => {
      const contents = readable(profileId);
      if (!contents) return null;
      return {identity:huntDocuments.get(contents) ?? contents, url:contents.getURL(), hasExtension:hasHunt(contents.session), version:extensions.find(extension => extension.catalogId === HUNT_ID)?.version ?? null, run:script => contents.executeJavaScript(script), sprites};
    };
  const remoteApi = createRemoteApi({profiles:() => store.list(), states, suspended, hunt:(id,soLiberadas) => huntFor(id,soLiberadas), scan:id => scanFor(id), processes:() => processesSample()});
  const huntFor = (id: unknown, soLiberadas: unknown = true) => huntSnapshot(id, store.list().map(profile => profile.id), huntTarget, undefined, soLiberadas);
  // "Quem colocar em campo?": equipe + 3 mais fortes da coleção com o cálculo da /hunt (ver team-pick.ts).
  ipcMain.handle('hunt:team', async (event,id: unknown,force: unknown = false) => trusted(event) ? teamPick(id, store.list().map(profile => profile.id), huntTarget, force) : {ok:false,error:HUNT_UNAVAILABLE});
  // Tipagem do dia: a cada 10 min confere cada conta com a /hunt; avisa uma vez por dia e por conta, só se houver Pokémon do tipo.
  const dayFile = join(app.getPath('userData'),'tipagem-avisada.json');
  let dayNotified: {chave: string; contas: string[]} = {chave:'', contas:[]};
  try { const raw = JSON.parse(readFileSync(dayFile,'utf8')) as {chave?: unknown; contas?: unknown}; if (typeof raw.chave === 'string' && Array.isArray(raw.contas)) dayNotified = {chave:raw.chave.slice(0,20), contas:raw.contas.filter((item): item is string => typeof item === 'string').slice(0,8)}; } catch { /* primeira vez */ }
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  const checkDayType = async () => {
    try {
      if (!preferences.getDayTypeNotify() || !Notification.isSupported()) return;
      for (const profile of store.list()) {
        const target = huntTarget(profile.id);
        if (!target || !target.hasExtension) continue;
        const day = sanitizeDayType(await timedRun(target.run(DAY_TYPE_SCRIPT)));
        if (!day) continue;
        if (dayNotified.chave !== day.chave) dayNotified = {chave:day.chave, contas:[]};
        if (dayNotified.contas.includes(profile.id)) continue;
        dayNotified.contas.push(profile.id);
        try { writeFileSync(dayFile,JSON.stringify(dayNotified)); } catch { /* só não lembra entre reinícios */ }
        const notice = dayTypeNotice(day.tipo,profile.label,day.equipe,day.colecao);
        if (notice) { try { new Notification(notice).show(); } catch { /* sem notificações */ } }
      }
    } catch { console.error('Falha ao conferir a tipagem do dia.'); }
    finally { dayTimer = setTimeout(() => void checkDayType(),10 * 60_000); }
  };
  const timedRun = (work: Promise<unknown>) => Promise.race([work,new Promise<null>(resolve => setTimeout(() => resolve(null),6000))]).catch(() => null);
  dayTimer = setTimeout(() => void checkDayType(),45_000);
  app.on('before-quit', () => clearTimeout(dayTimer));
  // Lembretes de prazo (VIP, boosts da guild, bônus Twitch/Kick): ver deadlines.ts.
  const notifyPc = (title: string, body: string) => { try { if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.displayBalloon({title,content:body,iconType:'info'}); else if (Notification.isSupported()) new Notification({title,body}).show(); } catch { /* sem notificações */ } };
  const deadlines = createDeadlines({known:() => store.list().map(profile => ({id:profile.id, label:profile.label})), target:id => marketTarget(id), // marketTarget é declarado mais abaixo; só é chamado no primeiro ciclo (30 s)
    enabled:() => preferences.getDeadlineNotify(), lite:() => perf.lite, file:join(app.getPath('userData'),'prazos-avisados.json'), notify:notifyPc, emit:all => { if (!window.isDestroyed()) window.webContents.send('deadlines:changed',all); }});
  deadlines.start();
  app.on('before-quit', () => deadlines.stop());
  ipcMain.handle('deadlines:get', event => invoke(event, () => deadlines.all()));
  ipcMain.handle('deadlines:refresh', event => invoke(event, () => { deadlines.refresh(); }));
  ipcMain.handle('deadlines:notify', event => invoke(event, () => preferences.getDeadlineNotify()));
  ipcMain.handle('deadlines:setNotify', (event,value: unknown) => invoke(event, () => preferences.setDeadlineNotify(value)));
  ipcMain.handle('daytype:notify', event => invoke(event, () => preferences.getDayTypeNotify()));
  ipcMain.handle('daytype:setNotify', (event,value: unknown) => invoke(event, () => preferences.setDayTypeNotify(value)));
  ipcMain.handle('hunt:snapshot', async (event,id: unknown,soLiberadas: unknown = true) => {
    if (!trusted(event)) return {ok:false,error:HUNT_UNAVAILABLE};
    return huntFor(id,soLiberadas);
  });
  const scanFor = (id: unknown) => marketScan(id, store.list().map(profile => profile.id), marketTarget);
  ipcMain.handle('market:scan', async (event,id: unknown) => {
    if (!trusted(event)) return {ok:false,error:MARKET_UNAVAILABLE};
    const result = await scanFor(id);
    if (result.ok && typeof id === 'string') remoteApi.feed(id,result.data);
    return result;
  });
  // Market, Loja e Capturas só leem/clicam no DOM: rodam no mundo isolado (999), sem acesso aos globais da página.
  const marketTarget = (profileId: string) => { const contents = readable(profileId); return contents ? {url:contents.getURL(), run:(script: string) => contents.executeJavaScriptInIsolatedWorld(999,[{code:script}])} : null; };
  const marketReader = createMarketReader({known:() => store.list().map(profile => profile.id), target:marketTarget, lock:accountLock, emit:progress => { if (progress.scan) remoteApi.feed(progress.profileId,progress.scan); if (!window.isDestroyed()) window.webContents.send('market:progress',progress); }});
  // Selos de custo-benefício nos cards do RMT (ver market-badges.ts): ligados por padrão, desligáveis na aba Mercado.
  // Alertas do RMT: avisos recentes só em memória (últimos 30); a notificação do sistema sai uma vez por anúncio e alerta.
  const alertHits: MarketAlertHit[] = [];
  const coinName = (currency: string | null) => currency === 'orb' ? 'Gemas' : currency === 'gold' ? 'Coins' : '';
  const onAlertHits = (hits: MarketAlertHit[]) => {
    alertHits.unshift(...hits); alertHits.splice(30);
    if (!window.isDestroyed()) window.webContents.send('market:alertHit',hits);
    if (!Notification.isSupported()) return;
    const alerts = preferences.listMarketAlerts();
    for (const hit of hits.slice(0,3)) {
      const alert = alerts.find(item => item.id === hit.alertId), l = hit.listing;
      const conta = store.list().find(profile => profile.id === hit.profileId)?.label ?? 'Conta';
      const detalhe = [l.shiny ? 'Shiny' : '', l.level !== null ? `Nv ${l.level}` : '', l.potencia !== null ? `P${l.potencia}` : '', l.nota !== null ? `nota ${l.nota.toLocaleString('pt-BR')}` : ''].filter(Boolean).join(' · ');
      try { new Notification({title:`Alerta do RMT · ${conta}`, body:`${l.name}${detalhe ? ` (${detalhe})` : ''} por ${l.price.toLocaleString('pt-BR')} ${coinName(l.currency)}${alert ? `
Regra: ${alertLabel(alert)}` : ''}`}).show(); } catch { /* sem notificações no sistema */ }
    }
  };
  const marketBadges = createMarketBadges({known:() => store.list().map(profile => profile.id), target:marketTarget, enabled:() => preferences.getMarketBadges(), lite:() => perf.lite, visible:() => !window.isDestroyed() && window.isVisible() && !window.isMinimized(), alerts:() => preferences.listMarketAlerts(), onHit:onAlertHits});
  const alertsInfo = () => ({alerts:preferences.listMarketAlerts(), hits:alertHits.slice()});
  ipcMain.handle('market:alerts', event => invoke(event, alertsInfo));
  ipcMain.handle('market:saveAlert', (event,id: unknown,input: unknown) => {
    if (!trusted(event)) return {ok:false,error:'Origem não autorizada.'};
    try { preferences.saveMarketAlert(typeof id === 'string' && id ? id : randomUUID(),input); marketBadges.refresh(); return {ok:true,data:alertsInfo()}; }
    catch (error) { const msg = (error as Error).message; return {ok:false,error:msg === 'Limite de alertas' ? 'O limite é de 20 alertas. Remova algum antes.' : msg === 'Preço exige a moeda' ? 'Para usar preço máximo, escolha a moeda (Gemas ou Coins).' : msg === 'Alerta vazio' ? 'Defina pelo menos um critério: nome, preço, nota, potência ou shiny.' : 'Alerta inválido. Confira os campos.'}; }
  });
  ipcMain.handle('market:removeAlert', (event,id: unknown) => invoke(event, () => { preferences.removeMarketAlert(id); marketBadges.refresh(); return alertsInfo(); }));
  marketBadges.start();
  app.on('before-quit', () => marketBadges.stop());
  // Análise "Para caçar" na ficha do Pokémon (ver ficha-review.ts): ligada por padrão, desligável em Gerenciar → Layout.
  const fichaReview = createFichaReview({known:() => store.list().map(profile => profile.id), target:marketTarget, enabled:() => preferences.getFichaReview(), lite:() => perf.lite, visible:() => !window.isDestroyed() && window.isVisible() && !window.isMinimized()});
  fichaReview.start();
  window.on('show', () => fichaReview.refresh()); window.on('restore', () => fichaReview.refresh());
  app.on('before-quit', () => fichaReview.stop());
  ipcMain.handle('ficha:review', event => invoke(event, () => preferences.getFichaReview()));
  ipcMain.handle('ficha:setReview', (event,value: unknown) => invoke(event, () => { const on = preferences.setFichaReview(value); fichaReview.refresh(); return on; }));
  ipcMain.handle('market:badges', event => invoke(event, () => preferences.getMarketBadges()));
  ipcMain.handle('market:setBadges', (event,value: unknown) => invoke(event, () => { const on = preferences.setMarketBadges(value); marketBadges.refresh(); return on; }));
  ipcMain.handle('market:readAll', async (event,id: unknown) => trusted(event) ? marketReader.readAll(id) : {ok:false,error:MARKET_UNAVAILABLE});
  ipcMain.handle('market:stop', (event,id: unknown) => trusted(event) ? {ok:true,data:marketReader.stop(id)} : {ok:false,error:MARKET_UNAVAILABLE});
  // Loja rápida (Market do jogo): leitura/compra só a pedido da janela do PokéHub, depois da confirmação do usuário (ver spike/electron/shop.ts).
  let remoteShopProgress: ((progress: ShopProgress) => void) | null = null; // compra pedida pelo celular: o progresso vai para ele (SSE), não para a tela do PC
  const shop = createShop({known:() => store.list().map(profile => profile.id), target:marketTarget, lock:accountLock, emit:progress => { if (remoteShopProgress) remoteShopProgress(progress); else if (!window.isDestroyed()) window.webContents.send('shop:progress',progress); }});
  ipcMain.handle('shop:read', async (event,id: unknown) => trusted(event) ? shop.read(id) : {ok:false,error:SHOP_UNAVAILABLE});
  ipcMain.handle('shop:run', async (event,plan: unknown) => trusted(event) ? shop.run(plan) : {ok:false,error:SHOP_UNAVAILABLE});
  ipcMain.handle('shop:stop', event => trusted(event) ? {ok:true,data:shop.stop()} : {ok:false,error:SHOP_UNAVAILABLE});
  // Capturas (leitura do painel "CAPTURAS" do jogo): só enquanto o painel do desktop está aberto ou há assinante (ver spike/electron/captures.ts).
  const captureAlerts = {notify:false, notaMin:null as number | null};
  const captures = createCaptureService({file:join(app.getPath('userData'),'captures.json'), known:() => store.list().map(profile => profile.id), target:marketTarget, lite:() => perf.lite, suspended:id => suspended.has(id), onEvent:({captures:fresh}) => {
    if (!window.isDestroyed()) window.webContents.send('captures:new',fresh);
    if (!captureAlerts.notify || !Notification.isSupported()) return;
    for (const capture of fresh.slice(0,3)) { const kinds = alertsOf(capture,captureAlerts); if (kinds.length) new Notification({title:store.list().find(profile => profile.id === capture.profileId)?.label ?? 'PokéHub', body:alertText(capture,kinds)}).show(); }
  }});
  app.on('before-quit', () => captures.stop());
  ipcMain.handle('captures:list', (event,query: unknown) => { const q = trusted(event) ? parseQuery(query,store.list().map(profile => profile.id)) : null; return q ? {ok:true,data:captures.list(q)} : {ok:false,error:'Consulta de capturas inválida.'}; });
  ipcMain.handle('captures:clear', event => { if (!trusted(event)) return {ok:false,error:'Origem não autorizada.'}; captures.log.clear(); return {ok:true,data:undefined}; });
  ipcMain.handle('captures:watch', (event,open: unknown,notify: unknown,notaMin: unknown) => {
    if (!trusted(event) || typeof open !== 'boolean') return {ok:false,error:'Origem não autorizada.'};
    captureAlerts.notify = notify === true; captureAlerts.notaMin = typeof notaMin === 'number' && Number.isFinite(notaMin) && notaMin >= 0 ? notaMin : null;
    captures.setDesktop(open); return {ok:true,data:undefined};
  });
  ipcMain.handle('session:layout', (event,id: unknown,hide: unknown,side: unknown = false,panel: unknown = sidePanel,account: unknown = null) => invoke(event, () => {
    if (typeof hide !== 'boolean' || typeof side !== 'boolean' || (id !== null && typeof id !== 'string') || (account !== null && typeof account !== 'string') || typeof panel !== 'number' || !Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error();
    sidePanel = panel; sideAccount = account;
    if (hide) {
      editing = true; sideOpen = side;
      let failed = false;
      for (const view of views.values()) { try { view.setVisible(false); parkView(view); } catch { failed = true; } }
      if (failed) throw new Error();
      return;
    }
    if (typeof id === 'string' && !store.list().some(profile => profile.id === id)) throw new Error();
    focused = id; editing = false; sideOpen = side; arrange();
  }));
  ipcMain.handle('session:drag', (event,active: unknown) => invoke(event, () => { if (typeof active !== 'boolean') throw new Error(); if (active || dragging) setDrag(active); }));
  ipcMain.handle('session:reload', (event,id: unknown) => invoke(event, () => reloadAccount(id)));
  ipcMain.handle('session:restart', async (event,id: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível reabrir a sessão.'};
    resetting.add(id);
    try {
      if (!store.list().some(profile => profile.id === id)) throw new Error();
      await restartSession(id, {close: closeViewAwaited, open: sessionId => {if (!window.isDestroyed() && !openView(sessionId)) throw new Error(); suspended.delete(sessionId);}});
      if (!window.isDestroyed()) arrange();
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'Não foi possível reabrir a sessão.'}; }
    finally { resetting.delete(id); }
  });
  // Suspender fecha só a view (libera o renderer); a partição e o login ficam. O estado vive em memória: ao reiniciar o app todas abrem.
  ipcMain.handle('session:suspend', async (event,id: unknown) => trusted(event) ? suspendAccount(id) : {ok:false,error:SUSPEND_FAILED});
  ipcMain.handle('session:resume', (event,id: unknown) => invoke(event, () => resumeAccount(id)));
  ipcMain.handle('session:clear', async (event,id: unknown,full: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível limpar a sessão.'};
    const view = views.get(id);
    if (!view) return {ok:false,error:'Sessão não encontrada.'};
    resetting.add(id);
    try {
      const browserSession = view.webContents.session;
      await resetSession({
        close: () => closeViewAwaited(id),
        clear: async () => { await clearAllSessionData(browserSession); if (full === true) wipeQueue.add(id); },
        open: () => { if (!window.isDestroyed()) { if (!openView(id)) throw new Error(); arrange(); } },
      });
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'A limpeza pode ter sido parcial. Verifique a sessão e tente novamente.'}; }
    finally { resetting.delete(id); }
  });
  ipcMain.handle('diagnostics:sample', event => invoke(event, () => {
    const result = summarizeMetrics(readMetrics().list,performance.now(),diagnosticsBaseline);
    diagnosticsBaseline = result.baseline;
    return {...result.sample,sampledAt:new Date().toISOString()};
  }));
  // Monitor por conta (só consultado com a seção Diagnóstico aberta). getAppMetrics mede a CPU desde a chamada anterior: leituras a menos de 1 s reaproveitam a anterior.
  const processesSample = () => {
    const metrics = readMetrics();
    const pids = new Map<string, number | null>();
    for (const profile of store.list()) { const view = views.get(profile.id); let pid: number | null = null; try { if (view && !view.webContents.isDestroyed()) pid = view.webContents.getOSProcessId(); } catch { /* sem processo */ } pids.set(profile.id,pid); }
    return {sampledAt:new Date().toISOString(), ...groupMetrics(metrics.list,pids,window.webContents.getOSProcessId(),metrics.first)};
  };
  ipcMain.handle('diagnostics:processes', event => invoke(event, processesSample));
  ipcMain.handle('session:states', event => invoke(event, () => Object.fromEntries(states)));
  ipcMain.handle('workspace:auto-focus', event => invoke(event, () => autoFocused));
  window.on('resize', arrangeSoon);
  const trayEvent = (event: TrayEvent) => trayAction({event, platform:process.platform, prefs:trayPrefs, quitting, hasTray:tray !== null});
  window.on('close', event => { if (trayEvent('close') === 'hide') { event.preventDefault(); hideToTray(); } });
  window.on('minimize', () => { if (trayEvent('minimize') === 'hide') hideToTray(); });
  ghost = createGhostWindow(window);
  const syncControlShortcut = createControlShortcut({register:(key,cb) => globalShortcut.register(key,cb), unregister:key => globalShortcut.unregister(key)},CONTROL_SHORTCUT,() => { remote?.endControl(); },down => { remote?.setShortcutDown(down); }); // register falso (atalho de outro app) vira aviso na faixa + auditoria
  const changeNotifier = createChangeNotifier({send:() => { if (!window.isDestroyed()) window.webContents.send('remote:changed'); }, refresh:() => refreshTray.call()}); // o hub avisa em rajada: a faixa e o painel recarregam 1 vez
  window.on('focus',() => { try { window.flashFrame(false); } catch { /* janela fechando */ } });
  const screenNotify = (kind:'tela'|'controle',device:string,account:string) => {
    const notice = screenNotice(kind,device,account);
    try { if (kind === 'controle' && !window.isDestroyed() && !window.isFocused()) window.flashFrame(true); } catch { /* sem barra de tarefas */ }
    try { if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.displayBalloon({title:notice.title,content:notice.body,iconType:'info'}); else if (Notification.isSupported()) new Notification({title:notice.title,body:notice.body}).show(); } catch { console.error('Falha ao avisar a tela remota no PC.'); }
  };
  remote = createRemoteHub({dbPath:databasePath, dir:join(app.getPath('userData'),'remote'), uiDir:join(__dirname,'../../dist-remote'), iconPath:join(__dirname,'../../build/icon.png'), api:remoteApi.api, screen:{target:id => { const view = views.get(id); if (!view || view.webContents.isDestroyed() || resetting.has(id)) return null; let target = screenTargets.get(view); if (!target) { target = createScreenTarget(view,window.webContents,ghost!); screenTargets.set(view,target); } return target; }, forbidden:() => window.isDestroyed() ? [] : [window.webContents], onControl:syncControlShortcut, notify:screenNotify}, alerts:{captures, profiles:() => store.list().map(profile => ({id:profile.id, label:profile.label, colorToken:profile.colorToken})), fetcher:(url,init) => net.fetch(url,init as RequestInit)}, actions:{
    shop:{read:id => shop.read(id), run:async (plan,onProgress) => { if (shop.isRunning()) return {ok:false as const,error:'Já existe uma operação da Loja em andamento.'}; remoteShopProgress = onProgress; try { return await shop.run(plan); } finally { remoteShopProgress = null; } }},
    account:{reload:async id => { try { reloadAccount(id); return {ok:true}; } catch { return {ok:false,error:'Não foi possível recarregar a conta.'}; } }, suspend:async id => { const r = await suspendAccount(id); return r.ok ? {ok:true} : {ok:false,error:r.error}; },
      resume:async id => { try { resumeAccount(id); return {ok:true}; } catch { return {ok:false,error:'Não foi possível retomar a conta.'}; } }, setLite:on => setLiteMode(on) ? {ok:true} : {ok:false,error:'Não foi possível mudar o Modo leve.'}, lite:() => perf.lite},
    notify:(title,body) => { try { if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.displayBalloon({title,content:body,iconType:'info'}); else if (Notification.isSupported()) new Notification({title,body}).show(); } catch { console.error('Falha ao avisar no PC.'); } }},
  running:() => runningCount(store.list(),states), blocker:powerSaveBlocker, onChange:() => changeNotifier.notify(), onPairRequest:showWindow, secretBox:(() => { try { return safeStorage.isEncryptionAvailable() ? {encrypt:(text:string) => safeStorage.encryptString(text), decrypt:(data:Buffer) => safeStorage.decryptString(data)} : undefined; } catch { return undefined; } })(), nativeConfirm:async o => (await dialog.showMessageBox(window,{type:'warning', title:o.title, message:o.message, detail:o.detail, buttons:['Recusar',o.confirmLabel], defaultId:0, cancelId:0, noLink:true})).response === 1});
  registerRemoteIpc(ipcMain,trusted,remote);
  void remote.boot().catch(() => console.error('Falha ao iniciar o acesso remoto.'));
  createTray();
  window.on('closed', () => {
    refreshTray.cancel(); changeNotifier.cancel(); tray?.destroy(); tray = null; try { globalShortcut.unregister(CONTROL_SHORTCUT); } catch { /* saindo */ }
    clearTimeout(dragTimer); clearTimeout(resizeTimer); for (const timer of startupTimers) clearTimeout(timer); startupTimers.clear(); updater.dispose();
    for (const view of views.values()) { try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { console.error('Falha ao encerrar uma sessão.'); } }
    for (const platform of ['twitch','kick'] as const) { streams[platform]?.dispose(); delete streams[platform]; } // as janelas ocultas das lives fecham junto (senão o app não encerraria)
    views.clear(); void remote?.close(); remote = null; preferences.close(); for (const live of Object.values(streamStores)) live.close(); store.close();
  });
  // Início escalonado: a interface primeiro; depois a conta em foco (ou a primeira) e as demais, uma a cada 2,5 s. A auditoria das extensões roda em segundo plano.
  void window.loadFile(appIndex).catch(() => { dialog.showErrorBox('PokéHub', 'Não foi possível carregar a interface local. Verifique a instalação e tente novamente.'); app.quit(); });
  if (smoke) {
    const errors: string[] = []; let uiLoaded = false, finished = false;
    window.webContents.on('did-finish-load',() => { uiLoaded = true; });
    window.webContents.on('did-fail-load',(_event,code,description) => { errors.push(`did-fail-load ${code} ${description}`); });
    window.webContents.on('render-process-gone',(_event,details) => { errors.push(`render-process-gone ${details.reason}`); });
    window.webContents.on('console-message',event => { if (event.level === 'error') errors.push(`console: ${event.message.slice(0,200)}`); });
    setTimeout(() => { void (async () => {
      if (finished) return; finished = true;
      let dbVersion: number | null = null;
      try { dbVersion = Number((() => { const db = openDatabase(databasePath); try { return db.prepare('PRAGMA user_version').get()?.user_version; } finally { db.close(); } })()); } catch (error) { errors.push(`db: ${(error as Error).message}`); }
      try { if (uiLoaded && await window.webContents.executeJavaScriptInIsolatedWorld(998,[{code:"document.getElementById('root')?.children.length ?? 0"}]) === 0) errors.push('interface não montou (#root vazio)'); } catch (error) { errors.push(`ui: ${(error as Error).message}`); }
      if (views.size > 0) errors.push(`sessões abertas no smoke: ${views.size}`);
      let remoteResult: RemoteSmoke | null = null;
      try { remoteResult = await remoteSmoke(smoke.dir,join(__dirname,'../../dist-remote'),join(__dirname,'../../build/icon.png')); if (!remoteResult.ok) errors.push(`remoto: ${JSON.stringify(remoteResult.checks)}`); } catch (error) { errors.push(`remoto: ${(error as Error).message}`); }
      if (!uiLoaded) errors.push('interface não carregou');
      try { writeSmokeResult(smoke.dir,{ok:errors.length === 0 && uiLoaded && dbVersion !== null,version:app.getVersion(),uiLoaded,dbVersion,errors,remote:remoteResult}); } catch { console.error('Falha ao gravar o resultado do smoke.'); }
      quitting = true; app.quit(); setTimeout(() => app.exit(0),5000).unref();
    })(); },smoke.exitMs);
  }
  extensionsReady = refreshExtensions().catch(() => { console.error('Não foi possível ler a configuração das extensões.'); }).then(() => { extensionsLoaded = true; });
  const openAtStartup = (id: string) => {
    try {
      if (window.isDestroyed() || views.has(id) || suspended.has(id) || resetting.has(id) || !store.list().some(profile => profile.id === id)) return;
      openView(id); arrange();
    } catch { console.error('Falha ao abrir uma sessão.'); }
  };
  void extensionsReady.then(() => {
    if (window.isDestroyed()) return;
    for (const {id,delay} of startupPlan(store.list().map(profile => profile.id),focused)) {
      if (delay === 0) { openAtStartup(id); continue; }
      const timer = setTimeout(() => { startupTimers.delete(timer); openAtStartup(id); },delay);
      startupTimers.add(timer);
    }
    arrange();
    streams.twitch?.start(); setTimeout(() => streams.kick?.start(),5_000); // depois das sessões do jogo, também escalonado (a Kick um pouco depois)
  });
}).catch((error: unknown) => {
  console.error('Falha ao iniciar o PokéHub.');
  if (!window) {
    try { preferences?.close(); } catch { console.error('Falha ao fechar configurações.'); }
    for (const live of Object.values(streamStores)) { try { live.close(); } catch { console.error('Falha ao fechar as lives.'); } }
    try { store?.close(); } catch { console.error('Falha ao fechar perfis.'); }
  }
  const message = error instanceof ProfileLimitError
    ? 'O armazenamento local contém mais de quatro perfis. Nenhum dado foi removido; revise o banco antes de continuar.'
    : 'Não foi possível iniciar o aplicativo ou abrir os dados locais. Verifique a instalação e o armazenamento.';
  dialog.showErrorBox('PokéHub', message); app.quit();
});
app.on('before-quit', () => { quitting = true; void remote?.close(); }); // a porta do acesso remoto fecha ao sair
app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); }); // escondida na bandeja a janela não está fechada; só o Sair encerra
