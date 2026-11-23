import { describe, expect, it } from 'vitest';
import { auditExtension, auditExtensionAsync, createAuditCache, type ExtFs } from '../electron/extension-check';

// fs em memória (só arquivos; pastas inferidas), nas versões síncrona e assíncrona; a assíncrona conta as leituras
type Files = Record<string, {text: string; mtime: number}>;
const dirs = (files: Files, path: string) => Object.keys(files).some(name => name.startsWith(`${path}/`));
function syncFs(files: Files): ExtFs {
  return {
    statSync(path) { const f = files[path]; if (f) return {isDirectory: () => false, size: Buffer.byteLength(f.text)}; if (!dirs(files, path)) throw new Error('ENOENT'); return {isDirectory: () => true, size: 0}; },
    readFileSync(path) { const f = files[path]; if (!f) throw new Error('ENOENT'); return f.text; },
    readdirSync(path) { return [...new Set(Object.keys(files).filter(name => name.startsWith(`${path}/`)).map(name => name.slice(path.length + 1).split('/')[0]!))]; },
  };
}
function asyncFs(files: Files) {
  const reads: string[] = [];
  return {
    reads,
    fs: {
      async stat(path: string) { const f = files[path]; if (f) return {isDirectory: () => false, size: Buffer.byteLength(f.text), mtimeMs: f.mtime}; if (!dirs(files, path)) throw new Error('ENOENT'); return {isDirectory: () => true, size: 0, mtimeMs: 0}; },
      async readFile(path: string) { reads.push(path); const f = files[path]; if (!f) throw new Error('ENOENT'); return f.text; },
      async readdir(path: string) { return [...new Set(Object.keys(files).filter(name => name.startsWith(`${path}/`)).map(name => name.slice(path.length + 1).split('/')[0]!))]; },
    },
  };
}

describe('auditoria assíncrona e cache', () => {
  it('dá o mesmo resultado da versão síncrona', async () => {
    const files: Files = {'/x/a.js': {text: "fetch('https://api.exemplo.com/x'); el.click()", mtime: 1}, '/x/b.js': {text: 'eval(code)', mtime: 1}};
    expect(await auditExtensionAsync('/x', asyncFs(files).fs)).toEqual(auditExtension('/x', syncFs(files)));
  });
  it('não relê nada enquanto versão, arquivos, tamanhos e datas são os mesmos; relê quando mudam', async () => {
    const files: Files = {'/x/a.js': {text: 'const x=1', mtime: 1}};
    const {fs, reads} = asyncFs(files);
    const cache = createAuditCache(fs);
    expect((await cache.get('/x', '1.0.0')).verdict).toBe('leitura');
    expect(reads).toHaveLength(1);
    await cache.get('/x', '1.0.0');
    await cache.get('/x', '1.0.0', true); // com verify só há stat
    expect(reads).toHaveLength(1);
    files['/x/a.js'] = {text: "fetch('https://novo.example.com/x')", mtime: 2};
    expect((await cache.get('/x', '1.0.0')).verdict).toBe('leitura'); // sem verify vale o guardado
    expect((await cache.get('/x', '1.0.0', true)).verdict).toBe('externa');
    expect(reads).toHaveLength(2);
    expect((await cache.get('/x', '1.0.1')).verdict).toBe('externa'); // outra versão: nova auditoria
    expect(reads).toHaveLength(3);
    expect(cache.size).toBe(1); // a entrada antiga da pasta é descartada
    cache.forget('/x');
    await cache.get('/x', '1.0.1');
    expect(reads).toHaveLength(4);
    cache.prune([]);
    expect(cache.size).toBe(0);
  });
});
