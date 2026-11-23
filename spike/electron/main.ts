import { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, net, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { effectiveFocus, initialFocus, layout, SIDE_MAX, SIDE_MIN, SIDE_PANEL, sideWidth, TOP_BAR } from './layout';
import { huntSnapshot, HUNT_UNAVAILABLE, type HuntTarget } from './hunt-snapshot';
import { marketScan, MARKET_UNAVAILABLE } from './market-scan';
import { isAllowedSessionNavigation, isOAuthProviderUrl } from './navigation';
import { ProfileStore } from './profile-store';
import { partitionFor } from './partition';
import { PreferencesStore } from './preferences-store';
import { closeContents } from './close-contents';
import { summarizeMetrics, type DiagnosticsBaseline } from './diagnostics';
import { canReadHunt, classifyLoadFailure, classifyLoadRejection, offlineRetryDelay } from './session-status';
import { isExpandShortcut, isSideShortcut, shortcutFocus, shortcutIndex } from './workspace-shortcuts';
import { acquireSingleInstance } from './single-instance';
import { resetSession, restartSession, openSessionSafely, mountSessionView } from './session-recovery';
import { approvedHostsOf, auditExtension, catalogIdOf, CATALOG, checkExtension, findInstalled, HUNT_ID, hostsCovered, resolveExtensionPath } from './extension-check';
import type { AuditFinding, AuditVerdict, ExtensionInfo } from '../contracts/extensions';
import { createUpdater, type Updater } from './updater';
import type { UpdateInfo } from '../contracts/update';
import { ProfileLimitError, type ProfileInput } from '../domain/profiles';

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
const gameUrl = 'https://pokeidle.io/app';
// Extensões de terceiros (/hunt, Smart Market...): carregadas da pasta do navegador do usuário, nunca copiadas.
interface ExtState {id: string; catalogId: string | null; name: string; version: string | null; path: string; enabled: boolean; verdict: AuditVerdict | null; findings: AuditFinding[]; hosts: string[]; approvedHosts: string[]; pending: boolean; error: string | null; loadable: boolean}
let extensions: ExtState[] = [];
const extErrors = new Map<string, string>(); // falhas de carga por extensão; as sessões seguem abertas sem ela
let extBusy = false;
const extLoaded = new WeakMap<Electron.Session, Map<string, {id: string; path: string}>>();
const catalogName = (id: string | null) => CATALOG.find(entry => entry.id === id)?.name;
const BLOCKED_PREFIX = 'Bloqueada pela auditoria: ';
const findingText = (finding: AuditFinding) => finding.kind === 'skipped' ? finding.detail : `${finding.detail} em ${finding.file}`;
function refreshExtensions() {
  extensions = preferences.listExtensions().map(row => {
    const catalogId = CATALOG.some(entry => entry.id === row.id) ? row.id : null;
    const path = catalogId ? resolveExtensionPath(row.path) : row.path; // o Chrome troca a pasta da versão ao atualizar
    if (path !== row.path) { try { preferences.setExtensionPath(row.id,path); } catch { /* caminho já usado por outra linha: segue com o antigo na lista */ } }
    // a pré-aprovação do catálogo só vale quando o id e a pasta (…/Extensions/<id>/<versão>) batem com a entrada
    const approvedHosts = approvedHostsOf(catalogId && catalogIdOf(path) === catalogId ? catalogId : '',row.approvedHosts);
    const base = {id:row.id, catalogId, path, enabled:row.enabled, findings:[] as AuditFinding[], hosts:[] as string[], approvedHosts, pending:false};
    const check = checkExtension(path);
    if (!check.ok) return {...base, name:catalogName(catalogId) ?? (path.split(/[\\/]/).filter(Boolean).pop() ?? 'Extensão'), version:null, verdict:'bloqueada' as const, error:check.error, loadable:false};
    const audit = auditExtension(path);
    const reasons = [...new Set(audit.findings.filter(finding => finding.kind === 'eval' || finding.kind === 'skipped').map(findingText))].slice(0,3);
    const pending = audit.verdict === 'externa' && !hostsCovered(audit.hosts,approvedHosts); // host novo ou ainda não aprovado: não carrega
    return {...base, name:check.name, version:check.version, findings:audit.findings, hosts:audit.hosts, pending, verdict:audit.verdict, error:audit.verdict === 'bloqueada' ? `${BLOCKED_PREFIX}${reasons.join('; ')}.` : null, loadable:audit.verdict !== 'bloqueada' && !pending};
  });
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
        try { const loaded = await session.extensions.loadExtension(extension.path,{allowFileAccess:false}); kept.set(extension.id,{id:loaded.id,path:extension.path}); extErrors.delete(extension.id); }
        catch { extErrors.set(extension.id,'Não foi possível carregar a extensão em uma sessão. A sessão segue aberta sem ela.'); console.error('Falha ao carregar uma extensão.'); }
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
async function applyExtensions(): Promise<ExtensionInfo[]> {
  refreshExtensions();
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
  return applyExtensions();
}
async function addExtension(): Promise<ExtensionInfo[]> {
  const {canceled, filePaths} = await dialog.showOpenDialog(window,{title:'Pasta da extensão (a pasta com o manifest.json)',buttonLabel:'Usar esta pasta',properties:['openDirectory']});
  const path = filePaths[0];
  if (canceled || !path) return applyExtensions();
  const check = checkExtension(path);
  if (!check.ok) throw new ExtensionRefused(check.error);
  const rows = preferences.listExtensions();
  if (rows.some(row => row.path === path)) throw new ExtensionRefused('Essa pasta já está na lista.');
  if (rows.length >= MAX_EXTENSIONS) throw new ExtensionRefused(`O limite é de ${MAX_EXTENSIONS} extensões. Remova alguma antes de adicionar outra.`);
  const catalogId = catalogIdOf(path);
  preferences.addExtension({id:catalogId && !rows.some(row => row.id === catalogId) ? catalogId : randomUUID(),path,enabled:true});
  return applyExtensions();
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
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 64_000) throw new Error();
  return response.json() as Promise<unknown>;
};
const trusted = (event: IpcMainInvokeEvent) => Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame && event.senderFrame === window.webContents.mainFrame);
function report(id: string, state: string) {
  states.set(id,state);
  if (!window.isDestroyed()) window.webContents.send('session:status', {id,state});
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
  profiles.forEach((profile,i) => { const view = views.get(profile.id); const b = bounds[i]; if (view) { view.setVisible(!editing && !dragging && Boolean(b)); if (b) view.setBounds(b); } });
}
function setDrag(active: boolean) {
  clearTimeout(dragTimer);
  dragging = active;
  if (!active) { arrange(); return; }
  // se o renderer nunca avisar o fim (travou, recarregou), as sessões voltam sozinhas
  dragTimer = setTimeout(() => { try { if (!window.isDestroyed()) setDrag(false); } catch { console.error('Falha ao restaurar as sessões após o arrasto.'); } }, DRAG_FAILSAFE_MS);
  for (const view of views.values()) { try { view.setVisible(false); } catch { /* sessão encerrando */ } }
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
  const view = new WebContentsView({webPreferences:{partition:partitionFor(id), sandbox:true, contextIsolation:true, nodeIntegration:false}});
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
      view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      view.webContents.session.setPermissionCheckHandler(() => false);
      view.webContents.on('will-navigate', (event, url) => { if (!isAllowedSessionNavigation(url)) event.preventDefault(); });
      view.webContents.on('will-redirect', (event, url) => { if (!isAllowedSessionNavigation(url)) event.preventDefault(); });
      view.webContents.once('destroyed', () => clearTimeout(retry));
      view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) huntDocuments.set(view.webContents, {}); });
      view.webContents.on('did-start-loading', () => reportCurrent('loading'));
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
  const pending = syncExtensions(view.webContents.session); // content scripts em document_start exigem a extensão antes do loadURL
  if (pending) void pending.then(load); else load();
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
const primary = acquireSingleInstance(app, () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});
if (primary) app.whenReady().then(() => {
  const databasePath = join(app.getPath('userData'),'pokehub.sqlite');
  store = new ProfileStore(databasePath);
  preferences = new PreferencesStore(databasePath);
  try { refreshExtensions(); } catch { console.error('Não foi possível ler a configuração das extensões.'); }
  focused = initialFocus(preferences.getStartupMode(), store.list().map(profile => profile.id));
  window = new BrowserWindow({title:'PokéHub',icon:join(__dirname,'../../build/icon.png'),backgroundColor:'#0f1218',width:1280,height:800,minWidth:700,minHeight:480,webPreferences:{preload:join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  if (process.platform !== 'darwin') window.removeMenu(); // no macOS o menu fica na barra do sistema e mantém copiar/colar
  updater = createUpdater({autoCheck:() => preferences.getAutoUpdateCheck(), onStatus:status => { if (!window.isDestroyed()) window.webContents.send('update:status',status); }});
  registerShortcuts(window.webContents);
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window,{type:'question',title:'Alterações não salvas',message:'Há alterações não salvas ou uma operação em andamento. Deseja sair mesmo assim?',buttons:['Continuar no PokéHub','Sair mesmo assim'],defaultId:0,cancelId:0,noLink:true});
    if (choice === 1) event.preventDefault();
  });
  ipcMain.handle('profiles:list', event => invoke(event, () => store.list()));
  ipcMain.handle('preferences:get', event => invoke(event, () => preferences.getStartupMode()));
  ipcMain.handle('preferences:set', (event,mode: unknown) => invoke(event, () => preferences.setStartupMode(mode)));
  ipcMain.handle('extensions:list', event => invokeExtensions(event, applyExtensions));
  ipcMain.handle('extensions:detect', event => invokeExtensions(event, detectExtensions));
  ipcMain.handle('extensions:add', event => invokeExtensions(event, addExtension));
  ipcMain.handle('extensions:toggle', (event,id: unknown,enabled: unknown) => invokeExtensions(event, () => { if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error(); preferences.setExtensionEnabled(id,enabled); return applyExtensions(); }));
  ipcMain.handle('extensions:remove', (event,id: unknown) => invokeExtensions(event, () => { if (typeof id !== 'string') throw new Error(); preferences.removeExtension(id); return applyExtensions(); }));
  // aprova os hosts externos que a auditoria acha AGORA; `hosts` (o que a tela mostrou) precisa ser o mesmo conjunto
  ipcMain.handle('extensions:approve', (event,id: unknown,hosts: unknown) => invokeExtensions(event, () => {
    if (typeof id !== 'string' || (hosts !== undefined && (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')))) throw new Error();
    refreshExtensions();
    const extension = extensions.find(item => item.id === id);
    if (!extension || extension.verdict !== 'externa' || extension.hosts.length === 0) throw new ExtensionRefused('Esta extensão não precisa de aprovação.');
    const shown = hosts as string[] | undefined;
    if (shown && (shown.length !== extension.hosts.length || shown.some(host => !extension.hosts.includes(host)))) throw new ExtensionRefused('A extensão mudou desde a última leitura. Revise os sites e tente de novo.');
    preferences.setApprovedHosts(id,extension.hosts);
    return applyExtensions();
  }));
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
  ipcMain.handle('profiles:create', (event,input: ProfileInput) => invoke(event, () => { const profile = store.create(input); openView(profile.id); arrange(); return profile; }));
  ipcMain.handle('profiles:update', (event,id: unknown,input: ProfileInput) => invoke(event, () => { if (typeof id !== 'string') throw new Error(); return store.update(id,input); }));
  ipcMain.handle('profiles:remove', async (event,id: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível remover o perfil.'};
    resetting.add(id);
    try {
      if (!store.list().some(profile => profile.id === id)) throw new Error();
      await closeViewAwaited(id);
      try { store.remove(id); } catch (error) { if (!window.isDestroyed()) openView(id); throw error; }
      if (focused === id) focused = null;
      if (!window.isDestroyed()) arrange();
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'Não foi possível remover o perfil. Verifique o estado e tente novamente.'}; }
    finally { resetting.delete(id); }
  });
  const huntTarget = (profileId: string): HuntTarget | null => {
      const contents = readable(profileId);
      if (!contents) return null;
      return {identity:huntDocuments.get(contents) ?? contents, url:contents.getURL(), hasExtension:hasHunt(contents.session), version:extensions.find(extension => extension.catalogId === HUNT_ID)?.version ?? null, run:script => contents.executeJavaScript(script), sprites};
    };
  ipcMain.handle('hunt:snapshot', async (event,id: unknown,soLiberadas: unknown = true) => {
    if (!trusted(event)) return {ok:false,error:HUNT_UNAVAILABLE};
    return huntSnapshot(id, store.list().map(profile => profile.id), huntTarget, undefined, soLiberadas);
  });
  ipcMain.handle('market:scan', async (event,id: unknown) => {
    if (!trusted(event)) return {ok:false,error:MARKET_UNAVAILABLE};
    return marketScan(id, store.list().map(profile => profile.id), profileId => { const contents = readable(profileId); return contents ? {url:contents.getURL(), run:script => contents.executeJavaScript(script)} : null; });
  });
  ipcMain.handle('session:layout', (event,id: unknown,hide: unknown,side: unknown = false,panel: unknown = sidePanel,account: unknown = null) => invoke(event, () => {
    if (typeof hide !== 'boolean' || typeof side !== 'boolean' || (id !== null && typeof id !== 'string') || (account !== null && typeof account !== 'string') || typeof panel !== 'number' || !Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error();
    sidePanel = panel; sideAccount = account;
    if (hide) {
      editing = true; sideOpen = side;
      let failed = false;
      for (const view of views.values()) { try { view.setVisible(false); } catch { failed = true; } }
      if (failed) throw new Error();
      return;
    }
    if (typeof id === 'string' && !store.list().some(profile => profile.id === id)) throw new Error();
    focused = id; editing = false; sideOpen = side; arrange();
  }));
  ipcMain.handle('session:drag', (event,active: unknown) => invoke(event, () => { if (typeof active !== 'boolean') throw new Error(); if (active || dragging) setDrag(active); }));
  ipcMain.handle('session:reload', (event,id: unknown) => invoke(event, () => { if (typeof id !== 'string' || resetting.has(id) || !views.has(id)) throw new Error(); views.get(id)?.webContents.reload(); }));
  ipcMain.handle('session:restart', async (event,id: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível reabrir a sessão.'};
    resetting.add(id);
    try {
      if (!store.list().some(profile => profile.id === id)) throw new Error();
      await restartSession(id, {close: closeViewAwaited, open: sessionId => {if (!window.isDestroyed() && !openView(sessionId)) throw new Error();}});
      if (!window.isDestroyed()) arrange();
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'Não foi possível reabrir a sessão.'}; }
    finally { resetting.delete(id); }
  });
  ipcMain.handle('session:clear', async (event,id: unknown) => {
    if (!trusted(event) || typeof id !== 'string' || resetting.has(id)) return {ok:false,error:'Não foi possível limpar a sessão.'};
    const view = views.get(id);
    if (!view) return {ok:false,error:'Sessão não encontrada.'};
    resetting.add(id);
    try {
      const browserSession = view.webContents.session;
      await resetSession({
        close: () => closeViewAwaited(id),
        clear: async () => { await browserSession.clearStorageData(); await browserSession.clearCache(); },
        open: () => { if (!window.isDestroyed()) { if (!openView(id)) throw new Error(); arrange(); } },
      });
      return {ok:true,data:undefined};
    } catch { return {ok:false,error:'A limpeza pode ter sido parcial. Verifique a sessão e tente novamente.'}; }
    finally { resetting.delete(id); }
  });
  ipcMain.handle('diagnostics:sample', event => invoke(event, () => {
    const result = summarizeMetrics(app.getAppMetrics(),performance.now(),diagnosticsBaseline);
    diagnosticsBaseline = result.baseline;
    return {...result.sample,sampledAt:new Date().toISOString()};
  }));
  ipcMain.handle('session:states', event => invoke(event, () => Object.fromEntries(states)));
  ipcMain.handle('workspace:auto-focus', event => invoke(event, () => autoFocused));
  window.on('resize', arrange);
  window.on('closed', () => {
    clearTimeout(dragTimer); updater.dispose();
    for (const view of views.values()) { try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { console.error('Falha ao encerrar uma sessão.'); } }
    views.clear(); preferences.close(); store.close();
  });
  for (const profile of store.list()) openView(profile.id);
  arrange();
  void window.loadFile(join(__dirname,'../../dist/index.html')).catch(() => { dialog.showErrorBox('PokéHub', 'Não foi possível carregar a interface local. Verifique a instalação e tente novamente.'); app.quit(); });
}).catch((error: unknown) => {
  console.error('Falha ao iniciar o PokéHub.');
  if (!window) {
    try { preferences?.close(); } catch { console.error('Falha ao fechar configurações.'); }
    try { store?.close(); } catch { console.error('Falha ao fechar perfis.'); }
  }
  const message = error instanceof ProfileLimitError
    ? 'O armazenamento local contém mais de quatro perfis. Nenhum dado foi removido; revise o banco antes de continuar.'
    : 'Não foi possível iniciar o aplicativo ou abrir os dados locais. Verifique a instalação e o armazenamento.';
  dialog.showErrorBox('PokéHub', message); app.quit();
});
app.on('window-all-closed', () => app.quit());
