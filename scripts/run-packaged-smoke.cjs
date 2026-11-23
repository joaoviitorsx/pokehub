// Smoke do app EMPACOTADO (release/*-unpacked): abre o executável com uma pasta de dados temporária, espera ele encerrar sozinho
// e confere o smoke-result.json. Nunca toca nos dados reais. Uso: node scripts/run-packaged-smoke.cjs [executável] [ms]
// Só vale porque o app honra POKEHUB_SMOKE=1 + POKEHUB_SMOKE_DIR (pasta existente dentro do temp) + POKEHUB_SMOKE_EXIT_MS (spike/electron/smoke.ts).
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

function findExecutable() {
  const root = resolve('release');
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!name.endsWith('-unpacked') || !statSync(dir).isDirectory()) continue;
    for (const exe of ['PokeHub.exe', 'pokehub', 'PokeHub', 'pokehub-spike']) { const path = join(dir, exe); if (existsSync(path) && statSync(path).isFile()) return path; }
  }
  return null;
}

const exe = process.argv[2] ? resolve(process.argv[2]) : findExecutable();
const exitMs = Number(process.argv[3]) || 6000;
if (!exe || !existsSync(exe)) { console.error('Executável empacotado não encontrado em release/*-unpacked (rode o dist antes).'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'pokehub-packaged-smoke-'));
let code = 1;
try {
  const result = spawnSync(exe, [], { stdio: 'inherit', timeout: exitMs + 45000, env: { ...process.env, POKEHUB_SMOKE: '1', POKEHUB_SMOKE_DIR: dir, POKEHUB_SMOKE_EXIT_MS: String(exitMs) } });
  if (result.error) throw result.error;
  const file = join(dir, 'smoke-result.json');
  if (!existsSync(file)) throw new Error(`O app terminou (código ${result.status}) sem gravar smoke-result.json.`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  console.log(JSON.stringify(json));
  if (json.ok !== true || json.uiLoaded !== true || !(json.dbVersion >= 1) || json.errors.length) throw new Error('Smoke do app empacotado reprovou.');
  console.log('Smoke do app empacotado: ok.');
  code = 0;
} catch (error) { console.error(error.message); }
finally { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { console.error('Não foi possível remover', dir); } }
process.exit(code);
