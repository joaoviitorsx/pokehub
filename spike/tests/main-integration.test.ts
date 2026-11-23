import { afterAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(),'pokehub-main-'));
type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const created: FakeView[] = [];
let confirmChoice = 0;
const openedExternal: string[] = [];
const notices: string[] = [];
let noticeChoice = 0;
let failExtension = false;
let chosenFolder: string | null = null;
const order: string[] = [];
class FakeExtensions {
  items: {id:string;path:string}[] = [];
  options: unknown[] = [];
  getAllExtensions() { return this.items.slice(); }
  getExtension(id: string) { return this.items.find(item => item.id === id) ?? null; }
  removeExtension(id: string) { this.items = this.items.filter(item => item.id !== id); }
  async loadExtension(path: string, options: unknown) {
    if (failExtension) throw new Error('extensão recusada');
    order.push('extension'); this.options.push(options);
    const item = {id:`ext-${path}`,path}; this.items.push(item); return item;
  }
}
class FakeSession {
  extensions = new FakeExtensions();
  clearCount = 0; cacheCount = 0; block?: Promise<void>;
  setPermissionRequestHandler() {}
  setPermissionCheckHandler() {}
  async clearStorageData() { this.clearCount++; await this.block; }
  async clearCache() { this.cacheCount++; }
}
let nextPid = 5000;
let richMetrics = false;
class FakeContents extends EventEmitter {
  mainFrame = {};
  destroyed = false;
  deferClose = false;
  failClose = false;
  destroyBeforeThrow = false;
  loadedUrl = '';
  session = new FakeSession();
  windowOpenHandler?: () => {action:string};
  setWindowOpenHandler(handler: () => {action:string}) { this.windowOpenHandler = handler; }
  sent: [string, {id?: string; state?: string}][] = [];
  send(channel: string, payload: {id?: string; state?: string}) { this.sent.push([channel, payload]); }
  loadURL(url: string) { order.push('url'); this.loadedUrl = url; this.emit('did-start-loading'); return Promise.resolve(); }
  reload() {}
  close() { if (this.destroyBeforeThrow) {this.destroyed=true;throw new Error('fechamento parcial');} if (this.failClose) throw new Error('não fechou'); if (!this.deferClose) this.completeClose(); }
  completeClose() { this.destroyed = true; this.emit('destroyed'); }
  loadingMainFrame = true;
  muted: boolean[] = [];
  setAudioMuted(value: boolean) { this.muted.push(value); }
  pid = nextPid++;
  getOSProcessId() { return this.pid; }
  isLoadingMainFrame() { return this.loadingMainFrame; }
  getURL() { return this.loadedUrl; }
  isDestroyed() { return this.destroyed; }
}
class FakeView {
  webContents = new FakeContents();
  visible = true;
  constructor(public options: {webPreferences: {partition: string}}) { created.push(this); }
  setVisible(visible: boolean) { this.visible = visible; }
  setBounds() {}
}
const trays: FakeTray[] = [];
const windowCalls: string[] = [];
let menuTemplate: {label?:string;type?:string;checked?:boolean;click?:() => void}[] = [];
class FakeTray extends EventEmitter {
  tip = ''; balloons: unknown[] = []; destroyedFlag = false;
  constructor(public icon: unknown) { super(); trays.push(this); }
  setToolTip(text: string) { this.tip = text; }
  setContextMenu() {}
  displayBalloon(options: unknown) { this.balloons.push(options); }
  isDestroyed() { return this.destroyedFlag; }
  destroy() { this.destroyedFlag = true; }
}
let shell: FakeWindow;
class FakeWindow extends EventEmitter {
  webContents = new FakeContents();
  children = new Set<FakeView>();
  contentView = {addChildView:(view:FakeView) => {this.children.add(view);}, removeChildView:(view:FakeView) => {if (!this.children.delete(view)) throw new Error('view não anexada');}};
  options: Record<string, unknown>;
  constructor(options: Record<string, unknown> = {}) { super(); this.options = options; shell = this; }
  sizeCalls = 0;
  getContentSize() { this.sizeCalls++; return [1280,800]; }
  removeMenu() {}
  isDestroyed() { return false; }
  isMinimized() { return false; }
  focus() { windowCalls.push('focus'); }
  hide() { windowCalls.push('hide'); }
  show() { windowCalls.push('show'); }
  restore() { windowCalls.push('restore'); }
  loadFile() { return Promise.resolve(); }
}
const switches: [string, string][] = [];
const appIds: string[] = [];
const fakeApp = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: () => true,
  commandLine: {getSwitchValue: () => 'Existente', appendSwitch: (name: string, value: string) => { switches.push([name,value]); }},
  whenReady: () => Promise.resolve(),
  getPath: () => directory,
  getVersion: () => '0.1.0',
  setAppUserModelId: (id: string) => { appIds.push(id); },
  getAppMetrics: () => richMetrics
    ? [{pid:123,type:'Browser',creationTime:100,memory:{workingSetSize:2048},cpu:{percentCPUUsage:3}},{pid:99,type:'GPU',creationTime:101,memory:{workingSetSize:500},cpu:{percentCPUUsage:1}},...created.filter(view => !view.webContents.isDestroyed()).map(view => ({pid:view.webContents.pid,type:'Tab',creationTime:200 + view.webContents.pid,memory:{workingSetSize:4000,privateBytes:3000},cpu:{percentCPUUsage:2}}))]
    : [{pid:123,creationTime:100,memory:{workingSetSize:2048},cpu:{percentCPUUsage:3}}],
  quit: () => {},
});
let powerStarts = 0;
vi.doMock('electron', () => ({powerSaveBlocker:{start:() => { powerStarts++; return 1; }, stop() {}}, Tray:FakeTray, Menu:{buildFromTemplate:(template: typeof menuTemplate) => { menuTemplate = template; return {}; }}, Notification:class { static isSupported() { return false; } }, nativeImage:{createFromPath:() => ({resize:(size:unknown) => size})}, app: fakeApp, BrowserWindow:FakeWindow, WebContentsView:FakeView, ipcMain:{handle: (name:string, handler:Handler) => handlers.set(name,handler)}, shell:{openExternal:async (url:string) => {openedExternal.push(url);}}, dialog:{showOpenDialog:async () => ({canceled:chosenFolder === null,filePaths:chosenFolder === null ? [] : [chosenFolder]}),showErrorBox() {},showMessageBoxSync:()=>confirmChoice,showMessageBox:async (_window:unknown, options:{message:string}) => {notices.push(options.message);return {response:noticeChoice};}}}));
afterAll(() => { shell?.emit('closed'); vi.doUnmock('electron'); rmSync(directory,{recursive:true,force:true}); });

