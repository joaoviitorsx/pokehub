import { afterAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(),'pokehub-main-'));
type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const created: FakeView[] = [];
let confirmChoice = 0;
let saveTarget: string | null = null; // caminho devolvido pelo diálogo de salvar; null = cancelado
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
    const item = {id:'hunt',path}; this.items.push(item); return item;
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
  getAppMetrics: () => [{pid:123,creationTime:100,memory:{workingSetSize:2048},cpu:{percentCPUUsage:3}}],
  quit: () => {},
});
vi.doMock('electron', () => ({app: fakeApp, BrowserWindow:FakeWindow, WebContentsView:FakeView, ipcMain:{handle: (name:string, handler:Handler) => handlers.set(name,handler)}, shell:{openExternal:async (url:string) => {openedExternal.push(url);}}, dialog:{showSaveDialog:async () => ({canceled:saveTarget === null,filePath:saveTarget ?? ''}),showOpenDialog:async () => ({canceled:chosenFolder === null,filePaths:chosenFolder === null ? [] : [chosenFolder]}),showErrorBox() {},showMessageBoxSync:()=>confirmChoice,showMessageBox:async (_window:unknown, options:{message:string}) => {notices.push(options.message);return {response:noticeChoice};}}}));
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
  // só GrindolinoError chega à interface; o resto (aqui, a violação de PK) vira mensagem genérica
  expect(invoke('grindolino:createHunt',{name:'',region:'',requiredTrainerLevel:null})).toEqual({ok:false,error:'Nome da hunt deve ter de 1 a 60 caracteres'});
  expect(invoke('grindolino:addForecast',{accountId:saved.id,huntId:'550e8400-e29b-41d4-a716-446655440000',xpPerHour:1,coinsPerHour:null})).toEqual({ok:false,error:'Hunt não encontrada'});
  expect(invoke('profiles:update',1,input)).toEqual({ok:false,error:'Não foi possível concluir a operação. Confira os dados e tente novamente.'});
  expect(invoke('grindolino:compare',{objective:'xp'})).toEqual({ok:true,data:[]});
  // histórico: pedido validado no main; a exportação só grava no caminho que o diálogo nativo devolveu
  const scope = {accountId:null,huntId:null,range:'7d'};
  expect(invoke('analytics:series',{...scope,metric:'xp'})).toMatchObject({ok:true,data:{granularity:'day',series:ids.map(accountId => ({accountId,points:[]}))}});
  expect(invoke('analytics:series',{...scope,metric:'dps'})).toEqual({ok:false,error:'Métrica inválida'});
  expect(await invoke('analytics:export',{format:'exe',scope})).toEqual({ok:false,error:'Formato inválido'});
  expect(await invoke('analytics:export',{format:'csv',scope})).toEqual({ok:true,data:{saved:false,fileName:null,rows:0}});
  saveTarget = join(directory,'saida.csv');
  expect(await invoke('analytics:export',{format:'csv',scope})).toEqual({ok:true,data:{saved:true,fileName:'saida.csv',rows:0}});
  expect(readFileSync(saveTarget,'utf8').startsWith('\uFEFFtipo;data;conta;hunt')).toBe(true);
  saveTarget = join(directory,'pasta-inexistente','saida.json');
  expect(await invoke('analytics:export',{format:'json',scope})).toEqual({ok:false,error:'Não foi possível exportar. Confira a pasta escolhida e tente novamente.'});
  expect(await handlers.get('analytics:export')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},{format:'csv',scope})).toEqual({ok:false,error:'Origem não autorizada.'});
  const untrusted = handlers.get('profiles:list')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame}) as {ok:boolean};
  expect(untrusted.ok).toBe(false);
  // /hunt: id desconhecido, tipo errado, origem não confiável e sessão ainda carregando não executam nada na página
  const huntFail = {ok:false,error:'Dados do /hunt indisponíveis nesta conta'};
  for (const id of ['nao-existe',null,42,{id:saved.id},saved.id]) expect(await invoke('hunt:snapshot',id)).toEqual(huntFail);
  expect(await handlers.get('hunt:snapshot')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},saved.id)).toEqual(huntFail);
  for (const id of ['nao-existe',null,saved.id]) expect(await invoke('hunt:team',id)).toEqual(huntFail);
  expect(await handlers.get('hunt:team')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},saved.id)).toEqual(huntFail);
  // medição ao vivo: mesma fronteira; sessão ainda carregando e origem não confiável não executam nada na página
  expect(invoke('live:status')).toEqual({ok:true,data:{active:[],ended:[]}});
  expect(await invoke('live:start',saved.id,null)).toEqual({ok:false,error:'Abra o jogo nesta conta e espere carregar para iniciar a medição.'});
  expect(await invoke('live:start','nao-existe',null)).toEqual({ok:false,error:'Conta inválida'});
  expect(await invoke('live:stop',saved.id)).toEqual({ok:false,error:'Esta conta não está em medição.'});
  expect(await handlers.get('live:start')?.({sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame},saved.id,null)).toEqual({ok:false,error:'Origem não autorizada.'});
  expect(invoke('session:layout',null,false,'sim').ok).toBe(false);
  expect(invoke('session:layout',null,false,true).ok).toBe(true);
  for (const panel of [279,521,300.5,'340',null,NaN]) expect(invoke('session:layout',null,false,true,panel).ok).toBe(false);
  expect(invoke('session:layout',null,false,true,520).ok).toBe(true);
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
 it('carrega a extensão /hunt antes do jogo e nunca impede a sessão de abrir', async () => {
  type Status = {enabled:boolean;path:string|null;name:string|null;version:string|null;error:string|null;loaded:number;sessions:number};
  const sender = {sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
  const call = async (channel:string,...args:unknown[]) => await handlers.get(channel)?.(sender,...args) as {ok:boolean;data?:Status;error?:string};
  const live = () => created.filter(view => !view.webContents.isDestroyed() && shell.children.has(view));
  const manifest = {manifest_version:3,name:'/hunt for PokeIdle',version:'1.0.17',content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js']}]};
  const folder = (name:string, content:object) => { const path=join(directory,name); mkdirSync(path,{recursive:true}); writeFileSync(join(path,'manifest.json'),JSON.stringify(content)); return path; };
  expect((await call('extension:status')).data).toEqual({enabled:false,path:null,name:null,version:null,error:null,loaded:0,sessions:3});
  const intruder = {sender:created[0]?.webContents,senderFrame:created[0]?.webContents.mainFrame};
  for (const channel of ['extension:status','extension:detect','extension:choose','extension:set']) expect((await handlers.get(channel)?.(intruder,true) as {ok:boolean}).ok).toBe(false);
  expect((await call('extension:set','sim')).ok).toBe(false);
  // pasta recusada no main: nada é salvo nem carregado
  chosenFolder = folder('ruim',{...manifest,permissions:['tabs']});
  const refused = (await call('extension:choose')).data;
  expect(refused).toMatchObject({enabled:false,loaded:0}); expect(refused?.error).toContain('permissions');
  chosenFolder = null;
  expect((await call('extension:choose')).data).toMatchObject({enabled:false,error:null});
  // pasta válida: salva e carrega nas sessões abertas, sem acesso a arquivos
  const good = folder('boa',manifest); chosenFolder = good;
  expect((await call('extension:choose')).data).toEqual({enabled:true,path:good,name:'/hunt for PokeIdle',version:'1.0.17',error:null,loaded:3,sessions:3});
  expect(live().map(view => view.webContents.session.extensions.items)).toEqual(Array(3).fill([{id:'hunt',path:good}]));
  expect(live()[0]?.webContents.session.extensions.options).toEqual([{allowFileAccess:false}]);
  // sessão reaberta: extensão antes do loadURL
  const id = (handlers.get('profiles:list')?.(sender) as {data:{id:string}[]}).data[0]?.id;
  order.length = 0;
  expect((await handlers.get('session:restart')?.(sender,id) as {ok:boolean}).ok).toBe(true);
  await vi.waitFor(() => expect(created.at(-1)?.webContents.loadedUrl).toBe('https://pokeidle.io/app'));
  expect(order).toEqual(['extension','url']);
  // falha ao carregar: a sessão abre sem a extensão e o erro aparece no status
  failExtension = true;
  expect((await handlers.get('session:restart')?.(sender,id) as {ok:boolean}).ok).toBe(true);
  await vi.waitFor(() => expect(created.at(-1)?.webContents.loadedUrl).toBe('https://pokeidle.io/app'));
  const partial = (await call('extension:status')).data;
  expect(partial).toMatchObject({enabled:true,loaded:2,sessions:3}); expect(partial?.error).toContain('sessão segue aberta');
  failExtension = false;
  // detecção na pasta do navegador (o home falso é a pasta temporária)
  if (process.platform !== 'win32') {
    expect((await call('extension:set',false)).data).toMatchObject({enabled:false,path:null,loaded:0});
    expect((await call('extension:detect')).data?.error).toContain('não encontrada');
    const installed = folder('.config/chromium/Default/Extensions/mhnplloljgchpfpcpbhmcokmnefodjnh/1.0.18_0',{...manifest,version:'1.0.18'});
    expect((await call('extension:set',true)).data).toMatchObject({enabled:true,path:installed,version:'1.0.18',loaded:3});
  }
  // desativar remove de todas as sessões
  expect((await call('extension:set',false)).data).toEqual({enabled:false,path:null,name:null,version:null,error:null,loaded:0,sessions:3});
  expect(live().every(view => view.webContents.session.extensions.items.length === 0)).toBe(true);
 });
});
