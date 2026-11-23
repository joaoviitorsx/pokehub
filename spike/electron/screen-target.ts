// Ponte do Electron para a tela remota (R5): transforma o `webContents` de UMA conta em um `ScreenTarget`. Nada aqui toca a janela do hub.
// Captura: `capturePage()` (sem `desktopCapturer`). View oculta por `setVisible(false)` (foco/grade) captura normalmente; a janela escondida na bandeja NÃO:
// o `capturePage` fica pendurado (medido no Electron 44/Windows). Por isso o "truque da janela fantasma" abaixo, só enquanto alguém assiste.
import { createHash } from 'node:crypto';
import type { BrowserWindow, WebContents, WebContentsView } from 'electron';
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
  let count = 0, ghosted = false, applying = false;
  const alive = () => !window.isDestroyed();
  const apply = () => {
    if (!alive() || count === 0 || ghosted || window.isVisible() || window.isMinimized()) return;
    applying = true;
    try { window.setSkipTaskbar(true); window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); ghosted = true; } finally { applying = false; }
  };
  /** `hide`: volta a esconder (ao soltar); falso quando o usuário abriu a janela de verdade. */
  const undo = (hide: boolean) => {
    if (!ghosted) return;
    ghosted = false; if (!alive()) return;
    applying = true;
    try { if (hide) window.hide(); window.setOpacity(1); window.setIgnoreMouseEvents(false); window.setSkipTaskbar(false); } finally { applying = false; }
  };
  window.on('hide', () => { if (!applying && count > 0) setImmediate(apply); }); // voltou para a bandeja com alguém assistindo
  window.on('show', () => { if (!applying && ghosted) undo(false); });
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
export function createScreenTarget(view: WebContentsView, hub: WebContents, ghost: GhostWindow): ScreenTarget {
  const contents = view.webContents;
  if (contents === hub) throw new Error('A janela do hub nunca é capturada.');
  return {
    key: contents,
    url: () => contents.getURL(),
    alive: () => !contents.isDestroyed() && !contents.isCrashed(),
    size: () => { const b = view.getBounds(); return area(b) > 0 ? {width: b.width, height: b.height} : {width: HOLD_BOUNDS.width, height: HOLD_BOUNDS.height}; },
    async passwordFocused() { return (await contents.executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{code: PASSWORD_SCRIPT}])) !== false; },
    async capture({maxWidth, quality}): Promise<ScreenFrame | null> {
      const raw = await contents.capturePage(); // só esta página; `stayHidden` falso: o Chromium a mantém renderizando durante a captura
      if (raw.isEmpty()) return null;
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
