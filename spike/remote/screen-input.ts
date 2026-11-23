// Entrada do modo Controlar (R5), sem Electron: lista fechada de eventos, atalhos bloqueados, mapeamento/limite de coordenadas e taxas.
// O celular só pede "clicar aqui", "rolar", "tecla X" ou "digitar texto"; o que chega ao `sendInputEvent` é montado AQUI, nunca copiado do celular.
import type { InputEvent } from '../contracts/screen';

/** O que o hub entrega ao `webContents.sendInputEvent` (subconjunto do Electron.InputEvent). */
export type SendInput =
  | {type: 'mouseDown' | 'mouseUp'; x: number; y: number; button: 'left'; clickCount: number}
  | {type: 'mouseMove'; x: number; y: number; modifiers?: ['leftButtonDown']}
  | {type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number}
  | {type: 'keyDown' | 'keyUp'; keyCode: string}
  | {type: 'char'; keyCode: string};

export const MAX_EVENTS_PER_SEC = 30, MAX_CHARS_PER_MIN = 500, MAX_CHARS_PER_EVENT = 16, MAX_WHEEL = 1200;
/** Teclas sem texto que o celular pode mandar (Enter, Backspace e Esc como pedido; setas/Tab/Delete para menus). */
export const ALLOWED_KEYS: ReadonlySet<string> = new Set(['Enter', 'Backspace', 'Escape', 'Tab', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Atalhos que NUNCA passam (documentação executável, usada nos testes): DevTools, recarregar, fechar, navegar, imprimir, salvar, etc. */
export const BLOCKED_SHORTCUTS = ['F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'Ctrl+L', 'Ctrl+P', 'Ctrl+S', 'Ctrl+U', 'Alt+F4', 'Ctrl+W', 'Ctrl+R', 'F5', 'Ctrl+N', 'Ctrl+T', 'Alt+Left', 'Alt+Right', 'Meta', 'Win'] as const;
const FN = /^F\d{1,2}$/, META = /^(meta|os|super|win|windows|contextmenu|apps)$/i;

/** Esta combinação é bloqueada? Qualquer Ctrl/Alt/Meta junto, qualquer tecla F1–F24 e as teclas Meta/Win. Shift sozinho só modifica o texto. */
export function isBlockedShortcut(key: string, mods: readonly string[] = []): boolean {
  const m = new Set(mods.map(x => x.toLowerCase()));
  return FN.test(key) || META.test(key) || m.has('ctrl') || m.has('control') || m.has('alt') || m.has('meta') || m.has('cmd') || m.has('win') || /^(control|alt|altgraph)$/i.test(key);
}

export interface Frame { w: number; h: number }
export interface Size { width: number; height: number }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Imagem do celular → coordenadas da view (inteiros), SEMPRE dentro dos limites: [0, tamanho-1]. */
export function mapPoint(x: number, y: number, frame: Frame, view: Size): {x: number; y: number} | null {
  if (!finite(x) || !finite(y) || frame.w <= 0 || frame.h <= 0 || view.width <= 0 || view.height <= 0) return null;
  const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(v)));
  return {x: clamp(Math.min(Math.max(x, 0), frame.w) / frame.w * view.width, view.width), y: clamp(Math.min(Math.max(y, 0), frame.h) / frame.h * view.height, view.height)};
}
/** Caractere imprimível de verdade: nada de controle, formatação (bidi) ou substituto solto. */
const printable = (ch: string) => /^[\P{C}]$/u.test(ch) || ch === ' ';

export type Sanitized = {ok: true; events: SendInput[]; chars: number; text: boolean} | {ok: false; reason: 'formato' | 'bloqueado' | 'tecla' | 'texto' | 'quadro'};
/** Valida (estrito: campos desconhecidos recusam) e converte um evento do celular em eventos de entrada. */
export function sanitizeInput(raw: unknown, frame: Frame | null, view: Size): Sanitized {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {ok: false, reason: 'formato'};
  const e = raw as Record<string, unknown>, keys = Object.keys(e).sort().join(',');
  switch (e.k) {
    case 'md': case 'mu': {
      if (keys !== 'k,x,y' && keys !== 'k,n,x,y') return {ok: false, reason: 'formato'};
      if (e.n !== undefined && e.n !== 1 && e.n !== 2) return {ok: false, reason: 'formato'};
      if (!frame) return {ok: false, reason: 'quadro'}; const p = mapPoint(e.x as number, e.y as number, frame, view); if (!p) return {ok: false, reason: 'formato'};
      return {ok: true, events: [{type: e.k === 'md' ? 'mouseDown' : 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: e.n === 2 ? 2 : 1}], chars: 0, text: false}; // só o botão esquerdo: o direito abriria o menu de contexto
    }
    case 'mm': {
      if (keys !== 'k,x,y' && keys !== 'down,k,x,y') return {ok: false, reason: 'formato'};
      if (e.down !== undefined && typeof e.down !== 'boolean') return {ok: false, reason: 'formato'};
      if (!frame) return {ok: false, reason: 'quadro'}; const p = mapPoint(e.x as number, e.y as number, frame, view); if (!p) return {ok: false, reason: 'formato'};
      return {ok: true, events: [e.down === true ? {type: 'mouseMove', x: p.x, y: p.y, modifiers: ['leftButtonDown']} : {type: 'mouseMove', x: p.x, y: p.y}], chars: 0, text: false};
    }
    case 'wh': {
      if (keys !== 'dx,dy,k,x,y' || !finite(e.dx) || !finite(e.dy)) return {ok: false, reason: 'formato'};
      if (!frame) return {ok: false, reason: 'quadro'}; const p = mapPoint(e.x as number, e.y as number, frame, view); if (!p) return {ok: false, reason: 'formato'};
      const c = (v: number) => Math.round(Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, v)));
      return {ok: true, events: [{type: 'mouseWheel', x: p.x, y: p.y, deltaX: c(e.dx as number), deltaY: c(e.dy as number)}], chars: 0, text: false};
    }
    case 'kd': case 'ku': {
      if (keys !== 'k,key' && keys !== 'k,key,m') return {ok: false, reason: 'formato'};
      if (typeof e.key !== 'string' || e.key.length === 0 || e.key.length > 16) return {ok: false, reason: 'formato'};
      if (e.m !== undefined && (!Array.isArray(e.m) || e.m.length > 4 || !e.m.every(x => typeof x === 'string' && x.length <= 8))) return {ok: false, reason: 'formato'};
      const mods = (e.m as string[] | undefined) ?? [];
      if (isBlockedShortcut(e.key, mods)) return {ok: false, reason: 'bloqueado'};
      if (mods.some(x => x.toLowerCase() !== 'shift')) return {ok: false, reason: 'bloqueado'};
      if (!ALLOWED_KEYS.has(e.key) && !/^[a-zA-Z0-9]$/.test(e.key)) return {ok: false, reason: 'tecla'};
      return {ok: true, events: [{type: e.k === 'kd' ? 'keyDown' : 'keyUp', keyCode: e.key}], chars: 0, text: !/^(Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(e.key)};
    }
    case 'ch': {
      if (keys !== 'k,text' || typeof e.text !== 'string') return {ok: false, reason: 'formato'};
      const list = [...e.text];
      if (list.length === 0 || list.length > MAX_CHARS_PER_EVENT || !list.every(printable)) return {ok: false, reason: 'texto'};
      return {ok: true, events: list.map(ch => ({type: 'char' as const, keyCode: ch})), chars: list.length, text: true};
    }
    default: return {ok: false, reason: 'formato'};
  }
}

/** Taxas: 30 eventos/s (balde) e 500 caracteres/min (janela deslizante). */
export class InputLimiter {
  private tokens = MAX_EVENTS_PER_SEC; private last: number; private chars: {at: number; n: number}[] = [];
  constructor(private now: () => number = Date.now, private perSec = MAX_EVENTS_PER_SEC, private perMin = MAX_CHARS_PER_MIN) { this.last = now(); this.tokens = perSec; }
  /** `false` = acima do limite (descarta o evento). */
  allow(chars: number): boolean {
    const t = this.now(); this.tokens = Math.min(this.perSec, this.tokens + (t - this.last) / 1000 * this.perSec); this.last = t;
    this.chars = this.chars.filter(c => t - c.at < 60_000);
    if (this.tokens < 1) return false;
    if (chars > 0 && this.chars.reduce((s, c) => s + c.n, 0) + chars > this.perMin) return false;
    this.tokens -= 1; if (chars > 0) this.chars.push({at: t, n: chars});
    return true;
  }
}
export type { InputEvent };
