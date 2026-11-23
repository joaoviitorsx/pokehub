import { describe, expect, it } from 'vitest';
import { auditExtension, auditExtensionAsync, createAuditCache, type ExtFs } from '../electron/extension-check';

// fs em memória (só arquivos; pastas inferidas), nas versões síncrona e assíncrona; a assíncrona conta as leituras
type Files = Record<string, {text: string; mtime: number; link?: boolean}>;
const MANIFEST = JSON.stringify({manifest_version: 3, name: 'T', version: '1.0.0', content_scripts: [{matches: ['https://pokeidle.io/*'], js: ['a.js']}]});
const withManifest = (files: Files): Files => ({'/x/manifest.json': {text: MANIFEST, mtime: 1}, ...files});
const dirs = (files: Files, path: string) => Object.keys(files).some(name => name.startsWith(`${path}/`));
const statOf = (files: Files, path: string) => { const f = files[path]; if (f) return {isDirectory: () => false, isSymbolicLink: () => Boolean(f.link), size: Buffer.byteLength(f.text), mtimeMs: f.mtime, ctimeMs: f.mtime, ino: 1}; if (!dirs(files, path)) throw new Error('ENOENT'); return {isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtimeMs: 0}; };
const names = (files: Files, path: string) => [...new Set(Object.keys(files).filter(name => name.startsWith(`${path}/`)).map(name => name.slice(path.length + 1).split('/')[0]!))];
function syncFs(files: Files): ExtFs {
  return {
    statSync: path => statOf(files, path),
    lstatSync: path => statOf(files, path),
    readFileSync(path) { const f = files[path]; if (!f) throw new Error('ENOENT'); return f.text; },
    readdirSync: path => names(files, path),
  };
}
function asyncFs(files: Files) {
  const reads: string[] = [];
  return {
    reads,
    fs: {
      async stat(path: string) { return statOf(files, path); },
      async lstat(path: string) { return statOf(files, path); },
      async readFile(path: string) { reads.push(path); const f = files[path]; if (!f) throw new Error('ENOENT'); return f.text; },
      async readdir(path: string) { return names(files, path); },
    },
  };
}

describe('auditoria assíncrona e cache', () => {
  it('dá o mesmo resultado da versão síncrona', async () => {
    const files = withManifest({'/x/a.js': {text: "fetch('https://api.exemplo.com/x'); el.click()", mtime: 1}, '/x/b.js': {text: 'eval(code)', mtime: 1}});
    expect(await auditExtensionAsync('/x', asyncFs(files).fs)).toEqual(auditExtension('/x', syncFs(files)));
  });
  it('vale o guardado sem tocar no disco; com verify relê para conferir o conteúdo e só varre de novo se mudou', async () => {
    const files = withManifest({'/x/a.js': {text: 'const x=1', mtime: 1}});
    const {fs, reads} = asyncFs(files);
    const cache = createAuditCache(fs);
    expect((await cache.get('/x', '1.0.0')).verdict).toBe('leitura');
    const first = reads.length;
    await cache.get('/x', '1.0.0');
    expect(reads).toHaveLength(first); // sem verify: nada é lido
    const same = await cache.get('/x', '1.0.0', true);
    expect(same.verdict).toBe('leitura');
    files['/x/a.js'] = {text: "fetch('https://novo.example.com/x')", mtime: 2};
    expect((await cache.get('/x', '1.0.0')).verdict).toBe('leitura'); // sem verify vale o guardado
    expect((await cache.get('/x', '1.0.0', true)).verdict).toBe('externa');
    expect((await cache.get('/x', '1.0.1')).verdict).toBe('externa'); // outra versão: nova auditoria
    expect(cache.size).toBe(1); // a entrada antiga da pasta é descartada
    const before = reads.length;
    cache.forget('/x');
    await cache.get('/x', '1.0.1');
    expect(reads.length).toBeGreaterThan(before);
    cache.prune([]);
    expect(cache.size).toBe(0);
  });
  it('mesmo tamanho e mesma data com outro conteúdo: o verify audita de novo (hash do conteúdo)', async () => {
    const files = withManifest({'/x/a.js': {text: "fetch('/aaaaaaaa')", mtime: 5}});
    const cache = createAuditCache(asyncFs(files).fs);
    expect((await cache.get('/x', '1.0.0')).verdict).toBe('leitura');
    files['/x/a.js'] = {text: `eval("${'a'.repeat(10)}")`, mtime: 5}; // 18 bytes nos dois, mtime igual
    expect(Buffer.byteLength(files['/x/a.js'].text)).toBe(Buffer.byteLength("fetch('/aaaaaaaa')"));
    expect(await cache.unchanged('/x', '1.0.0')).toBe(true); // a checagem barata (stat) não vê
    expect((await cache.get('/x', '1.0.0', true)).verdict).toBe('bloqueada'); // o hash vê
  });
  it('unchanged: só lstat; muda com tamanho, data, arquivo novo ou link simbólico', async () => {
    const files = withManifest({'/x/a.js': {text: 'const x=1', mtime: 1}});
    const {fs, reads} = asyncFs(files);
    const cache = createAuditCache(fs);
    expect(await cache.unchanged('/x', '1.0.0')).toBe(false); // nada auditado ainda
    await cache.get('/x', '1.0.0');
    const audited = reads.length;
    expect(await cache.unchanged('/x', '1.0.0')).toBe(true);
    expect(reads).toHaveLength(audited);
    files['/x/a.js'] = {text: 'const x=1', mtime: 2};
    expect(await cache.unchanged('/x', '1.0.0')).toBe(false);
    await cache.get('/x', '1.0.0', true);
    expect(await cache.unchanged('/x', '1.0.0')).toBe(true);
    files['/x/novo.txt'] = {text: 'x', mtime: 1};
    expect(await cache.unchanged('/x', '1.0.0')).toBe(false);
    await cache.get('/x', '1.0.0', true);
    files['/x/novo.txt'] = {text: 'x', mtime: 1, link: true};
    expect(await cache.unchanged('/x', '1.0.0')).toBe(false);
    expect((await cache.get('/x', '1.0.0', true)).verdict).toBe('bloqueada');
  });
});
