export type Element = 'flame' | 'bolt' | 'leaf' | 'drop' | 'star';
/** Símbolo decorativo derivado do matiz da cor do perfil (#rrggbb); não é persistido. */
export function elementOf(color: string): Element {
  const channel = (i: number) => parseInt(color.slice(i, i + 2), 16) / 255;
  const r = channel(1), g = channel(3), b = channel(5);
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  if (!(delta >= 0.12)) return 'star'; // cinzas e cores inválidas (NaN)
  const hue = (60 * (max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) + 360) % 360;
  return hue < 30 || hue >= 330 ? 'flame' : hue < 70 ? 'bolt' : hue < 170 ? 'leaf' : hue < 260 ? 'drop' : 'star';
}
