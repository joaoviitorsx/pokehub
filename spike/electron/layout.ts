import type { StartupMode } from '../contracts/preferences';
// Altura da barra superior do renderer; manter igual a --bar em spike/src/style.css.
export const TOP_BAR = 48;
// Largura da lateral "Onde caçar?"; manter igual a --side em spike/src/style.css.
export const SIDE_PANEL = 340;
// Faixa da largura ajustável; manter igual a SIDE_MIN/SIDE_MAX em spike/src/hunt-side.tsx.
export const SIDE_MIN = 280;
export const SIDE_MAX = 520;
export const GRID_MIN_WIDTH = 720;
export type Bounds = { x: number; y: number; width: number; height: number };
export function layout(width: number, height: number, count: number, focus: number | null, side = 0): (Bounds | null)[] {
  if (![width,height,count,side].every(Number.isInteger) || width < 0 || side < 0 || side > width || height < TOP_BAR || count < 1 || count > 4 || (focus !== null && (!Number.isInteger(focus) || focus < 0 || focus >= count))) throw new Error('Layout inválido');
  const h = height - TOP_BAR;
  if (focus !== null) return Array.from({length:count}, (_, i) => i === focus ? {x:0,y:TOP_BAR,width,height:h} : null);
  width -= side; // a lateral só existe na grade; o foco usa a largura inteira
  if (count === 1) return [{x:0,y:TOP_BAR,width,height:h}];
  const left = Math.floor(width / 2), top = count > 2 ? Math.floor(h / 2) : h;
  return Array.from({length:count}, (_, i) => ({x:i % 2 ? left : 0,y:i >= 2 ? TOP_BAR + top : TOP_BAR,width:i % 2 ? width-left : left,height:i >= 2 ? h-top : top}));
}

export function effectiveFocus(width: number, height: number, count: number, requested: number | null): {index: number | null; automatic: boolean} {
  if (requested !== null || count < 2) return {index:requested,automatic:false};
  const rows = count > 2 ? 2 : 1;
  if (width < GRID_MIN_WIDTH || height - TOP_BAR < rows * 240) return {index:0,automatic:true};
  return {index:null,automatic:false};
}

/** Largura ocupada pela lateral: só na grade (sem foco, nem o automático) e se a grade ainda couber ao lado. `panel` é a largura escolhida pelo usuário. */
export function sideWidth(width: number, open: boolean, focus: number | null, panel = SIDE_PANEL): number {
  if (!Number.isInteger(panel) || panel < SIDE_MIN || panel > SIDE_MAX) throw new Error('Largura da lateral inválida');
  // some abaixo de 1060 px (como o renderer); acima disso cede largura para a grade manter GRID_MIN_WIDTH (o CSS faz a mesma conta)
  return open && focus === null && width >= GRID_MIN_WIDTH + SIDE_PANEL ? Math.min(panel, width - GRID_MIN_WIDTH) : 0;
}

export function initialFocus(mode: StartupMode, profileIds: readonly string[]): string | null {
  return mode === 'focus-first' ? profileIds[0] ?? null : null;
}
