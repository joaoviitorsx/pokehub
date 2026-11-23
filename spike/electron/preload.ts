import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('pokehub', {
  list: () => ipcRenderer.invoke('profiles:list'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setStartupMode: (mode: unknown) => ipcRenderer.invoke('preferences:set',mode),
  initialFocus: () => ipcRenderer.invoke('workspace:initial-focus'),
  create: (input: unknown) => ipcRenderer.invoke('profiles:create',input),
  update: (id: string,input: unknown) => ipcRenderer.invoke('profiles:update',id,input),
  remove: (id: string) => ipcRenderer.invoke('profiles:remove',id),
  layout: (id: string | null,hide: boolean,side: boolean,panel?: number,account?: string | null) => ipcRenderer.invoke('session:layout',id,hide,side,panel,account ?? null),
  drag: (active: boolean) => ipcRenderer.invoke('session:drag',active),
  huntSnapshot: (id: string,soLiberadas?: boolean) => ipcRenderer.invoke('hunt:snapshot',id,soLiberadas),
  onToggleSide: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:toggle-side', listener);
    return () => ipcRenderer.removeListener('workspace:toggle-side', listener);
  },
  onToggleExpand: (callback: (id: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string | null) => callback(id);
    ipcRenderer.on('workspace:toggle-expand', listener);
    return () => ipcRenderer.removeListener('workspace:toggle-expand', listener);
  },
  reload: (id: string) => ipcRenderer.invoke('session:reload',id),
  restart: (id: string) => ipcRenderer.invoke('session:restart',id),
  clearSession: (id: string) => ipcRenderer.invoke('session:clear',id),
  states: () => ipcRenderer.invoke('session:states'),
  diagnostics: () => ipcRenderer.invoke('diagnostics:sample'),
  autoFocus: () => ipcRenderer.invoke('workspace:auto-focus'),
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    detect: () => ipcRenderer.invoke('extensions:detect'),
    add: () => ipcRenderer.invoke('extensions:add'),
    toggle: (id: string,enabled: boolean) => ipcRenderer.invoke('extensions:toggle',id,enabled),
    remove: (id: string) => ipcRenderer.invoke('extensions:remove',id),
    approve: (id: string,hosts: string[]) => ipcRenderer.invoke('extensions:approve',id,hosts),
    openStore: (id: string) => ipcRenderer.invoke('extensions:store',id),
  },
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    setAuto: (enabled: boolean) => ipcRenderer.invoke('update:auto',enabled),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on('update:status',listener);
      return () => ipcRenderer.removeListener('update:status',listener);
    },
  },
  onAutoFocus: (callback: (id: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string | null) => callback(id);
    ipcRenderer.on('workspace:auto-focus', listener);
    return () => ipcRenderer.removeListener('workspace:auto-focus', listener);
  },
  onFocus: (callback: (id: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string | null) => callback(id);
    ipcRenderer.on('workspace:focus', listener);
    return () => ipcRenderer.removeListener('workspace:focus', listener);
  },
  onStatus: (callback: (status: {id:string;state:string}) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: {id:string;state:string}) => callback(status);
    ipcRenderer.on('session:status',listener);
    return () => ipcRenderer.removeListener('session:status',listener);
  },
});
