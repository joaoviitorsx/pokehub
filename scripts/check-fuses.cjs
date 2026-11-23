// Confere, no app empacotado (release/*-unpacked), se os Electron Fuses esperados estão aplicados.
// Uso: node scripts/check-fuses.cjs [pasta-ou-executável ...]   (sem argumentos, procura em release/)
// Alternativa manual: npx @electron/fuses read --app <caminho do executável>
const { existsSync, readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const EXPECTED = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
};

function findExecutables(root) {
  const found = [];
  if (!existsSync(root)) return found;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (!statSync(path).isDirectory() || !name.endsWith('-unpacked')) continue;
    for (const exe of ['PokeHub.exe', 'PokeHub', 'pokehub', 'pokehub-spike']) if (existsSync(join(path, exe))) found.push(join(path, exe));
  }
  return found;
}

async function main() {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const FuseState = { DISABLE: 48, ENABLE: 49 }; // valores de @electron/fuses (constants.d.ts)
  const args = process.argv.slice(2);
  const targets = args.length ? args.map(arg => resolve(arg)) : findExecutables(resolve('release'));
  if (!targets.length) { console.error('Nenhum app empacotado encontrado em release/*-unpacked.'); process.exit(1); }
  let failed = false;
  for (const target of targets) {
    const wire = await getCurrentFuseWire(target);
    for (const [name, want] of Object.entries(EXPECTED)) {
      const state = wire[FuseV1Options[name]];
      const ok = state === (want ? FuseState.ENABLE : FuseState.DISABLE);
      if (!ok) failed = true;
      console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}=${state === FuseState.ENABLE} (esperado ${want}) em ${target}`);
    }
  }
  if (failed) process.exit(1);
}
main().catch(error => { console.error(error.message); process.exit(1); });
