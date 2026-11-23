// Ícones da navegação em pixel art: grade 12×12 inteira, quadrados de 1 unidade (shape-rendering crispEdges). X = cheio, o = meio-tom.
export const PIXEL_ICONS: Record<string, readonly string[]> = {
  contas: ['XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX', '............', '............', 'XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX', 'XXXXX..XXXXX'],
  conta: ['....XXXX....', '..XXXXXXXX..', '.XXXXXXXXXX.', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXXX....XXXX', 'XXXX....XXXX', 'XXXXXXXXXXXX', '.oooooooooo.', '.oooooooooo.', '..oooooooo..', '....oooo....'],
  loja: ['....XXXX....', '...X....X...', '...X....X...', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '.XXXXXXXXXX.', '............'],
  mercado: ['............', '.........XX.', '.........XX.', '.........XX.', '.....XX..XX.', '.....XX..XX.', '.....XX..XX.', '.XX..XX..XX.', '.XX..XX..XX.', '.XX..XX..XX.', '............', 'XXXXXXXXXXXX'],
  alertas: ['.....XX.....', '....XXXX....', '...XXXXXX...', '...XXXXXX...', '...XXXXXX...', '..XXXXXXXX..', '..XXXXXXXX..', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', '............', '....oooo....', '.....oo.....'],
  // alertas
  shiny: ['.....XX.....', '.....XX.....', '....XXXX....', '....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '....XXXX....', '....XXXX....', '.....XX.....', '.....XX.....'],
  p5: ['............', '............', '............', 'XXXX..XXXXX.', 'X...X.X.....', 'X...X.XXXX..', 'XXXX.....X..', 'X.........X.', 'X.....X...X.', 'X......XXX..', '............', '............'],
  recorde: ['............', '.XXXXXXXXXX.', 'XX.XXXXXX.XX', 'X..XXXXXX..X', 'XX.XXXXXX.XX', '.XXXXXXXXXX.', '..XXXXXXXX..', '....XXXX....', '.....XX.....', '.....XX.....', '...XXXXXX...', '...XXXXXX...'],
  nota: ['............', '...XXXXXX...', '..XooXXXXX..', '.XXooXXXXXX.', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '..XXXXXXXX..', '...XXXXXX...', '....XXXX....', '.....XX.....', '............', '............'],
  conta_caiu: ['XX........XX', 'XXX......XXX', '.XXX....XXX.', '..XXX..XXX..', '...XXXXXX...', '....XXXX....', '....XXXX....', '...XXXXXX...', '..XXX..XXX..', '.XXX....XXX.', 'XXX......XXX', 'XX........XX'],
  conta_voltou: ['............', '..........XX', '.........XXX', '........XXX.', 'XX.....XXX..', 'XXX...XXX...', '.XXX.XXX....', '..XXXXX.....', '...XXX......', '....X.......', '............', '............'],
};
export function PixelIcon({name, size = 24, className = 'px'}: {name: string; size?: number; className?: string}) {
  const rows = PIXEL_ICONS[name] ?? [];
  const full: string[] = [], half: string[] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') full.push(`M${x} ${y}h1v1h-1z`); else if (c === 'o') half.push(`M${x} ${y}h1v1h-1z`); }));
  return <svg className={className} width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true"><path d={full.join('')} fill="currentColor"/><path d={half.join('')} fill="currentColor" opacity=".55"/></svg>;
}
