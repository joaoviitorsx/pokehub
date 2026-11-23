import { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, net, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { effectiveFocus, initialFocus, layout, SIDE_MAX, SIDE_MIN, SIDE_PANEL, sideWidth, TOP_BAR } from './layout';
import { huntSnapshot, HUNT_UNAVAILABLE, type HuntTarget } from './hunt-snapshot';
import { isAllowedSessionNavigation, isOAuthProviderUrl } from './navigation';
import { ProfileStore } from './profile-store';
import { partitionFor } from './partition';
import { PreferencesStore } from './preferences-store';
import { closeContents } from './close-contents';
import { summarizeMetrics, type DiagnosticsBaseline } from './diagnostics';
import { canReadHunt, classifyLoadFailure, classifyLoadRejection, offlineRetryDelay } from './session-status';
import { isSideShortcut, shortcutFocus, shortcutIndex } from './workspace-shortcuts';
import { acquireSingleInstance } from './single-instance';
import { resetSession, restartSession, openSessionSafely, mountSessionView } from './session-recovery';
import { checkExtension, findInstalledHunt, resolveHuntPath } from './extension-check';
import type { HuntExtensionStatus } from '../contracts/preferences';
import { ProfileLimitError, type ProfileInput } from '../domain/profiles';

let window: BrowserWindow;
let store: ProfileStore;
let preferences: PreferencesStore;
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
let autoFocused: string | null = null;
let diagnosticsBaseline: DiagnosticsBaseline | null = null;
let externalNoticeOpen = false;
const gameUrl = 'https://pokeidle.io/app';
// Extensão /hunt (terceiros): carregada da pasta do navegador do usuário, nunca copiada.
let hunt: {path: string; name: string; version: string} | null = null;
let huntError: string | null = null;
let huntBusy = false;
const huntLoaded = new WeakMap<Electron.Session, {id: string; path: string}>();
function refreshHunt() {
  hunt = null; huntError = null;
  const saved = preferences.getHuntExtensionPath();
  if (!saved) return;
  const path = resolveHuntPath(saved); // o Chrome troca a pasta da versão ao atualizar
  const check = checkExtension(path);
  if (!check.ok) { huntError = check.error; return; }
  if (path !== saved) preferences.setHuntExtensionPath(path);
  hunt = {path, name:check.name, version:check.version};
}
function hasHunt(session: Electron.Session) {
  const loaded = huntLoaded.get(session);
  return Boolean(hunt && loaded && loaded.path === hunt.path && session.extensions.getExtension(loaded.id));
}
// Deixa a sessão só com a extensão atual. Nunca rejeita: falha de extensão não pode impedir a sessão de abrir.
function syncHunt(session: Electron.Session): Promise<void> | null {
  const failed = () => { huntError = 'Não foi possível carregar a extensão em uma sessão. A sessão segue aberta sem ela.'; console.error('Falha ao carregar a extensão /hunt.'); };
  try {
    if (hasHunt(session)) return null;
    for (const extension of session.extensions.getAllExtensions()) session.extensions.removeExtension(extension.id);
    huntLoaded.delete(session);
    if (!hunt) return null;
    const path = hunt.path;
    return session.extensions.loadExtension(path,{allowFileAccess:false}).then(extension => { huntLoaded.set(session,{id:extension.id,path}); }, failed);
  } catch { failed(); return null; }
}
function huntStatus(error?: string): HuntExtensionStatus {
  const saved = preferences.getHuntExtensionPath();
  let loaded = 0;
  for (const view of views.values()) { try { if (!view.webContents.isDestroyed() && hasHunt(view.webContents.session)) loaded++; } catch { /* sessão encerrando */ } }
  return {enabled:saved !== null, path:hunt?.path ?? saved, name:hunt?.name ?? null, version:hunt?.version ?? null, error:error ?? huntError, loaded, sessions:views.size};
}
async function setHunt(path: string | null): Promise<HuntExtensionStatus> {
  if (path !== null) { const check = checkExtension(path); if (!check.ok) return huntStatus(check.error); }
  preferences.setHuntExtensionPath(path);
  refreshHunt();
  await Promise.all([...views.values()].map(view => view.webContents.isDestroyed() ? null : syncHunt(view.webContents.session)));
  return huntStatus();
}
function detectHunt(): Promise<HuntExtensionStatus> {
  const found = findInstalledHunt({platform:process.platform, home:app.getPath('home'), localAppData:process.env.LOCALAPPDATA});
  return found ? setHunt(found) : Promise.resolve(huntStatus('Extensão não encontrada no Chrome, Chromium, Brave ou Edge. Instale-a no navegador ou escolha a pasta.'));
}
async function chooseHunt(): Promise<HuntExtensionStatus> {
  const {canceled, filePaths} = await dialog.showOpenDialog(window,{title:'Pasta da versão da extensão /hunt',buttonLabel:'Usar esta pasta',properties:['openDirectory']});
  const path = filePaths[0];
  return canceled || !path ? huntStatus() : setHunt(path);
}
async function invokeHunt(event: IpcMainInvokeEvent, action: () => HuntExtensionStatus | Promise<HuntExtensionStatus>) {
  if (!trusted(event)) return {ok:false, error:'Origem não autorizada.'};
  if (huntBusy) return {ok:false, error:'Aguarde a operação anterior da extensão terminar.'};
  huntBusy = true;
  try { return {ok:true, data:await action()}; }
  catch { return {ok:false, error:'Não foi possível atualizar a extensão. Tente novamente.'}; }
  finally { huntBusy = false; }
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
  const effective = effectiveFocus(width, height, profiles.length, index !== null && index >= 0 ? index : null);
  const nextAuto = effective.automatic ? profiles[effective.index ?? 0]?.id ?? null : null;
  if (nextAuto !== autoFocused) { autoFocused = nextAuto; if (!window.isDestroyed()) window.webContents.send('workspace:auto-focus', nextAuto); }
  const bounds = layout(width, Math.max(height,TOP_BAR), profiles.length, effective.index, sideWidth(width, sideOpen, effective.index, sidePanel, profiles.length));
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
function registerShortcuts(contents: Electron.WebContents) {
  contents.on('before-input-event', (event, input) => {
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
      registerShortcuts(view.webContents);
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
  const pending = syncHunt(view.webContents.session); // content scripts em document_start exigem a extensão antes do loadURL
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
  try { refreshHunt(); } catch { huntError = 'Não foi possível ler a configuração da extensão.'; }
  focused = initialFocus(preferences.getStartupMode(), store.list().map(profile => profile.id));
  window = new BrowserWindow({title:'PokéHub',backgroundColor:'#0f1218',width:1280,height:800,minWidth:700,minHeight:480,webPreferences:{preload:join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  if (process.platform !== 'darwin') window.removeMenu(); // no macOS o menu fica na barra do sistema e mantém copiar/colar
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
  ipcMain.handle('extension:status', event => invokeHunt(event, () => huntStatus()));
  ipcMain.handle('extension:detect', event => invokeHunt(event, detectHunt));
  ipcMain.handle('extension:choose', event => invokeHunt(event, chooseHunt));
  ipcMain.handle('extension:set', (event,enabled: unknown) => invokeHunt(event, () => { if (typeof enabled !== 'boolean') throw new Error(); return enabled ? detectHunt() : setHunt(null); }));
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
      return {identity:huntDocuments.get(contents) ?? contents, url:contents.getURL(), hasExtension:hasHunt(contents.session), version:hunt?.version ?? null, run:script => contents.executeJavaScript(script), sprites};
    };
  ipcMain.handle('hunt:snapshot', async (event,id: unknown,soLiberadas: unknown = true) => {
    if (!trusted(event)) return {ok:false,error:HUNT_UNAVAILABLE};
    return huntSnapshot(id, store.list().map(profile => profile.id), huntTarget, undefined, soLiberadas);
  });
  ipcMain.handle('session:layout', (event,id: unknown,hide: unknown,side: unknown = false,panel: unknown = sidePanel) => invoke(event, () => {
    if (typeof hide !== 'boolean' || typeof side !== 'boolean' || (id !== null && typeof id !== 'string') || typeof panel !== 'number' || !Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error();
    sidePanel = panel;
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
    clearTimeout(dragTimer);
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
