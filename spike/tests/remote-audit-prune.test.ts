import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/database';
import { RemoteStore } from '../remote/store';
import { CAP_INPUT_MAX, cleanCapInput, parseCapInput } from '../src/cap-input';

const dir = mkdtempSync(join(tmpdir(), 'pokehub-prune-'));
afterAll(() => { try { rmSync(dir, {recursive: true, force: true}); } catch { /* Windows */ } });
let n = 0;
const make = () => { const path = join(dir, `a${++n}.sqlite`); openDatabase(path).close(); return {path, store: new RemoteStore(path)}; };
const actions = (path: string) => { const db = new DatabaseSync(path); try { return db.prepare('SELECT action, COUNT(*) AS n FROM remote_audit GROUP BY action').all().map(r => `${String(r.action)}:${Number(r.n)}`); } finally { db.close(); } };
const day = 86_400_000, base = Date.parse('2026-11-23T12:00:00.000Z'), iso = (ms: number) => new Date(ms).toISOString();

describe('auditoria: poda que preserva o que é crítico', () => {
  it('3000 linhas comuns não apagam a compra confirmada nem o controle', () => {
    const {path, store} = make();
    store.audit('d1', 'compra_confirmada', 'x', iso(base)); store.audit('d1', 'controle_inicio', 'y', iso(base)); store.audit('d1', 'pin_bloqueado', 'z', iso(base));
    for (let i = 0; i < 3000; i++) store.audit('d1', 'loja_leitura', `i${i}`, iso(base + 1000 + i));
    const left = actions(path); expect(left).toContain('compra_confirmada:1'); expect(left).toContain('controle_inicio:1'); expect(left).toContain('pin_bloqueado:1'); expect(Number(left.find(x => x.startsWith('loja_leitura'))!.split(':')[1])).toBeLessThanOrEqual(2025); store.close();
  }, 60_000);
  it('comuns vencem em 30 dias; críticas só em 365', () => {
    const {path, store} = make();
    store.audit('d1', 'loja_plano', 'velha', iso(base - 31 * day)); store.audit('d1', 'compra_confirmada', 'velha', iso(base - 200 * day)); store.audit('d1', 'compra_confirmada', 'antiga', iso(base - 400 * day));
    store.audit('d1', 'loja_plano', 'nova', iso(base)); for (let i = 0; i < 25; i++) store.audit('d1', 'compra_confirmada', 'f', iso(base)); expect(actions(path).sort()).toEqual(['compra_confirmada:26', 'loja_plano:1']); store.close();
  });
});

describe('teto: entrada do campo', () => {
  it('aceita milhar com ponto e só dígitos', () => {
    expect(parseCapInput('150.000')).toBe(150_000); expect(parseCapInput('150000')).toBe(150_000); expect(parseCapInput('0')).toBe(0); expect(parseCapInput('1.000.000.000')).toBe(CAP_INPUT_MAX);
  });
  it('recusa vazio, letras e acima do máximo', () => {
    for (const bad of ['', 'abc', '1a', '-5', '1,5', '1.000.000.001', '12345678901', ' ']) expect(parseCapInput(bad), bad).toBeNull();
  });
  it('cleanCapInput tira o que não é dígito nem ponto', () => { expect(cleanCapInput('1a.5 0x')).toBe('1.50'); });
});
