import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/*
 * Smoke test do app EMPACOTADO (CI e verificação local). Só vale com POKEHUB_SMOKE=1 E POKEHUB_SMOKE_DIR apontando para uma
 * pasta JÁ EXISTENTE DENTRO da pasta temporária do sistema (nunca a própria pasta temporária, nunca fora dela). Fora disso é ignorado:
 * o app usa os dados reais normalmente. Não aceita nenhuma chave de linha de comando. POKEHUB_SMOKE_EXIT_MS (500..120000, padrão 8000)
 * define quando o app grava smoke-result.json e encerra sozinho.
 */
export interface SmokeConfig { dir: string; exitMs: number }
export interface SmokeResult { ok: boolean; version: string; uiLoaded: boolean; dbVersion: number | null; errors: string[]; remote?: {ok: boolean; checks: Record<string, boolean | string>} | null }

export function smokeConfig(env: Record<string, string | undefined> = process.env, temp: string = tmpdir(), real: (path: string) => string = realpathSync.native): SmokeConfig | null {
  if (env.POKEHUB_SMOKE !== '1') return null;
  const raw = env.POKEHUB_SMOKE_DIR;
  if (!raw || !isAbsolute(raw)) return null;
  try {
    const base = real(temp);
    const dir = resolve(raw);
    if (!existsSync(dir)) return null; // a pasta já deve existir (criada por quem lança o teste)
    const rel = relative(base, real(dir));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    const parsed = Number(env.POKEHUB_SMOKE_EXIT_MS);
    const exitMs = Number.isFinite(parsed) && parsed >= 500 && parsed <= 120000 ? Math.floor(parsed) : 8000;
    return {dir: real(dir), exitMs};
  } catch { return null; }
}

export function writeSmokeResult(dir: string, result: SmokeResult): void {
  writeFileSync(join(dir, 'smoke-result.json'), `${JSON.stringify(result, null, 2)}\n`);
}
export const smokeResultExists = (dir: string): boolean => existsSync(join(dir, 'smoke-result.json'));
