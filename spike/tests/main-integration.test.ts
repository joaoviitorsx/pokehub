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
  send() {}
  loadURL(url: string) { order.push('url'); this.loadedUrl = url; this.emit('did-start-loading'); return Promise.resolve(); }
  reload() {}
  close() { if (this.destroyBeforeThrow) {this.destroyed=true;throw new Error('fechamento parcial');} if (this.failClose) throw new Error('não fechou'); if (!this.deferClose) this.completeClose(); }
  completeClose() { this.destroyed = true; this.emit('destroyed'); }
  loadingMainFrame = true;
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
let shell: FakeWindow;
class FakeWindow extends EventEmitter {
  webContents = new FakeContents();
  children = new Set<FakeView>();
  contentView = {addChildView:(view:FakeView) => {this.children.add(view);}, removeChildView:(view:FakeView) => {if (!this.children.delete(view)) throw new Error('view não anexada');}};
  constructor() { super(); shell = this; }
  getContentSize() { return [1280,800]; }
  removeMenu() {}
  isDestroyed() { return false; }
  isMinimized() { return false; }
  focus() {}
  loadFile() { return Promise.resolve(); }
}
const fakeApp = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  getPath: () => directory,
  getVersion: () => '0.1.0',
  getAppMetrics: () => [{pid:123,creationTime:100,memory:{workingSetSize:2048},cpu:{percentCPUUsage:3}}],
  quit: () => {},
});
vi.doMock('electron', () => ({app: fakeApp, BrowserWindow:FakeWindow, WebContentsView:FakeView, ipcMain:{handle: (name:string, handler:Handler) => handlers.set(name,handler)}, shell:{openExternal:async (url:string) => {openedExternal.push(url);}}, dialog:{showOpenDialog:async () => ({canceled:chosenFolder === null,filePaths:chosenFolder === null ? [] : [chosenFolder]}),showErrorBox() {},showMessageBoxSync:()=>confirmChoice,showMessageBox:async (_window:unknown, options:{message:string}) => {notices.push(options.message);return {response:noticeChoice};}}}));
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
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
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
});
