// Ponte do Electron para a tela remota (R5): transforma o `webContents` de UMA conta em um `ScreenTarget`. Nada aqui toca a janela do hub.
// Captura: `capturePage()` (sem `desktopCapturer`). View oculta por `setVisible(false)` (foco/grade) captura normalmente; a janela escondida na bandeja NÃO:
// o `capturePage` fica pendurado (medido no Electron 44/Windows). Por isso o "truque da janela fantasma" abaixo, só enquanto alguém assiste.
import { createHash } from 'node:crypto';
import type { BrowserWindow, GlobalShortcut, WebContents, WebContentsView } from 'electron';
import type { ScreenFrame, ScreenTarget } from '../remote/screen';
import type { SendInput } from '../remote/screen-input';

/** Constante e sem entrada externa: "o elemento com foco é um <input type=password>?" (atravessa shadow DOM; iframe que não dá para inspecionar conta como sim). */
export const PASSWORD_SCRIPT = `(() => { try { let a = document.activeElement; for (let i = 0; i < 8 && a; i++) { if (a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; continue; } if (a.tagName === 'IFRAME') { const d = a.contentDocument; if (!d) return true; a = d.activeElement; continue; } break; } return !!a && a.tagName === 'INPUT' && String(a.type).toLowerCase() === 'password'; } catch { return true; } })()`;
const PASSWORD_WORLD = 997; // mundo isolado próprio (o Market usa 999)
const HOLD_BOUNDS = {x: 0, y: 0, width: 1280, height: 720};

/**
 * Janela fantasma: com a janela do hub escondida na bandeja o Chromium para de gerar quadros e `capturePage` nunca responde. Enquanto houver quem assista,
 * a janela é "mostrada" com opacidade 0, sem botão na barra de tarefas e sem receber o mouse; ao soltar (ou se o usuário abrir a janela de verdade) tudo volta ao normal.
 * Só age se a janela estiver escondida (não minimizada: minimizada captura normalmente).
 */
export function createGhostWindow(window: BrowserWindow) {
  // `gen` sobe a cada aplicar/desfazer. O `show` do showInactive pode chegar DEPOIS (assíncrono): só o `show` da geração atual é o nosso e é ignorado; qualquer outro é o usuário abrindo a janela.
  let count = 0, ghosted = false, gen = 0, ownShow = -1;
  const alive = () => !window.isDestroyed();
  const apply = () => {
    if (!alive() || count === 0 || ghosted || window.isVisible() || window.isMinimized()) return;
    const mine = ++gen; ownShow = mine; ghosted = true;
    try {
      window.setSkipTaskbar(true); window.setOpacity(0); window.setIgnoreMouseEvents(true);
      try { window.setFocusable(false); } catch { /* sem suporte: o foco é desfeito pelo evento `focus` */ } // sem foco: Alt+Tab não entra na janela invisível
      window.showInactive();
    } catch { ghosted = false; ownShow = -1; return; }
    setTimeout(() => { if (ownShow === mine) ownShow = -1; }, 1000).unref?.(); // se o `show` nunca vier, não engole o próximo de verdade
  };
  /** `hide`: volta a esconder (ao soltar); falso quando o usuário abriu a janela de verdade. */
  const undo = (hide: boolean) => {
    if (!ghosted) return;
    ghosted = false; gen++; ownShow = -1; if (!alive()) return;
    try { window.setFocusable(true); } catch { /* sem suporte */ }
    try { if (hide) window.hide(); window.setOpacity(1); window.setIgnoreMouseEvents(false); window.setSkipTaskbar(false); } catch { /* janela fechando */ }
  };
  window.on('hide', () => { if (count > 0 && !ghosted) setImmediate(apply); }); // voltou para a bandeja com alguém assistindo
  window.on('show', () => { if (!ghosted) return; if (ownShow === gen) { ownShow = -1; return; } undo(false); });
  window.on('focus', () => { if (ghosted) undo(false); }); // o usuário focou a janela (Alt+Tab, clique): ela volta ao normal
  return {
    acquire(): () => void { count++; apply(); let done = false; return () => { if (done) return; done = true; count = Math.max(0, count - 1); if (count === 0) undo(true); }; },
    /** O usuário abriu a janela (bandeja/atalho): devolve opacidade, mouse e barra de tarefas sem esconder de novo. */
    reveal: () => undo(false),
    active: () => ghosted,
  };
}
export type GhostWindow = ReturnType<typeof createGhostWindow>;

