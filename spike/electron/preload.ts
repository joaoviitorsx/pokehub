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
  huntTeam: (id: string) => ipcRenderer.invoke('hunt:team',id),
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
  grindolino: {
    listHunts: () => ipcRenderer.invoke('grindolino:listHunts'),
    createHunt: (input: unknown) => ipcRenderer.invoke('grindolino:createHunt',input),
    updateHunt: (id: string,input: unknown) => ipcRenderer.invoke('grindolino:updateHunt',id,input),
    removeHunt: (id: string) => ipcRenderer.invoke('grindolino:removeHunt',id),
    addForecast: (input: unknown) => ipcRenderer.invoke('grindolino:addForecast',input),
    addMeasurement: (input: unknown) => ipcRenderer.invoke('grindolino:addMeasurement',input),
    removeMeasurement: (id: string) => ipcRenderer.invoke('grindolino:removeMeasurement',id),
    listMeasurements: (accountId: string) => ipcRenderer.invoke('grindolino:listMeasurements',accountId),
    rank: (request: unknown) => ipcRenderer.invoke('grindolino:rank',request),
    compare: (request: unknown) => ipcRenderer.invoke('grindolino:compare',request),
  },
  analytics: {
    series: (request: unknown) => ipcRenderer.invoke('analytics:series',request),
    export: (request: unknown) => ipcRenderer.invoke('analytics:export',request),
  },
  live: {
    status: () => ipcRenderer.invoke('live:status'),
    start: (accountId: string,huntId: string | null) => ipcRenderer.invoke('live:start',accountId,huntId),
    stop: (accountId: string) => ipcRenderer.invoke('live:stop',accountId),
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
