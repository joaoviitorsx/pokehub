/*
 * Travas de runtime (B12/B13): sem downloads, sem permissões, sem janelas/webviews novas, e IPC só do quadro principal da interface local.
 * Tudo com interfaces mínimas para testar sem o Electron.
 */
interface Emitter { on(event: string, listener: (...args: any[]) => void): unknown } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface GuardedSession extends Emitter {
  setPermissionRequestHandler(handler: (...args: any[]) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  setPermissionCheckHandler(handler: (...args: any[]) => boolean): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const locked = new WeakSet<object>();
/** Nenhuma sessão baixa arquivos nem recebe permissões (câmera, notificações, etc.). Idempotente por sessão. */
export function lockSession(session: GuardedSession): void {
  if (locked.has(session)) return;
  locked.add(session);
  session.on('will-download', (event: {preventDefault(): void}) => event.preventDefault());
  session.setPermissionRequestHandler((_contents, _permission, callback: (granted: boolean) => void) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
interface GuardedContents { setWindowOpenHandler(handler: () => {action: 'deny'}): void; on(event: string, listener: (event: {preventDefault(): void}) => void): unknown }
/** Todo WebContents nasce sem janelas novas e sem <webview>; handlers específicos (ex.: o aviso da view do jogo) sobrescrevem o de janelas depois. */
export function guardNewContents(app: {on(event: 'web-contents-created', listener: (event: unknown, contents: GuardedContents) => void): unknown}): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.on('will-attach-webview', event => event.preventDefault());
  });
}
/** O quadro que chamou o IPC é a interface local (arquivo dist/index.html), não uma página carregada de outro lugar. */
export function isAppFrameUrl(url: unknown, appUrl: string): boolean {
  return typeof url === 'string' && appUrl !== '' && (url === appUrl || url.startsWith(`${appUrl}#`) || url.startsWith(`${appUrl}?`));
}

export const SAFE_DIALOGS = {safeDialogs: true, safeDialogsMessage: 'Impedir que esta página abra mais diálogos'};