describe('processo principal', () => {
 it('isola perfis, rejeita o quinto e restringe IPC à interface', async () => {
  const input = {label:'Conta',emailLabel:'a@example.com',characterName:'',colorToken:'#d4a65f'};
  const { ProfileStore } = await import('../electron/profile-store');
  const { PreferencesStore } = await import('../electron/preferences-store');
  const path = join(directory,'pokehub.sqlite');
  const seedStore = new ProfileStore(path); const saved = seedStore.create(input); seedStore.close();
  const savedPreferences = new PreferencesStore(path); savedPreferences.setStartupMode('focus-first'); savedPreferences.close();
  await import('../electron/main');
  await vi.waitFor(() => expect(handlers.has('profiles:create')).toBe(true));
  expect(switches).toEqual([['disable-features','Existente,SpareRendererForSitePerProcess']]);
  await vi.waitFor(() => expect(created).toHaveLength(1)); // início escalonado: a primeira conta abre depois da leitura assíncrona das extensões
  expect(created[0]?.webContents.loadedUrl).toBe('https://pokeidle.io/app');
  expect(created[0]?.options.webPreferences).toMatchObject({spellcheck:false,devTools:true});
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  // acesso remoto: desligado por padrão => nada escuta e o PC não é impedido de dormir; só a interface pergunta
  expect(await handlers.get('remote:status')!(sender)).toMatchObject({ok:true,data:{enabled:false,running:false,urls:[],pairing:null}});
  expect(await handlers.get('remote:status')!({sender:{},senderFrame:{}})).toEqual({ok:false,error:'Origem não autorizada.'});
  expect(powerStarts).toBe(0);
  const preventUnload = vi.fn();
  shell.webContents.emit('will-prevent-unload',{preventDefault:preventUnload});
  expect(preventUnload).not.toHaveBeenCalled();
  confirmChoice=1;
  shell.webContents.emit('will-prevent-unload',{preventDefault:preventUnload});
  expect(preventUnload).toHaveBeenCalledTimes(1);
  confirmChoice=0;
  const invoke = (channel:string,...args:unknown[]) => {
    const handler = handlers.get(channel); if (!handler) throw new Error('Canal ausente');
    return handler(sender,...args) as {ok:boolean;data?:{id:string}};
  };
  expect(handlers.get('workspace:initial-focus')?.(sender)).toEqual({ok:true,data:saved.id});
  const ids = [saved.id,...Array.from({length:3}, () => invoke('profiles:create',input).data?.id)];
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(created.map(view => view.options.webPreferences.partition)).size).toBe(4);
  expect(created.map(view => view.webContents.loadedUrl)).toEqual(Array(4).fill('https://pokeidle.io/app'));
  expect(invoke('profiles:create',input).ok).toBe(false);
  // erros inesperados viram mensagem genérica
  expect(invoke('profiles:update',1,input)).toEqual({ok:false,error:'Não foi possível concluir a operação. Confira os dados e tente novamente.'});
  const untrusted = handlers.get('profiles:list')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame}) as {ok:boolean};
  expect(untrusted.ok).toBe(false);
  // /hunt: id desconhecido, tipo errado, origem não confiável e sessão ainda carregando não executam nada na página
  const huntFail = {ok:false,error:'Dados do /hunt indisponíveis nesta conta'};
  for (const id of ['nao-existe',null,42,{id:saved.id},saved.id]) expect(await invoke('hunt:snapshot',id)).toEqual(huntFail);
  expect(await handlers.get('hunt:snapshot')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},saved.id)).toEqual(huntFail);
  // leitura assistida do Mercado: canais novos exigem origem confiável e perfil conhecido; nada roda em sessão que ainda carrega
  const marketFail = {ok:false,error:'Abra o Mercado nesta conta para analisar os anúncios.'}, foreign = {sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame};
  expect(handlers.has('market:readAll') && handlers.has('market:stop')).toBe(true);
  expect(await handlers.get('market:readAll')?.(foreign,saved.id)).toEqual(marketFail);
  expect(await handlers.get('market:stop')?.(foreign,saved.id)).toEqual(marketFail);
  for (const id of ['nao-existe',null,42,{id:saved.id}]) expect(await invoke('market:readAll',id)).toEqual(marketFail);
  expect(await invoke('market:readAll',saved.id)).toEqual(marketFail); // sessão ainda carregando
  expect(await invoke('market:stop',saved.id)).toEqual({ok:true,data:false});
  expect(await invoke('market:stop',42)).toEqual({ok:true,data:false});
  expect(invoke('session:layout',null,false,'sim').ok).toBe(false);
  expect(invoke('session:layout',null,false,true).ok).toBe(true);
  for (const panel of [279,521,300.5,'340',null,NaN]) expect(invoke('session:layout',null,false,true,panel).ok).toBe(false);
  expect(invoke('session:layout',null,false,true,520).ok).toBe(true);
  expect(invoke('session:layout',null,false,true,520,null).ok).toBe(true); expect(invoke('session:layout',null,false,true,520,'qualquer').ok).toBe(true); for (const account of [5,{},false]) expect(invoke('session:layout',null,false,true,520,account).ok).toBe(false);
  expect(await invoke('hunt:snapshot',saved.id,'false')).toEqual(huntFail);
  expect(invoke('session:layout',null,false,false).ok).toBe(true);
  // arrasto da borda da lateral: esconde as sessões, restaura ao soltar e sozinho após 10 s sem aviso
  const shown = () => created.slice(0,4).map(view => view.visible);
  expect(shown()).toEqual([true,true,true,true]);
  for (const bad of ['true',1,null,undefined]) expect(invoke('session:drag',bad).ok).toBe(false);
  expect((handlers.get('session:drag')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},true) as {ok:boolean}).ok).toBe(false);
  expect(shown()).toEqual([true,true,true,true]);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try {
    expect(invoke('session:drag',true).ok).toBe(true);
    expect(shown()).toEqual([false,false,false,false]);
    shell.emit('resize'); // arrange() durante o arrasto não reexibe
    expect(shown()).toEqual([false,false,false,false]);
    expect(invoke('session:drag',false).ok).toBe(true);
    expect(shown()).toEqual([true,true,true,true]);
    vi.advanceTimersByTime(10_000); // failsafe cancelado ao soltar
    expect(invoke('session:drag',true).ok).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(shown()).toEqual([false,false,false,false]);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([true,true,true,true]);
    // soltar não reexibe sessões escondidas por um painel aberto
    expect(invoke('session:drag',true).ok).toBe(true);
    expect(invoke('session:layout',null,true).ok).toBe(true);
    expect(invoke('session:drag',false).ok).toBe(true);
    expect(shown()).toEqual([false,false,false,false]);
    expect(invoke('session:layout',null,false,false).ok).toBe(true);
    expect(shown()).toEqual([true,true,true,true]);
  } finally { vi.useRealTimers(); }
  // prontidão do /hunt: "carregando" sem carga do frame principal já pode ser lido; did-stop-loading destrava o estado
  const last = created[3]!, lastId = ids[3]!;
  const stateOf = () => (handlers.get('session:states')?.(sender) as {data:Record<string,string>}).data[lastId];
  expect(stateOf()).toBe('loading');
  expect(await invoke('hunt:snapshot',lastId)).toEqual(huntFail);
  last.webContents.loadingMainFrame = false;
  expect(await invoke('hunt:snapshot',lastId)).toEqual({ok:true,data:{estado:'sem-extensao'}});
  last.webContents.emit('did-stop-loading');
  expect(stateOf()).toBe('ready');
  last.webContents.emit('did-fail-load',{},-106,'','',true); last.webContents.emit('did-stop-loading'); // falha não vira "pronta"
  expect(stateOf()).toBe('offline');
  last.webContents.loadingMainFrame = true; last.webContents.emit('did-start-loading');
  expect(stateOf()).toBe('loading');
  const otherFrame = {sender:shell.webContents,senderFrame:{}};
  expect((handlers.get('profiles:list')?.(otherFrame) as {ok:boolean}).ok).toBe(false);
  expect((handlers.get('profiles:create')?.(otherFrame,input) as {ok:boolean}).ok).toBe(false);
  expect((await handlers.get('session:clear')?.(otherFrame,ids[0]) as {ok:boolean}).ok).toBe(false);
  expect((await handlers.get('profiles:remove')?.(otherFrame,ids[0]) as {ok:boolean}).ok).toBe(false);
  expect((handlers.get('profiles:list')?.(sender) as {data:unknown[]}).data).toHaveLength(4);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const corrupt = new DatabaseSync(path);
  const extraId='550e8400-e29b-41d4-a716-446655440000';
  corrupt.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run(extraId,'Extra','a@example.com','','#d4a65f','2026','2026');
  await expect(handlers.get('profiles:remove')?.(sender,ids[0])).resolves.toMatchObject({ok:false});
  await expect(handlers.get('session:restart')?.(sender,ids[0])).resolves.toMatchObject({ok:false});
  expect(invoke('session:layout',null,true).ok).toBe(true);
  expect(created.slice(0,4).every(view => !view.visible)).toBe(true);
  expect(corrupt.prepare('SELECT COUNT(*) AS count FROM profiles').get()).toMatchObject({count:5});
  corrupt.prepare('DELETE FROM profiles WHERE id=?').run(extraId); corrupt.close();
  expect(invoke('session:layout',null,false).ok).toBe(true);
  const diagnostics = handlers.get('diagnostics:sample')?.(sender) as {ok:boolean;data:{memoryKb:number;cpuPercent:number|null;processCount:number}};
  expect(diagnostics.ok).toBe(true);
  expect(diagnostics.data).toMatchObject({memoryKb:2048,cpuPercent:null,processCount:1});
  const deniedDiagnostics = handlers.get('diagnostics:sample')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame}) as {ok:boolean};
  expect(deniedDiagnostics.ok).toBe(false);
  const preferences = handlers.get('preferences:get')?.(sender) as {ok:boolean;data:string};
  expect(preferences).toEqual({ok:true,data:'focus-first'});
  expect((handlers.get('preferences:set')?.(sender,'grid') as {ok:boolean}).ok).toBe(true);
  expect((handlers.get('preferences:set')?.(sender,'focus-first') as {ok:boolean}).ok).toBe(true);
  expect((handlers.get('preferences:get')?.(sender) as {data:string}).data).toBe('focus-first');
  expect((handlers.get('preferences:set')?.(sender,'invalid') as {ok:boolean}).ok).toBe(false);
  expect((handlers.get('preferences:set')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},'grid') as {ok:boolean}).ok).toBe(false);
  const before = created.slice();
  expect(invoke('session:layout',ids[1],false).ok).toBe(true);
  expect(created).toEqual(before);
  expect(created.map(view => view.visible)).toEqual([false,true,false,false]);
  const first = created[0]; const other = created[1];
  if (!first || !other || !ids[0]) throw new Error('Sessões ausentes');
  expect(first.webContents.windowOpenHandler?.()).toEqual({action:'deny'});
  await vi.waitFor(() => expect(notices).toHaveLength(1));
  expect(notices[0]).toContain('navegador');
  expect(openedExternal).toEqual([]);
  noticeChoice = 1;
  expect(first.webContents.windowOpenHandler?.()).toEqual({action:'deny'});
  await vi.waitFor(() => expect(openedExternal).toEqual(['https://pokeidle.io/app']));
  let release: (() => void) | undefined;
  first.webContents.session.block = new Promise<void>(resolve => {release=resolve;});
  first.webContents.deferClose = true;
  const clearHandler = handlers.get('session:clear'); if (!clearHandler) throw new Error('Canal ausente');
  const pending = clearHandler(sender,ids[0]) as Promise<{ok:boolean}>;
  await Promise.resolve();
  expect(first.webContents.session.clearCount).toBe(0);
  const concurrent = await clearHandler(sender,ids[0]) as {ok:boolean};
  expect(concurrent.ok).toBe(false);
  const removeDuringClear = await handlers.get('profiles:remove')?.(sender,ids[0]) as {ok:boolean};
  expect(removeDuringClear.ok).toBe(false);
  first.webContents.completeClose();
  await vi.waitFor(() => expect(first.webContents.session.clearCount).toBe(1));
  release?.(); expect((await pending).ok).toBe(true);
  expect(first.webContents.session.clearCount).toBe(1);
  expect(first.webContents.session.cacheCount).toBe(1);
  expect(other.webContents.session.clearCount).toBe(0);
  expect(other.webContents.isDestroyed()).toBe(false);
  expect(created[4]?.options.webPreferences.partition).toBe(first.options.webPreferences.partition);
  const removeHandler = handlers.get('profiles:remove'); if (!removeHandler || !ids[1]) throw new Error('Canal ausente');
  other.webContents.failClose = true;
  expect((await removeHandler(sender,ids[1]) as {ok:boolean}).ok).toBe(false);
  const listBefore = handlers.get('profiles:list')?.(sender) as {data:unknown[]};
  expect(listBefore.data).toHaveLength(4);
  other.webContents.failClose = false; other.webContents.deferClose = true;
  const pendingRemove = removeHandler(sender,ids[1]) as Promise<{ok:boolean}>;
  await Promise.resolve();
  expect((handlers.get('profiles:list')?.(sender) as {data:unknown[]}).data).toHaveLength(4);
  other.webContents.completeClose();
  expect((await pendingRemove).ok).toBe(true);
  expect((handlers.get('profiles:list')?.(sender) as {data:unknown[]}).data).toHaveLength(3);
  const third = created[2]; const thirdId = ids[2];
  if (!third || !thirdId) throw new Error('Sessão ausente');
  third.webContents.destroyBeforeThrow = true;
  const restart = handlers.get('session:restart'); if (!restart) throw new Error('Canal ausente');
  expect((await restart(sender,thirdId) as {ok:boolean}).ok).toBe(false);
  expect((handlers.get('session:states')?.(sender) as {data:Record<string,string>}).data[thirdId]).toBe('error');
  expect((await restart(sender,thirdId) as {ok:boolean}).ok).toBe(true);
  expect(created.at(-1)?.options.webPreferences.partition).toBe(third.options.webPreferences.partition);
 });
 it('carrega várias extensões antes do jogo, audita e nunca impede a sessão de abrir', async () => {
  type Info = {id:string;catalogId:string|null;name:string;version:string|null;path:string;enabled:boolean;loaded:number;sessions:number;verdict:string|null;findings:{kind:string}[];hosts:string[];approvedHosts:string[];pending:boolean;error:string|null};
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = async (channel:string,...args:unknown[]) => await handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:Info[];error?:string};
  const live = () => created.filter(view => !view.webContents.isDestroyed() && shell.children.has(view));
  const HUNT = 'mhnplloljgchpfpcpbhmcokmnefodjnh', SMART = 'lhfeijlnlbglakplddjgbaopgcdfkcmm';
  const manifest = {manifest_version:3,name:'/hunt for PokeIdle',version:'1.0.17',content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js']}]};
  const folder = (name:string, content:object, files: Record<string,string> = {}) => { const path=join(directory,name); mkdirSync(path,{recursive:true}); writeFileSync(join(path,'manifest.json'),JSON.stringify(content)); for (const [file,code] of Object.entries(files)) writeFileSync(join(path,file),code); return path; };
  expect((await call('extensions:list')).data).toEqual([]);
  const intruder = {sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame};
  for (const channel of ['extensions:list','extensions:detect','extensions:add','extensions:toggle','extensions:remove','extensions:approve','extensions:store']) expect((await handlers.get(channel)?.(intruder,'x',true) as {ok:boolean}).ok).toBe(false);
  for (const channel of ['update:get','update:check','update:download','update:install','update:auto']) expect((await handlers.get(channel)?.(intruder,true) as {ok:boolean}).ok).toBe(false);
  expect((await call('extensions:toggle',1,true)).ok).toBe(false); expect((await call('extensions:toggle','x','sim')).ok).toBe(false); expect((await call('extensions:remove',{})).ok).toBe(false);
  // pasta recusada pelo validador (service worker): nada é salvo nem carregado
  chosenFolder = folder('piloto',{...manifest,background:{service_worker:'sw.js'}});
  const refused = await call('extensions:add');
  expect(refused.ok).toBe(false); expect(refused.error).toContain('background');
  chosenFolder = null;
  expect((await call('extensions:add')).data).toEqual([]);
  // pasta bloqueada pela auditoria entra na lista com o motivo, mas não é carregada
  chosenFolder = folder('rede',manifest,{'a.js':'eval(code)'});
  const blocked = (await call('extensions:add')).data?.[0];
  expect(blocked).toMatchObject({verdict:'bloqueada',enabled:true,loaded:0,sessions:3,catalogId:null}); expect(blocked?.error).toContain('eval()');
  expect(live().every(view => view.webContents.session.extensions.items.length === 0)).toBe(true);
  expect((await call('extensions:add')).error).toContain('já está');
  // duas válidas: ambas carregadas em todas as sessões, sem acesso a arquivos
  const hunt = folder(`Extensions/${HUNT}/1.0.17_0`,manifest,{'a.js':'const x=1'});
  const smart = folder(`Extensions/${SMART}/0.10.0_0`,{...manifest,name:'Smart Market',version:'0.10.0',permissions:['storage']},{'a.js':"input.dispatchEvent(new Event('input')); ws.send('q')"});
  chosenFolder = hunt; await call('extensions:add'); chosenFolder = smart;
  const listed = (await call('extensions:add')).data ?? [];
  expect(listed.map(item => [item.catalogId,item.verdict,item.loaded,item.enabled])).toEqual([[null,'bloqueada',0,true],[HUNT,'leitura',3,true],[SMART,'interage',3,true]]);
  expect(live().map(view => view.webContents.session.extensions.items.map(item => item.path))).toEqual(Array(3).fill([hunt,smart]));
  expect(live()[0]?.webContents.session.extensions.options).toEqual([{allowFileAccess:false},{allowFileAccess:false}]);
  // sessão reaberta: as duas extensões antes do loadURL
  const id = (handlers.get('profiles:list')?.(sender) as {data:{id:string}[]}).data[0]?.id;
  order.length = 0;
  expect((await handlers.get('session:restart')?.(sender,id) as {ok:boolean}).ok).toBe(true);
  await vi.waitFor(() => expect(created.at(-1)?.webContents.loadedUrl).toBe('https://pokeidle.io/app'));
  expect(order).toEqual(['extension','extension','url']);
  // falha ao carregar: a sessão abre sem as extensões e o erro aparece na lista
  failExtension = true;
  expect((await handlers.get('session:restart')?.(sender,id) as {ok:boolean}).ok).toBe(true);
  await vi.waitFor(() => expect(created.at(-1)?.webContents.loadedUrl).toBe('https://pokeidle.io/app'));
  const partial = (await call('extensions:list')).data?.find(item => item.catalogId === HUNT);
  failExtension = false;
  expect(partial).toMatchObject({loaded:2,sessions:3}); expect(partial?.error).toContain('sessão segue aberta');
  // a lista se recupera ao sincronizar de novo
  expect((await call('extensions:toggle',HUNT,true)).data?.find(item => item.catalogId === HUNT)).toMatchObject({loaded:3,error:null});
  // desabilitar uma remove só ela, em todas as sessões; a /hunt perde o "hasHunt" mas a Smart Market segue
  expect((await call('extensions:toggle',HUNT,false)).data?.map(item => [item.catalogId,item.enabled,item.loaded])).toEqual([[null,true,0],[HUNT,false,0],[SMART,true,3]]);
  expect(live().map(view => view.webContents.session.extensions.items.map(item => item.path))).toEqual(Array(3).fill([smart]));
  // detecção na pasta do navegador (o home falso é a pasta temporária)
  if (process.platform !== 'win32') {
    folder(`.config/chromium/Default/Extensions/${HUNT}/1.0.18_0`,{...manifest,version:'1.0.18'},{'a.js':'1'});
    const detected = (await call('extensions:detect')).data;
    expect(detected?.find(item => item.catalogId === HUNT)).toMatchObject({enabled:false,version:'1.0.18'}); // atualiza o caminho, mantém o "desabilitada"
  }
  expect((await call('extensions:toggle',HUNT,true)).data?.find(item => item.catalogId === HUNT)).toMatchObject({enabled:true,loaded:3});
  // remover tira das sessões e da lista
  expect((await call('extensions:remove',HUNT)).data?.map(item => item.catalogId)).toEqual([null,SMART]);
  expect((await call('extensions:remove',SMART)).data?.map(item => item.catalogId)).toEqual([null]);
  expect(live().every(view => view.webContents.session.extensions.items.length === 0)).toBe(true);
  expect((await call('extensions:remove','nada')).ok).toBe(false);
  // loja: só ids do catálogo, nunca URL do renderer
  const before = openedExternal.length; // outros testes já abriram o jogo no navegador
  expect((await call('extensions:store','https://evil.example')).ok).toBe(false);
  expect(openedExternal.length).toBe(before);
  expect((await call('extensions:store',SMART)).ok).toBe(true); expect(openedExternal.slice(before)).toEqual([`https://chromewebstore.google.com/detail/${SMART}`]);
 });
 it('extensão que acessa outros sites só carrega com os hosts aprovados; o catálogo pré-aprova, e um host novo pede de novo', async () => {
  type Info = {id:string;catalogId:string|null;verdict:string|null;loaded:number;sessions:number;hosts:string[];approvedHosts:string[];pending:boolean;enabled:boolean;error:string|null};
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = async (channel:string,...args:unknown[]) => await handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:Info[];error?:string};
  const live = () => created.filter(view => !view.webContents.isDestroyed() && shell.children.has(view));
  const HUNT = 'mhnplloljgchpfpcpbhmcokmnefodjnh';
  const manifest = {manifest_version:3,name:'Ponte',version:'1.0.23',content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js']}]};
  const folder = (name:string, files: Record<string,string>) => { const path=join(directory,name); mkdirSync(path,{recursive:true}); writeFileSync(join(path,'manifest.json'),JSON.stringify(manifest)); for (const [file,code] of Object.entries(files)) writeFileSync(join(path,file),code); return path; };
  const bridge = "const U=['https://pokeidleguide.io/api/wishlist','https://pokeidle-gg.pages.dev/api/wishlist']; fetch(U[0],{credentials:'omit'})";
  // catálogo: /hunt na pasta do navegador carrega sozinha porque os dois hosts já estão pré-aprovados
  chosenFolder = folder(`Extensions/${HUNT}/1.0.23_0`,{'a.js':bridge});
  const hunt = (await call('extensions:add')).data?.find(item => item.catalogId === HUNT);
  expect(hunt).toMatchObject({catalogId:HUNT,verdict:'externa',pending:false,loaded:3,hosts:['pokeidle-gg.pages.dev','pokeidleguide.io'],error:null});
  // a mesma extensão em pasta qualquer (id fora do catálogo) NÃO herda a pré-aprovação
  chosenFolder = folder('ponte',{'a.js':bridge});
  const added = (await call('extensions:add')).data?.find(item => item.catalogId === null && item.hosts.length > 0);
  expect(added).toMatchObject({catalogId:null,verdict:'externa',pending:true,loaded:0,approvedHosts:[],error:null});
  expect(live().map(view => view.webContents.session.extensions.items.length)).toEqual([1,1,1]);
  const id = added?.id ?? '';
  // aprovar: só o dono da interface, conjunto igual ao auditado, extensão que realmente é externa
  const intruder = {sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame};
  expect((await handlers.get('extensions:approve')?.(intruder,id) as {ok:boolean}).ok).toBe(false);
  expect((await call('extensions:approve',1)).ok).toBe(false); expect((await call('extensions:approve',id,'x')).ok).toBe(false); expect((await call('extensions:approve','nada')).ok).toBe(false);
  expect((await call('extensions:approve',id,['pokeidleguide.io'])).error).toContain('mudou'); // a tela mostrou outro conjunto
  expect((await call('extensions:approve',HUNT)).data?.find(item => item.id === HUNT)?.pending).toBe(false);
  const approved = (await call('extensions:approve',id,['pokeidleguide.io','pokeidle-gg.pages.dev'])).data?.find(item => item.id === id);
  expect(approved).toMatchObject({pending:false,loaded:3,approvedHosts:['pokeidle-gg.pages.dev','pokeidleguide.io']});
  expect(live().map(view => view.webContents.session.extensions.items.length)).toEqual([2,2,2]);
  // a extensão passa a falar com um site novo: sai das sessões e pede aprovação de novo
  writeFileSync(join(directory,'ponte','a.js'),bridge + "; fetch('https://novo.example.com/x')");
  const grown = (await call('extensions:list')).data?.find(item => item.id === id);
  expect(grown).toMatchObject({pending:true,loaded:0,hosts:['novo.example.com','pokeidle-gg.pages.dev','pokeidleguide.io']});
  expect(live().map(view => view.webContents.session.extensions.items.length)).toEqual([1,1,1]);
  expect((await call('extensions:approve',id)).data?.find(item => item.id === id)).toMatchObject({pending:false,loaded:3});
  // extensão que não é externa não tem o que aprovar
  expect((await call('extensions:approve',HUNT)).ok).toBe(true); // continua externa e coberta: aprovar de novo é inofensivo
  writeFileSync(join(directory,'ponte','a.js'),'const x=1');
  expect((await call('extensions:approve',id)).error).toContain('não precisa');
 });
 it('expõe a versão e a preferência de atualização; fora do app empacotado fica desativada', async () => {
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = async (channel:string,...args:unknown[]) => await handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:{version:string;packaged:boolean;autoCheck:boolean;status:{state:string}}};
  expect((await call('update:get')).data).toEqual({version:'0.1.0',packaged:false,autoCheck:true,status:{state:'disabled'}});
  expect((await call('update:auto',false)).data?.autoCheck).toBe(false); expect((await call('update:auto','x')).ok).toBe(false);
  expect((await call('update:check')).data?.status).toEqual({state:'disabled'});
  expect((await call('update:download')).data?.status).toEqual({state:'disabled'});
  expect((await call('update:install')).ok).toBe(false);
 });
 it('a janela usa a barra de título escondida com overlay nas cores do app, ícone do app e AppUserModelId', () => {
  expect(shell.options).toMatchObject({title:'PokéHub',backgroundColor:'#0f1218',webPreferences:{spellcheck:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  expect(String(shell.options.icon).replace(/\\/g,'/')).toMatch(/\/build\/icon\.png$/);
  if (process.platform === 'darwin') expect(shell.options.titleBarStyle).toBe('hiddenInset');
  else expect(shell.options).toMatchObject({titleBarStyle:'hidden',titleBarOverlay:{color:'#bd6951',symbolColor:'#fff6ef',height:48}});
  if (process.platform === 'win32') expect(appIds).toEqual(['local.pokehub.desktop']);
 });
 it('só avisa a interface quando o estado muda e ignora o carregamento de subframes', async () => {
  const { partitionFor } = await import('../electron/partition');
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const id = (handlers.get('profiles:list')?.(sender) as {data:{id:string}[]}).data[0]!.id;
  const view = [...shell.children].find(item => item.options.webPreferences.partition === partitionFor(id))!;
  const sentFor = () => shell.webContents.sent.filter(([channel,payload]) => channel === 'session:status' && payload.id === id).map(([,payload]) => payload.state);
  view.webContents.loadingMainFrame = true; view.webContents.emit('did-start-loading'); view.webContents.emit('did-stop-loading');
  shell.webContents.sent.length = 0;
  view.webContents.loadingMainFrame = false; view.webContents.emit('did-start-loading'); // iframe/anúncio: não vira "carregando"
  expect(sentFor()).toEqual([]);
  view.webContents.loadingMainFrame = true; view.webContents.emit('did-start-loading'); view.webContents.emit('did-start-loading');
  expect(sentFor()).toEqual(['loading']); // a repetição não gera outro evento
  view.webContents.emit('did-stop-loading'); view.webContents.emit('did-stop-loading');
  expect(sentFor()).toEqual(['loading','ready']);
 });
 it('suspende e retoma só a view, sem tocar nos dados da sessão', async () => {
  const { partitionFor } = await import('../electron/partition');
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const ids = (handlers.get('profiles:list')?.(sender) as {data:{id:string}[]}).data.map(item => item.id);
  const id = ids[0]!;
  const viewOf = () => [...shell.children].filter(item => item.options.webPreferences.partition === partitionFor(id)).at(-1);
  const call = async (channel:string,...args:unknown[]) => await handlers.get(channel)?.(sender,...args) as {ok:boolean};
  const states = () => (handlers.get('session:states')?.(sender) as {data:Record<string,string>}).data;
  const foreign = {sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame};
  for (const channel of ['session:suspend','session:resume']) { expect((await handlers.get(channel)?.(foreign,id) as {ok:boolean}).ok).toBe(false); for (const bad of ['nao-existe',null,42,{id}]) expect((await call(channel,bad)).ok).toBe(false); }
  expect((await call('session:resume',id)).ok).toBe(false); // só retoma o que está suspenso
  const before = viewOf()!;
  expect((await call('session:suspend',id)).ok).toBe(true);
  expect(before.webContents.isDestroyed()).toBe(true); expect(viewOf()).toBeUndefined();
  expect(before.webContents.session.clearCount).toBe(0); // login e partição intactos
  expect(states()[id]).toBe('suspended');
  expect(shell.webContents.sent.filter(([channel,payload]) => channel === 'session:status' && payload.id === id).at(-1)?.[1].state).toBe('suspended');
  expect((await call('session:suspend',id)).ok).toBe(false);
  expect(await handlers.get('hunt:snapshot')?.(sender,id)).toEqual({ok:false,error:'Dados do /hunt indisponíveis nesta conta'}); // suspensa não é legível
  expect((handlers.get('profiles:list')?.(sender) as {data:unknown[]}).data).toHaveLength(ids.length); // continua na lista (ganha coluna com o marcador)
  expect((await call('session:resume',id)).ok).toBe(true);
  const again = viewOf()!;
  expect(again).not.toBe(before); expect(again.options.webPreferences.partition).toBe(before.options.webPreferences.partition);
  await vi.waitFor(() => expect(again.webContents.loadedUrl).toBe('https://pokeidle.io/app')); expect(states()[id]).toBe('loading');
  expect((await call('session:resume',id)).ok).toBe(false);
 });
 it('Modo leve e som só no foco: preferências validadas e áudio mutado fora do foco', async () => {
  const { partitionFor } = await import('../electron/partition');
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = (channel:string,...args:unknown[]) => handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:unknown};
  const ids = (call('profiles:list') as {data:{id:string}[]}).data.map(item => item.id);
  const viewOf = (id:string) => [...shell.children].find(item => item.options.webPreferences.partition === partitionFor(id))!;
  const last = (id:string) => viewOf(id).webContents.muted.at(-1);
  expect(call('performance:get')).toEqual({ok:true,data:{lite:false,muteUnfocused:false}});
  for (const bad of ['x',null,{lite:'sim'},{muteUnfocused:1}]) expect(call('performance:set',bad).ok).toBe(false);
  expect((handlers.get('performance:set')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},{lite:true}) as {ok:boolean}).ok).toBe(false);
  expect(call('session:layout',ids[0]!,false,false).ok).toBe(true);
  expect(ids.map(last).every(value => value === undefined || value === false)).toBe(true); // sem a opção, ninguém é mutado
  expect(call('performance:set',{muteUnfocused:true})).toEqual({ok:true,data:{lite:false,muteUnfocused:true}});
  expect(ids.map(last)).toEqual(ids.map((_id,index) => index !== 0)); // só a conta em foco tem som
  expect(call('session:layout',null,false,false).ok).toBe(true);
  expect(ids.map(last).every(value => value === false)).toBe(true); // na grade todas as colunas estão visíveis
  expect(call('session:layout',ids[1]!,false,false).ok).toBe(true);
  expect(ids.map(last)).toEqual(ids.map((_id,index) => index !== 1));
  expect(call('performance:set',{lite:true,muteUnfocused:false})).toEqual({ok:true,data:{lite:true,muteUnfocused:false}}); // o Modo leve também muta fora do foco
  expect(ids.map(last)).toEqual(ids.map((_id,index) => index !== 1));
  expect(call('performance:set',{lite:false})).toEqual({ok:true,data:{lite:false,muteUnfocused:false}});
  expect(ids.map(last).every(value => value === false)).toBe(true);
  expect(call('session:layout',null,false,false).ok).toBe(true);
 });
 it('bandeja: preferências validadas, esconder ao fechar/minimizar, aviso único, menu e Sair', async () => {
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = (channel:string,...args:unknown[]) => handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:unknown};
  const tray = trays[0]!; expect(trays).toHaveLength(1);
  expect(tray.icon).toEqual({width:16}); expect(tray.tip).toMatch(/^PokéHub — \d conta/);
  expect(call('tray:get')).toEqual({ok:true,data:{onClose:true,onMinimize:true,hintShown:false}});
  for (const bad of ['x',null,{onClose:'sim'},{onMinimize:1}]) expect(call('tray:set',bad).ok).toBe(false);
  expect((handlers.get('tray:set')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},{onClose:false}) as {ok:boolean}).ok).toBe(false);
  // fechar: cancela o fechar e esconde (as views continuam)
  const viewsBefore = shell.children.size; windowCalls.length = 0;
  const prevent = vi.fn(); shell.emit('close',{preventDefault:prevent});
  expect(prevent).toHaveBeenCalledTimes(1); expect(windowCalls).toEqual(['hide']); expect(shell.children.size).toBe(viewsBefore);
  expect(tray.balloons).toHaveLength(1); expect(call('tray:get').data).toMatchObject({hintShown:true});
  shell.emit('minimize'); expect(windowCalls).toEqual(['hide','hide']); expect(tray.balloons).toHaveLength(1); // aviso só na primeira vez
  // opções desligadas: o fechar segue normal
  expect(call('tray:set',{onClose:false,onMinimize:false})).toEqual({ok:true,data:{onClose:false,onMinimize:false,hintShown:true}});
  const noPrevent = vi.fn(); windowCalls.length = 0; shell.emit('close',{preventDefault:noPrevent}); shell.emit('minimize');
  expect(noPrevent).not.toHaveBeenCalled(); expect(windowCalls).toEqual([]);
  expect(call('tray:set',{onClose:true,onMinimize:true}).ok).toBe(true);
  // clique no ícone e segunda instância mostram a janela escondida
  windowCalls.length = 0; tray.emit('click'); expect(windowCalls).toEqual(['show','focus']);
  windowCalls.length = 0; fakeApp.emit('second-instance'); expect(windowCalls).toEqual(['show','focus']);
  // menu (reconstruído com debounce): Abrir, uma entrada por conta, Modo leve e Sair
  const total = (call('profiles:list').data as unknown[]).length; await vi.waitFor(() => expect(menuTemplate.filter(item => / — /.test(item.label ?? '')).length).toBe(total));
  const labels = menuTemplate.map(item => item.type === 'separator' ? '-' : item.label);
  expect(labels[0]).toBe('Abrir PokéHub'); expect(labels.filter(label => / — (pronta|carregando|suspensa|sem conexão|precisa entrar|com erro)$/.test(label ?? ''))).toHaveLength(total); expect(labels.at(-3)).toBe('Modo leve'); expect(labels.at(-2)).toBe('Acesso remoto: desligado'); expect(labels.at(-1)).toBe('Sair do PokéHub');
  const profileItem = menuTemplate[2]!; shell.webContents.sent.length = 0; windowCalls.length = 0; profileItem.click?.();
  expect(windowCalls).toEqual(['show','focus']); expect(shell.webContents.sent.at(-1)?.[0]).toBe('workspace:focus');
  const lite = menuTemplate.find(item => item.label === 'Modo leve')!; lite.click?.();
  expect(call('performance:get')).toEqual({ok:true,data:{lite:true,muteUnfocused:false}}); expect(shell.webContents.sent.some(entry => entry[0] === 'performance:changed')).toBe(true);
  expect(call('performance:set',{lite:false}).ok).toBe(true);
  // Sair: before-quit libera o fechar, o fechar seguinte não é cancelado e o guarda de alterações continua valendo
  fakeApp.emit('before-quit');
  const quitClose = vi.fn(); windowCalls.length = 0; shell.emit('close',{preventDefault:quitClose}); expect(quitClose).not.toHaveBeenCalled(); expect(windowCalls).toEqual([]);
  confirmChoice = 1; const unload = vi.fn(); shell.webContents.emit('will-prevent-unload',{preventDefault:unload}); expect(unload).toHaveBeenCalledTimes(1);
  confirmChoice = 0; shell.webContents.emit('will-prevent-unload',{preventDefault:unload}); // "Continuar no PokéHub": volta a seguir a bandeja
  const again = vi.fn(); shell.emit('close',{preventDefault:again}); expect(again).toHaveBeenCalledTimes(1);
 });
 it('monitor por conta: agrupa CPU e memória privada por conta, hub e GPU, só para a interface', async () => {
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const ids = (handlers.get('profiles:list')?.(sender) as {data:{id:string}[]}).data.map(item => item.id);
  type Group = {cpuPercent:number|null;privateKb:number|null;workingSetKb:number|null;count:number};
  type Sample = {ok:boolean;data:{accounts:{id:string;cpuPercent:number|null;privateKb:number|null;workingSetKb:number|null}[];hub:Group;gpu:Group;other:Group}};
  expect((handlers.get('diagnostics:processes')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame}) as {ok:boolean}).ok).toBe(false);
  richMetrics = true;
  try {
   await new Promise(resolve => setTimeout(resolve,1100)); // a leitura anterior de getAppMetrics é reaproveitada por 1 s
   const sample = handlers.get('diagnostics:processes')?.(sender) as Sample;
   expect(sample.ok).toBe(true);
   expect(sample.data.accounts.map(item => item.id)).toEqual(ids);
   for (const account of sample.data.accounts) expect(account).toMatchObject({privateKb:3000,workingSetKb:4000});
   expect(sample.data.hub).toMatchObject({count:1,privateKb:2048}); // sem privateBytes, usa o conjunto de trabalho
   expect(sample.data.gpu).toMatchObject({count:1,workingSetKb:500});
   expect(sample.data.other.count).toBe(0);
  } finally { richMetrics = false; }
 });
 it('o resize refaz o layout no máximo a cada ~33 ms e sempre uma última vez ao parar', () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try {
   const base = shell.sizeCalls;
   for (let i = 0; i < 6; i++) shell.emit('resize');
   expect(shell.sizeCalls - base).toBe(1); // a primeira é na hora
   vi.advanceTimersByTime(33);
   expect(shell.sizeCalls - base).toBe(2); // e uma final com o tamanho mais recente
   vi.advanceTimersByTime(200);
   expect(shell.sizeCalls - base).toBe(2);
   shell.emit('resize'); expect(shell.sizeCalls - base).toBe(3);
   vi.advanceTimersByTime(100); expect(shell.sizeCalls - base).toBe(3);
  } finally { vi.useRealTimers(); }
 });
});
