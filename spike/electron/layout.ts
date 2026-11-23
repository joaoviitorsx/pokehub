import type { StartupMode } from '../contracts/preferences';
import { MAX_PROFILES } from '../domain/profiles';
export { MAX_PROFILES };
// Altura da barra superior do renderer; manter igual a --bar em spike/src/style.css.
export const TOP_BAR = 48;
// Largura da lateral "Onde caçar?"; manter igual a --side em spike/src/style.css.
export const SIDE_PANEL = 340;
// Faixa da largura ajustável; manter igual a SIDE_MIN/SIDE_MAX em spike/src/hunt-side.tsx.
export const SIDE_MIN = 280;
export const SIDE_MAX = 520;
// Largura mínima de uma coluna; abaixo disso a grade quebra em linhas.
export const COL_MIN = 340;
// Cabeçalho de cada coluna (desenhado pelo renderer); manter igual a --col-head em spike/src/style.css. A view do jogo começa abaixo dele.
export const COL_HEAD = 30;
// Altura mínima útil do jogo por linha de colunas.
export const ROW_MIN = 240;
export type Bounds = { x: number; y: number; width: number; height: number };
// Divide `total` em `n` partes inteiras; a última absorve o resto.
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({length:n}, (_, i) => i === n - 1 ? total - base * (n - 1) : base);
}
/** Quantas colunas e linhas a grade usa: o máximo de colunas que cabe, reduzido enquanto não aumentar o número de linhas (4 contas viram 2×2, não 3+1). */
export function gridShape(width: number, count: number): {cols: number; rows: number} {
  const fit = Math.min(count, Math.max(1, Math.floor(width / COL_MIN)));
  const rows = Math.ceil(count / fit);
  return {cols:Math.ceil(count / rows), rows};
}
function check(width: number, height: number, count: number, focus: number | null, side: number) {
  if (![width,height,count,side].every(Number.isInteger) || width < 0 || side < 0 || side > width || height < TOP_BAR || count < 1 || (focus !== null && (!Number.isInteger(focus) || focus < 0 || focus >= count))) throw new Error('Layout inválido');
}
/** Retângulos das colunas, cabeçalho incluído (y absoluto na janela). No foco só a coluna focada existe; as demais são null. */
export function columns(width: number, height: number, count: number, focus: number | null, side = 0): (Bounds | null)[] {
  check(width,height,count,focus,side);
  const h = height - TOP_BAR;
  if (focus !== null) return Array.from({length:count}, (_, i) => i === focus ? {x:0,y:TOP_BAR,width:width - side,height:h} : null); // a lateral fica à direita, no foco também
  const avail = width - side, {cols,rows} = gridShape(avail,count), heights = split(h,rows);
  const result: Bounds[] = [];
  let y = TOP_BAR;
  heights.forEach((rowHeight,row) => {
    const n = row < rows - 1 ? cols : count - cols * (rows - 1); // a última linha, se menor, divide a largura inteira
    let x = 0;
    for (const w of split(avail,n)) { result.push({x,y,width:w,height:rowHeight}); x += w; }
    y += rowHeight;
  });
  return result;
}
/** Área da view do jogo de cada coluna: o retângulo da coluna sem o cabeçalho. */
export function layout(width: number, height: number, count: number, focus: number | null, side = 0): (Bounds | null)[] {
  return columns(width,height,count,focus,side).map(b => b && {x:b.x,y:b.y + COL_HEAD,width:b.width,height:Math.max(0,b.height - COL_HEAD)});
}

/**
 * Foco automático: sem foco escolhido e sem espaço para a grade (nem uma coluna, ou linhas baixas demais), mostra uma conta só.
 * `side` é a largura da lateral (a grade ocupa width - side); `prefer` é a conta mostrada (a escolhida na lateral; padrão a primeira).
 */
export function effectiveFocus(width: number, height: number, count: number, requested: number | null, side = 0, prefer = 0): {index: number | null; automatic: boolean} {
  if (requested !== null || count < 2) return {index:requested,automatic:false};
  const avail = width - side, {rows} = gridShape(avail,count);
  if (avail < COL_MIN || height - TOP_BAR < rows * (ROW_MIN + COL_HEAD)) return {index:Number.isInteger(prefer) && prefer >= 0 && prefer < count ? prefer : 0,automatic:true};
  return {index:null,automatic:false};
}

/**
 * Largura ocupada pela lateral, em qualquer modo (grade, foco ou expandido): a escolhida pelo usuário (`panel`, 280–520),
 * reduzida para sobrar pelo menos uma coluna (COL_MIN) ao lado. A grade se ajusta sozinha (menos colunas, mais linhas) e,
 * se nem assim couber, vira foco automático (effectiveFocus). Fechada, ou em janela estreita demais, vale 0.
 */
export function sideWidth(width: number, open: boolean, panel = SIDE_PANEL): number {
  if (!Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error('Largura da lateral inválida');
  const room = width - COL_MIN;
  return open && room >= SIDE_MIN ? Math.min(panel,room) : 0;
}

export function initialFocus(mode: StartupMode, profileIds: readonly string[]): string | null {
  return mode === 'focus-first' ? profileIds[0] ?? null : null;
}
