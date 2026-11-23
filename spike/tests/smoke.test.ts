import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { smokeConfig } from '../electron/smoke';

describe('smoke do app empacotado: só dentro da pasta temporária e com a trava explícita', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pokehub-smoke-test-'));
  const env = (extra: Record<string, string>) => ({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: dir, ...extra});
  it('aceita pasta existente dentro do temp', () => {
    const cfg = smokeConfig(env({POKEHUB_SMOKE_EXIT_MS: '1500'}));
    expect(cfg?.exitMs).toBe(1500);
    expect(cfg?.dir).toBeTruthy();
    rmSync(dir, {recursive: true, force: true});
  });
  it('ignora sem POKEHUB_SMOKE=1', () => { expect(smokeConfig({POKEHUB_SMOKE_DIR: tmpdir()})).toBeNull(); expect(smokeConfig({POKEHUB_SMOKE: 'true', POKEHUB_SMOKE_DIR: tmpdir()})).toBeNull(); });
  it('recusa o próprio temp, pastas fora dele, relativas e inexistentes', () => {
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: tmpdir()})).toBeNull();
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: join(tmpdir(), '..')})).toBeNull();
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: process.cwd()})).toBeNull();
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: 'relativo'})).toBeNull();
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: join(tmpdir(), 'nao-existe-pokehub-xyz')})).toBeNull();
  });
  it('limita o tempo de saída', () => {
    const d = mkdtempSync(join(tmpdir(), 'pokehub-smoke-test-'));
    expect(smokeConfig({POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: d, POKEHUB_SMOKE_EXIT_MS: '99999999'})?.exitMs).toBe(8000);
    rmSync(d, {recursive: true, force: true});
  });
});
