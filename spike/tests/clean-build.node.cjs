const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { cleanBuild } = require('../clean-build.cjs');

test('limpa somente o diretório de saída informado', () => {
  const root = mkdtempSync(join(tmpdir(),'pokehub-clean-'));
  try {
    const output = join(root,'dist-electron');
    const sibling = join(root,'keep.txt');
    mkdirSync(output); writeFileSync(join(output,'stale.js'),'stale'); writeFileSync(sibling,'keep');
    cleanBuild(output);
    assert.equal(existsSync(output),false);
    assert.equal(existsSync(sibling),true);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