const area = (b: {width: number; height: number}) => b.width * b.height;
/** Alvo da conta. `view.webContents` é sempre a view da CONTA (o chamador nunca passa a janela do hub). */
export function createScreenTarget(view: WebContentsView, hub: WebContents, ghost: GhostWindow, opts: {captureMs?: number} = {}): ScreenTarget {
  const contents = view.webContents, captureMs = opts.captureMs ?? 4000;
  if (contents === hub) throw new Error('A janela do hub nunca é capturada.');
  let inflight: Promise<void> | null = null; // um `capturePage` por vez: com a view/janela oculta ele pode nunca responder e as chamadas não podem se empilhar
  return {
    key: contents,
    url: () => contents.getURL(),
    alive: () => !contents.isDestroyed() && !contents.isCrashed(),
    size: () => { const b = view.getBounds(); return area(b) > 0 ? {width: b.width, height: b.height} : {width: HOLD_BOUNDS.width, height: HOLD_BOUNDS.height}; },
    async passwordFocused() { return (await contents.executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{code: PASSWORD_SCRIPT}])) !== false; },
    async capture({maxWidth, quality}): Promise<ScreenFrame | null> {
      if (inflight) return null; // a anterior ainda não respondeu: "oculto", sem pedir outra
      const pending = contents.capturePage(); // só esta página; `stayHidden` falso: o Chromium a mantém renderizando durante a captura
      const track: Promise<void> = pending.then(() => undefined, () => undefined).then(() => { if (inflight === track) inflight = null; }); inflight = track;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const raw = await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), captureMs); timer.unref?.(); })]).finally(() => clearTimeout(timer));
      if (raw === null || raw.isEmpty()) return null;
      const size = raw.getSize(), image = size.width > maxWidth ? raw.resize({width: maxWidth, quality: 'good'}) : raw, out = image.getSize();
      return {width: out.width, height: out.height, hash: createHash('md5').update(image.toBitmap()).digest('hex'), jpeg: () => image.toJPEG(quality)};
    },
    input: (event: SendInput) => { contents.sendInputEvent(event as Parameters<WebContents['sendInputEvent']>[0]); },
    hold() {
      const release = ghost.acquire();
      // view que nunca recebeu área (modo Foco desde o início): dá um tamanho enquanto assistem; continua oculta (setVisible(false)) e só volta se ninguém mexeu nos limites
      let temp: Electron.Rectangle | null = null;
      try { if (area(view.getBounds()) === 0) { view.setBounds(HOLD_BOUNDS); temp = {...HOLD_BOUNDS}; } } catch { /* view fechando */ }
      return () => {
        release();
        try { const b = view.getBounds(); if (temp && b.x === temp.x && b.y === temp.y && b.width === temp.width && b.height === temp.height) view.setBounds({x: 0, y: 0, width: 0, height: 0}); } catch { /* view fechada */ }
      };
    },
  };
}

/** Registro do atalho global que encerra o controle (Ctrl+Shift+F12): só existe enquanto alguém controla; se outro app já o usa (`register` devolve false), avisa em vez de fingir que funciona. */
export function createControlShortcut(gs: Pick<GlobalShortcut, 'register' | 'unregister'>, accelerator: string, trigger: () => void, report: (down: boolean) => void): (active: number) => void {
  let mine = false;
  return active => {
    try {
      if (active > 0 && !mine) { mine = gs.register(accelerator, trigger) === true; report(!mine); }
      else if (active === 0) { if (mine) gs.unregister(accelerator); mine = false; report(false); }
    } catch { report(true); }
  };
}

type NavEvent = {url?: string; isMainFrame?: boolean; preventDefault(): void};
export interface NavLockDeps { id: string; controlling(id: string): boolean; allowedSession(url: string): boolean; allowedGame(url: string): boolean; gameUrl: string; onViolation(id: string): void }
/** Trava de navegação da conta: sempre só destinos permitidos; durante o CONTROLE remoto, só pokeidle.io (nada de login do Google/Discord pelo celular). Se mesmo assim a página sair do jogo (navegação interna, pushState), volta ao jogo e o controle termina ('navegacao'). */
export function installNavigationLock(contents: Pick<WebContents, 'on' | 'loadURL'>, d: NavLockDeps): void {
  const blocked = (url: string) => !d.allowedSession(url) || (d.controlling(d.id) && !d.allowedGame(url));
  const guard = (event: NavEvent, url: string) => { if (blocked(url)) event.preventDefault(); };
  const on = contents.on.bind(contents) as (name: string, cb: (...args: never[]) => void) => unknown;
  on('will-navigate', ((event: NavEvent, url: string) => guard(event, url)) as never);
  on('will-redirect', ((event: NavEvent, url: string) => guard(event, url)) as never);
  on('will-frame-navigate', ((event: NavEvent) => { if (event.isMainFrame !== false && typeof event.url === 'string') guard(event, event.url); }) as never);
  const left = (url: string) => { if (!d.controlling(d.id) || d.allowedGame(url)) return; d.onViolation(d.id); void Promise.resolve(contents.loadURL(d.gameUrl)).catch(() => undefined); };
  on('did-navigate', ((_event: unknown, url: string) => left(url)) as never);
  on('did-navigate-in-page', ((_event: unknown, url: string, isMainFrame?: boolean) => { if (isMainFrame !== false) left(url); }) as never);
}
