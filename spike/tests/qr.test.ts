import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath, QR_MAX_BYTES } from '../domain/qr';

const hash = (m: boolean[][]) => createHash('sha256').update(m.map(r => r.map(v => v ? '1' : '0').join('')).join('\n')).digest('hex').slice(0, 16);
describe('QR code', () => {
  it('tamanho por versão e padrões de localização nos três cantos', () => {
    const small = qrMatrix('https://192.168.0.5:47321'); // 25 bytes → versão 2 (25 módulos)
    expect(small.length).toBe(25);
    for (const [x, y] of [[0, 0], [18, 0], [0, 18]] as const) { expect(small[y]![x]).toBe(true); expect(small[y + 3]![x + 3]).toBe(true); expect(small[y + 1]![x + 1]).toBe(false); }
    expect(qrMatrix('a').length).toBe(21);
    expect(qrMatrix('x'.repeat(QR_MAX_BYTES)).length).toBe(57);
  });
  it('é determinístico e igual ao conferido contra uma biblioteca de referência (fora do projeto)', () => {
    // cada máscara dá um QR válido; este é o módulo a módulo igual ao da biblioteca de referência para a máscara escolhida
    const a = qrMatrix('https://192.168.0.5:47321');
    expect(hash(a)).toBe(hash(qrMatrix('https://192.168.0.5:47321')));
    expect(hash(a)).toBe('c2a1bfde5b7e62f9'); // regressão: com a máscara escolhida, cada módulo foi conferido uma vez contra a biblioteca qrcode-generator (mesma máscara forçada)
  });
  it('recusa texto grande demais e gera o caminho SVG com margem', () => {
    expect(() => qrMatrix('x'.repeat(QR_MAX_BYTES + 1))).toThrow(RangeError);
    const {d, size} = qrPath(qrMatrix('oi'));
    expect(size).toBe(21 + 8); expect(d).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
