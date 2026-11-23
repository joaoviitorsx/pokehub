// Contas e gestos puros da tela ao vivo no celular (sem DOM): zoom/pan, de toque para imagem, classificação do gesto de dois dedos, teclado e relógio.
import type { InputEvent } from '../contracts/screen';

export interface View { scale: number; tx: number; ty: number }
export const MAX_SCALE = 5, TAP_MS = 700, TAP_SLOP = 10, DOUBLE_MS = 320, DOUBLE_SLOP = 32, MOVE_HZ = 20, GESTURE_SLOP = 12;
export const FIT: View = {scale: 1, tx: 0, ty: 0};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Mantém a imagem dentro do quadro: com zoom `s`, o deslocamento fica entre `W-W*s` e 0 (nada de borda vazia). */
export function clampView(v: View, w: number, h: number): View {
  const scale = clamp(v.scale, 1, MAX_SCALE);
  return {scale, tx: clamp(v.tx, Math.min(0, w - w * scale), 0), ty: clamp(v.ty, Math.min(0, h - h * scale), 0)};
}
/** Pinça: o ponto sob o centro dos dedos continua sob o centro dos dedos depois do zoom (e acompanha o deslocamento do centro). */
export function pinch(v: View, from: {cx: number; cy: number; d: number}, to: {cx: number; cy: number; d: number}, w: number, h: number): View {
  if (from.d <= 0) return v;
  const scale = clamp(v.scale * (to.d / from.d), 1, MAX_SCALE), k = scale / v.scale;
  return clampView({scale, tx: to.cx - (from.cx - v.tx) * k, ty: to.cy - (from.cy - v.ty) * k}, w, h);
}
export const pan = (v: View, dx: number, dy: number, w: number, h: number): View => clampView({...v, tx: v.tx + dx, ty: v.ty + dy}, w, h);
/** Duplo toque na visão: alterna entre caber na tela e 2,5× no ponto tocado. */
export function toggleZoom(v: View, x: number, y: number, w: number, h: number): View {
  if (v.scale > 1.05) return FIT;
  const scale = 2.5; return clampView({scale, tx: x - x * scale, ty: y - y * scale}, w, h);
}
/** Posição do dedo na tela → pixel da IMAGEM do quadro (o PC ainda confere e limita). `rect` é o retângulo do canvas já com zoom/pan. */
export function toImage(clientX: number, clientY: number, rect: {left: number; top: number; width: number; height: number}, frame: {w: number; h: number}): {x: number; y: number} | null {
  if (rect.width <= 0 || rect.height <= 0 || frame.w <= 0 || frame.h <= 0) return null;
  const x = (clientX - rect.left) / rect.width * frame.w, y = (clientY - rect.top) / rect.height * frame.h;
  return x < 0 || y < 0 || x > frame.w || y > frame.h ? null : {x: Math.round(x), y: Math.round(y)}; // fora da imagem não clica
}
/** Dois dedos: se a distância mudou mais que a folga é pinça (zoom); se só o centro andou é rolagem (roda do mouse). */
export function twoFingerKind(d0: number, d1: number, moved: number): 'pinch' | 'scroll' | null {
  if (Math.abs(d1 - d0) > GESTURE_SLOP) return 'pinch';
  return moved > GESTURE_SLOP ? 'scroll' : null;
}
/** Quanto o centro dos dedos andou → delta da roda (dedos para cima = conteúdo desce = deltaY positivo como no mouse). */
export const wheelDelta = (dx: number, dy: number): {dx: number; dy: number} => ({dx: Math.round(-dx * 2), dy: Math.round(-dy * 2)});

/** Campo de teclado do celular: o `beforeinput` vira eventos do protocolo (texto, Backspace, Enter). */
export function inputFromBefore(inputType: string, data: string | null): InputEvent[] {
  if (inputType === 'insertText' || inputType === 'insertFromPaste' || inputType === 'insertCompositionText') {
    const text = [...(data ?? '')].filter(c => /^[\P{C}]$/u.test(c) || c === ' ').slice(0, 64);
    const out: InputEvent[] = []; for (let i = 0; i < text.length; i += 16) out.push({k: 'ch', text: text.slice(i, i + 16).join('')});
    return out;
  }
  if (inputType === 'deleteContentBackward') return [{k: 'kd', key: 'Backspace'}, {k: 'ku', key: 'Backspace'}];
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') return [{k: 'kd', key: 'Enter'}, {k: 'ku', key: 'Enter'}];
  return [];
}
export const keyTap = (key: string): InputEvent[] => [{k: 'kd', key}, {k: 'ku', key}];
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const STATE_LABEL: Record<string, string> = {starting: 'Conectando…', streaming: 'Ao vivo', paused: 'Pausado', protected: 'Conteúdo protegido', password: 'Campo de senha: pausado', hidden: 'Sem imagem agora', unavailable: 'Conta indisponível'};
export const DENIED_TEXT: Record<string, string> = {
  'sem-permissao': 'Sem permissão para controlar (libere no PC).', 'sem-pin': 'Defina o PIN no PC (Gerenciar → Acesso remoto).', desligado: 'As ações pelo celular estão desligadas no PC.',
  pin: 'PIN incorreto.', bloqueado: 'Muitas tentativas. Aguarde antes de tentar de novo.', revogado: 'Este aparelho foi revogado.', ocupado: 'Esta conta já está sendo controlada.', indisponivel: 'Espere a imagem aparecer para controlar.'};
export const END_TEXT: Record<string, string> = {encerrado: 'Controle encerrado.', expirou: 'O controle expirou (10 min). Use o PIN para continuar.', ocioso: 'Controle encerrado por inatividade (2 min).', pc: 'O controle foi encerrado no PC.', permissao: 'A permissão de controlar (ou o PIN) foi removida.', navegacao: 'O PC bloqueou uma navegação fora do jogo.', sessao: 'A conexão foi encerrada.', pausado: 'Controle pausado.'};
