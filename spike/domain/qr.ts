// Gerador de QR Code (modo byte, correção M, versões 1–10: até 213 bytes) sem dependências. Puro. Serve para o endereço do acesso remoto.
const EC_M: readonly [number, number, number, number, number][] = [ // por versão: [ec por bloco, blocos A, dados A, blocos B, dados B]
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_BYTES = 213;

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
const mul = (a: number, b: number) => a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
function rsEncode(data: readonly number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) { const next = new Array<number>(gen.length + 1).fill(0); gen.forEach((c, j) => { next[j] = next[j]! ^ mul(c, EXP[i]!); next[j + 1] = next[j + 1]! ^ c; }); gen = next; }
  // gen está em ordem crescente de grau; o divisor mônico usa os coeficientes de grau (degree-1)..0
  const coef = gen.slice(0, degree).reverse(), rest = new Array<number>(degree).fill(0);
  for (const byte of data) { const factor = byte ^ rest.shift()!; rest.push(0); coef.forEach((c, i) => { rest[i] = rest[i]! ^ mul(c, factor); }); }
  return rest;
}
const bch = (value: number, poly: number, bitsLen: number) => { let v = value << bitsLen; const top = 31 - Math.clz32(poly); for (let i = 31 - Math.clz32(v); i >= top; i--) if ((v >>> i) & 1) v ^= poly << (i - top); return v; };

/** O parâmetro forceMask (0–7) existe só para testes; normalmente a máscara de menor penalidade é escolhida. */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = EC_M.findIndex(([, a, da, b, db], i) => bytes.length + (i < 9 ? 2 : 3) <= a * da + b * db) + 1;
  if (version === 0) throw new RangeError('Texto grande demais para o QR');
  const [ecLen, na, da, nb, db] = EC_M[version - 1]!, total = na * da + nb * db, size = 17 + 4 * version;
  // dados
  const bits: number[] = [];
  const push = (value: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(4, 4); push(bytes.length, version < 10 ? 8 : 16); bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, total * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const words: number[] = []; for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; words.length < total; pad ^= 0xec ^ 0x11) words.push(pad);
  // blocos + ECC intercalados
  const blocks: {data: number[]; ec: number[]}[] = []; let at = 0;
  for (let i = 0; i < na + nb; i++) { const n = i < na ? da : db, data = words.slice(at, at += n); blocks.push({data, ec: rsEncode(data, ecLen)}); }
  const stream: number[] = [];
  for (let i = 0; i < Math.max(da, db); i++) for (const b of blocks) if (i < b.data.length) stream.push(b.data[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) stream.push(b.ec[i]!);
  // matriz
  const mod = Array.from({length: size}, () => new Array<boolean>(size).fill(false)), fn = Array.from({length: size}, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { if (x >= 0 && y >= 0 && x < size && y < size) { mod[y]![x] = dark; fn[y]![x] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  const pos = ALIGN[version - 1]!;
  for (const cy of pos) for (const cx of pos) { if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const drawFormat = (mask: number) => {
    const f = (((0 << 3) | mask) << 10 | bch((0 << 3) | mask, 0x537, 10)) ^ 0x5412; // nível M = 00
    const b = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i)); set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i)); set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) { const v = (version << 12) | bch(version, 0x1f25, 12); for (let i = 0; i < 18; i++) { const dark = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); } }
  // dados em zigue-zague
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y]![x]) { mod[y]![x] = bit < stream.length * 8 ? ((stream[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1 : false; bit++; }
    }
  }
  const masks = [(x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0, (x: number) => x % 3 === 0, (x: number, y: number) => (x + y) % 3 === 0, (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0, (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const apply = (m: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && masks[m]!(x, y)) mod[y]![x] = !mod[y]![x]; };
  let best = forceMask ?? 0, bestScore = Infinity;
  if (forceMask === undefined) for (let m = 0; m < 8; m++) { apply(m); drawFormat(m); const s = penalty(mod); if (s < bestScore) { bestScore = s; best = m; } apply(m); }
  apply(best); drawFormat(best);
  return mod;
}
function penalty(m: boolean[][]): number {
  const n = m.length; let score = 0;
  const runs = (line: boolean[]) => {
    let run = 1, s = 0;
    for (let i = 1; i < n; i++) { if (line[i] === line[i - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; }
    const str = line.map(v => v ? '1' : '0').join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = str.indexOf(pat); i !== -1; i = str.indexOf(pat, i + 1)) s += 40;
    return s;
  };
  for (let y = 0; y < n; y++) score += runs(m[y]!);
  for (let x = 0; x < n; x++) score += runs(m.map(row => row[x]!));
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const v = m[y]![x]; if (v === m[y]![x + 1] && v === m[y + 1]![x] && v === m[y + 1]![x + 1]) score += 3; }
  const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
  return score + Math.max(0, Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
}
/** Caminho SVG (um quadrado por módulo escuro) com margem de 4 módulos; `viewBox` = `0 0 size size`. */
export function qrPath(matrix: boolean[][], border = 4): {d: string; size: number} {
  let d = '';
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + border} ${y + border}h1v1h-1z`; }));
  return {d, size: matrix.length + border * 2};
}
