import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PIXEL_ICONS } from '../remote-ui/pixel-icons';

const norm = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
describe('DNA visual do celular', () => {
  const desktop = norm('spike/src/style.css'), shared = norm('spike/shared/dna.css'), phone = norm('spike/remote-ui/remote.css');
  it('tokens, keyframes, pontos de estado e pedestal são idênticos aos do desktop (nada de cópia que divergiu)', () => {
    const lines = shared.split('\n').filter(l => /^( {2}--[\w-]+:|@keyframes|\.st[ [.]|\.empty-art)/.test(l) && !l.includes('color-scheme'));
    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) expect(desktop, line).toContain(line);
  });
  it('o CSS do celular usa os tokens --pi-* e não redefine a paleta', () => {
    expect(phone).toContain('var(--pi-mad)'); expect(phone).toContain('var(--pi-ouro)'); expect(phone).toContain('var(--pi-rx)'); expect(phone).toContain('var(--pi-noite-clr)'); expect(phone).toContain('var(--dur');
    expect(phone).not.toMatch(/^\s*--pi-[\w-]+:/m);
  });
  it('respeita prefers-reduced-motion', () => { expect(shared).toContain('prefers-reduced-motion: reduce'); });
  it('ícones de pixel: grade 12×12 inteira, só . X o', () => {
    for (const [name, rows] of Object.entries(PIXEL_ICONS)) { expect(rows, name).toHaveLength(12); for (const row of rows) expect(row, name).toMatch(/^[.Xo]{12}$/); }
  });
});
