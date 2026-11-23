interface InstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): unknown;
}
export function acquireSingleInstance(app: InstanceApp, focus: () => void): boolean {
  if (!app.requestSingleInstanceLock()) { app.quit(); return false; }
  app.on('second-instance', focus);
  return true;
}
