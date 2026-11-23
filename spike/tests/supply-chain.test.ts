import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
describe('atualização automática', () => {
  it('só publica direto (releaseType release) se houver publisherName de assinatura', () => {
    const publisherName = pkg.build?.win?.signtoolOptions?.publisherName;
    for (const target of [pkg.build.publish].flat()) {
      if (target.releaseType === 'release') expect(publisherName, 'sem assinatura, o release deve ser rascunho').toBeTruthy();
      expect(target.releaseType).toBeDefined();
    }
  });
});
describe('Electron Fuses', () => {
  it('configura os fuses de endurecimento sem quebrar file://', () => {
    expect(pkg.build.electronFuses).toMatchObject({ runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true });
    expect(pkg.build.electronFuses.grantFileProtocolExtraPrivileges).not.toBe(false); // o app carrega o renderer por file://
  });
});
describe('workflows', () => {
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter(name => /\.ya?ml$/.test(name));
  it('há workflows', () => { expect(files.length).toBeGreaterThan(0); });
  for (const file of files) {
    const text = readFileSync(`${dir}/${file}`, 'utf8');
    it(`${file}: toda action fixada por SHA de 40 hex`, () => {
      const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(match => match[1] ?? '');
      expect(uses.length).toBeGreaterThan(0);
      for (const use of uses) if (!use.startsWith('./')) expect(use, use).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    });
    it(`${file}: checkout sem credencial persistida`, () => {
      const blocks = text.split(/\n(?=\s*- (?:name|uses):)/).filter(block => /uses:\s*actions\/checkout@/.test(block));
      for (const block of blocks) expect(block).toMatch(/persist-credentials:\s*false/);
    });
  }
  it('release.yml: permissões mínimas e versões fixas', () => {
    const text = readFileSync(`${dir}/release.yml`, 'utf8');
    expect(text).toMatch(/^permissions:\s*\n\s+contents:\s*read/m);
    expect(text).not.toMatch(/node-version:\s*'?22'?\s*$/m);
    expect(text).not.toMatch(/bun-version:\s*'?1\.x/);
    expect(text).toContain('--publish never');
  });
});
