import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('pokehub', {
  list: () => ipcRenderer.invoke('profiles:list'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setStartupMode: (mode: unknown) => ipcRenderer.invoke('preferences:set',mode),
  initialFocus: () => ipcRenderer.invoke('workspace:initial-focus'),
  create: (input: unknown) => ipcRenderer.invoke('profiles:create',input),
  update: (id: string,input: unknown) => ipcRenderer.invoke('profiles:update',id,input),
  remove: (id: string) => ipcRenderer.invoke('profiles:remove',id),
  layout: (id: string | null,hide: boolean,side: boolean,panel?: number) => ipcRenderer.invoke('session:layout',id,hide,side,panel),
  drag: (active: boolean) => ipcRenderer.invoke('session:drag',active),
  huntSnapshot: (id: string,soLiberadas?: boolean) => ipcRenderer.invoke('hunt:snapshot',id,soLiberadas),
  onToggleSide: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('workspace:toggle-side', listener);
    return () => ipcRenderer.removeListener('workspace:toggle-side', listener);
  },
  reload: (id: string) => ipcRenderer.invoke('session:reload',id),
  restart: (id: string) => ipcRenderer.invoke('session:restart',id),
  clearSession: (id: string) => ipcRenderer.invoke('session:clear',id),
  states: () => ipcRenderer.invoke('session:states'),
  diagnostics: () => ipcRenderer.invoke('diagnostics:sample'),
  autoFocus: () => ipcRenderer.invoke('workspace:auto-focus'),
  extension: {
    status: () => ipcRenderer.invoke('extension:status'),
    detect: () => ipcRenderer.invoke('extension:detect'),
    choose: () => ipcRenderer.invoke('extension:choose'),
    set: (enabled: unknown) => ipcRenderer.invoke('extension:set',enabled),
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
