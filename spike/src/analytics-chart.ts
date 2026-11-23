// Aritmética do gráfico do Histórico, separada do React para ser testada.

/** Graduações de 0 até cobrir `max`, em passos 1/2/2,5/5 × 10ⁿ. */
export function axisTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0,1];
  const rough = max / count, power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1,2,2.5,5,10].find(factor => factor * power >= rough) ?? 10) * power;
  // multiplicar o índice evita o acúmulo de erro de somar passos fracionários
  return Array.from({length:Math.ceil(max / step - 1e-9) + 1},(_,index) => Number((index * step).toPrecision(12)));
}

/** Até `limit` posições espalhadas de ponta a ponta, sempre sobre itens que existem. */
export function spread<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit || limit < 2) return items.slice(0,Math.max(limit,1));
  return Array.from({length:limit},(_,index) => items[Math.round(index * (items.length - 1) / (limit - 1))]!);
}

const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string) => [1,3,5].map(start => parseInt(hex.slice(start,start + 2),16));
const luminance = ([r = 0,g = 0,b = 0]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: string, b: string) => { const [hi = 0,lo = 0] = [luminance(rgb(a)),luminance(rgb(b))].sort((x,y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** Cor do perfil, clareada o bastante para uma linha de 2 px se ler sobre a superfície escura (WCAG 3:1 para gráficos). */
export function lineColor(color: string, surface = '#161a23'): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#aab3c2';
  let current = color;
  for (let step = 0; step < 10 && contrast(current,surface) < 3; step++) current = `#${rgb(current).map(value => Math.round(value + (255 - value) * 0.25).toString(16).padStart(2,'0')).join('')}`;
  return current;
}
