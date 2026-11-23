const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = mkdtempSync(join(tmpdir(), 'pokehub-electron-smoke-'));
let exitCode = 0;
try {
  const electronCli = require.resolve('electron/cli.js');
  for (const phase of ['write','read']) {
    const result = spawnSync(process.execPath, [electronCli, join(__dirname,'electron-smoke.cjs')], {
      stdio:'inherit', timeout:45000,
      env:{...process.env, POKEHUB_SMOKE_DIR:directory, POKEHUB_SMOKE_PHASE:phase},
    });
    if (result.error || result.status !== 0) {
      console.error(`Smoke test ${phase} falhou${result.error ? `: ${result.error.message}` : ` (código ${result.status ?? 'sem código'})`}.`);
      exitCode = 1; break;
    }
  }
} finally {
  try { rmSync(directory,{recursive:true,force:true}); }
  catch { console.error('Não foi possível remover o diretório temporário do smoke test:',directory); exitCode = 1; }
}
process.exitCode = exitCode;
