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
  if (focus !== null) return Array.from({length:count}, (_, i) => i === focus ? {x:0,y:TOP_BAR,width,height:h} : null); // a lateral só existe na grade
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

export function effectiveFocus(width: number, height: number, count: number, requested: number | null): {index: number | null; automatic: boolean} {
  if (requested !== null || count < 2) return {index:requested,automatic:false};
  const {rows} = gridShape(width,count);
  if (width < COL_MIN || height - TOP_BAR < rows * (ROW_MIN + COL_HEAD)) return {index:0,automatic:true};
  return {index:null,automatic:false};
}

/** Menor largura de janela em que a lateral abre: a grade mantém pelo menos uma coluna (ou duas, havendo 2+ contas) ao lado dela. */
export function sideMinWidth(count: number, panel = SIDE_PANEL): number { return COL_MIN * Math.min(Math.max(count,1),2) + panel; }
/** Largura ocupada pela lateral: só na grade (sem foco, nem o automático) e se a grade ainda couber ao lado. `panel` é a largura escolhida pelo usuário. */
export function sideWidth(width: number, open: boolean, focus: number | null, panel = SIDE_PANEL, count = 2): number {
  if (!Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error('Largura da lateral inválida');
  const grid = COL_MIN * Math.min(Math.max(count,1),2);
  // some quando a janela não comporta lateral padrão + grade mínima; acima disso cede largura para a grade manter `grid` (o CSS faz a mesma conta)
  return open && focus === null && width >= grid + SIDE_PANEL ? Math.min(panel, width - grid) : 0;
}

export function initialFocus(mode: StartupMode, profileIds: readonly string[]): string | null {
  return mode === 'focus-first' ? profileIds[0] ?? null : null;
}
