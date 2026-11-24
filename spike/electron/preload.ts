import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('pokehub', {
  list: () => ipcRenderer.invoke('profiles:list'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setStartupMode: (mode: unknown) => ipcRenderer.invoke('preferences:set',mode),
  getPerformance: () => ipcRenderer.invoke('performance:get'),
  setPerformance: (value: unknown) => ipcRenderer.invoke('performance:set',value),
  win: {
    state: () => ipcRenderer.invoke('window:state'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onState: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    },
  },
  getTray: () => ipcRenderer.invoke('tray:get'),
  setTray: (value: unknown) => ipcRenderer.invoke('tray:set',value),
  onPerformance: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on('performance:changed', listener);
    return () => ipcRenderer.removeListener('performance:changed', listener);
  },
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    enable: (value: boolean) => ipcRenderer.invoke('remote:enable',value),
    pairStart: () => ipcRenderer.invoke('remote:pair-start'),
    pairCancel: () => ipcRenderer.invoke('remote:pair-cancel'),
    decide: (allow: boolean) => ipcRenderer.invoke('remote:decide',allow),
    setPin: (pin: string) => ipcRenderer.invoke('remote:set-pin',pin),
    clearPin: () => ipcRenderer.invoke('remote:clear-pin'),
    devices: () => ipcRenderer.invoke('remote:devices'),
    revoke: (id: string) => ipcRenderer.invoke('remote:revoke',id),
    audit: () => ipcRenderer.invoke('remote:audit'),
    pushTest: (id: string) => ipcRenderer.invoke('remote:push-test',id),
    alerts: () => ipcRenderer.invoke('remote:alerts'),
    purchases: () => ipcRenderer.invoke('remote:purchases'),
    setCap: (value: number) => ipcRenderer.invoke('remote:set-cap',value),
    allowNetwork: () => ipcRenderer.invoke('remote:allow-network'),
    revealCode: () => ipcRenderer.invoke('remote:reveal-code'),
    setCanAct: (id: string, value: boolean) => ipcRenderer.invoke('remote:set-can-act',id,value),
    setCanControl: (id: string, value: boolean) => ipcRenderer.invoke('remote:set-can-control',id,value),
    reenableActions: () => ipcRenderer.invoke('remote:reenable-actions'),
    dismissNotice: () => ipcRenderer.invoke('remote:dismiss-notice'),
    screenEnd: (mode: 'control' | 'all') => ipcRenderer.invoke('remote:screen-end',mode),
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('remote:changed',listener);
      return () => ipcRenderer.removeListener('remote:changed',listener);
    },
  },
  suspend: (id: string) => ipcRenderer.invoke('session:suspend',id),
  resume: (id: string) => ipcRenderer.invoke('session:resume',id),
  processes: () => ipcRenderer.invoke('diagnostics:processes'),
  initialFocus: () => ipcRenderer.invoke('workspace:initial-focus'),
  create: (input: unknown) => ipcRenderer.invoke('profiles:create',input),
  update: (id: string,input: unknown) => ipcRenderer.invoke('profiles:update',id,input),
  remove: (id: string,wipe?: boolean) => ipcRenderer.invoke('profiles:remove',id,wipe),
  orphans: () => ipcRenderer.invoke('profiles:orphans'),
  wipeOrphans: () => ipcRenderer.invoke('profiles:wipeOrphans'),
  layout: (id: string | null,hide: boolean,side: boolean,panel?: number,account?: string | null) => ipcRenderer.invoke('session:layout',id,hide,side,panel,account ?? null),
  drag: (active: boolean) => ipcRenderer.invoke('session:drag',active),
  huntSnapshot: (id: string,soLiberadas?: boolean) => ipcRenderer.invoke('hunt:snapshot',id,soLiberadas),
  huntTeam: (id: string,force?: boolean) => ipcRenderer.invoke('hunt:team',id,force === true),
  stock: {
    get: () => ipcRenderer.invoke('stock:get'),
    setRules: (rules: unknown) => ipcRenderer.invoke('stock:setRules',rules),
    refresh: () => ipcRenderer.invoke('stock:refresh'),
    onChanged: (callback: (all: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, all: unknown) => callback(all);
      ipcRenderer.on('stock:changed',listener);
      return () => ipcRenderer.removeListener('stock:changed',listener);
    },
    onOpenRestock: (callback: (profileId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profileId: string) => callback(profileId);
      ipcRenderer.on('stock:openRestock',listener);
      return () => ipcRenderer.removeListener('stock:openRestock',listener);
    },
  },
  deadlines: {
    get: () => ipcRenderer.invoke('deadlines:get'),
    refresh: () => ipcRenderer.invoke('deadlines:refresh'),
    notify: () => ipcRenderer.invoke('deadlines:notify'),
    setNotify: (on: boolean) => ipcRenderer.invoke('deadlines:setNotify',on),
    onChanged: (callback: (all: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, all: unknown) => callback(all);
      ipcRenderer.on('deadlines:changed',listener);
      return () => ipcRenderer.removeListener('deadlines:changed',listener);
    },
  },
  dayType: {
    notify: () => ipcRenderer.invoke('daytype:notify'),
    setNotify: (on: boolean) => ipcRenderer.invoke('daytype:setNotify',on),
  },
  market: {
    scan: (id: string) => ipcRenderer.invoke('market:scan',id),
    readAll: (id: string) => ipcRenderer.invoke('market:readAll',id),
    badges: () => ipcRenderer.invoke('market:badges'),
    setBadges: (on: boolean) => ipcRenderer.invoke('market:setBadges',on),
    alerts: () => ipcRenderer.invoke('market:alerts'),
    saveAlert: (id: string | null,input: unknown) => ipcRenderer.invoke('market:saveAlert',id,input),
    removeAlert: (id: string) => ipcRenderer.invoke('market:removeAlert',id),
    testToast: () => ipcRenderer.invoke('market:testToast'),
    onOpenAlerts: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('market:openAlerts',listener);
      return () => ipcRenderer.removeListener('market:openAlerts',listener);
    },
    onAlertHit: (callback: (hits: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, hits: unknown) => callback(hits);
      ipcRenderer.on('market:alertHit',listener);
      return () => ipcRenderer.removeListener('market:alertHit',listener);
    },
    stop: (id: string) => ipcRenderer.invoke('market:stop',id),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
      ipcRenderer.on('market:progress',listener);
      return () => ipcRenderer.removeListener('market:progress',listener);
    },
  },
  shop: {
    read: (id: string) => ipcRenderer.invoke('shop:read',id),
    run: (plan: unknown) => ipcRenderer.invoke('shop:run',plan),
    stop: () => ipcRenderer.invoke('shop:stop'),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
      ipcRenderer.on('shop:progress',listener);
      return () => ipcRenderer.removeListener('shop:progress',listener);
    },
  },
  captures: {
    list: (query?: unknown) => ipcRenderer.invoke('captures:list',query),
    clear: () => ipcRenderer.invoke('captures:clear'),
    watch: (open: boolean,notify?: boolean,notaMin?: number | null) => ipcRenderer.invoke('captures:watch',open,notify ?? false,notaMin ?? null),
    onNew: (callback: (captures: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, captures: unknown) => callback(captures);
      ipcRenderer.on('captures:new',listener);
      return () => ipcRenderer.removeListener('captures:new',listener);
    },
  },
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
  clearSession: (id: string,full?: boolean) => ipcRenderer.invoke('session:clear',id,full),
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
  streams: {
    get: (platform: string) => ipcRenderer.invoke('stream:get',platform),
    setChannel: (platform: string,value: string) => ipcRenderer.invoke('stream:channel',platform,value),
    link: (platform: string,id: string) => ipcRenderer.invoke('stream:link',platform,id),
    unlink: (platform: string,id: string) => ipcRenderer.invoke('stream:unlink',platform,id),
    update: (platform: string,id: string,patch: unknown) => ipcRenderer.invoke('stream:update',platform,id,patch),
    show: (platform: string,id: string) => ipcRenderer.invoke('stream:show',platform,id),
    hide: (platform: string,id: string) => ipcRenderer.invoke('stream:hide',platform,id),
    rewards: (platform: string,id: string) => ipcRenderer.invoke('stream:rewards',platform,id),
    onChanged: (callback: (info: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: unknown) => callback(info);
      ipcRenderer.on('stream:changed',listener);
      return () => ipcRenderer.removeListener('stream:changed',listener);
    },
  },
  ficha: {
    review: () => ipcRenderer.invoke('ficha:review'),
    setReview: (on: boolean) => ipcRenderer.invoke('ficha:setReview',on),
  },
  network: {
    get: () => ipcRenderer.invoke('network:get'),
    setMode: (mode: string) => ipcRenderer.invoke('network:mode',mode),
    allow: (host: string) => ipcRenderer.invoke('network:allow',host),
    disallow: (host: string) => ipcRenderer.invoke('network:disallow',host),
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
