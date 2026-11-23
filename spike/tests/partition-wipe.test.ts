import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PARTITIONS_DIR, MAX_PENDING, clearAllSessionData, createWipeQueue, findOrphans, partitionPath, profileIdOfDir, runPendingWipes, type WipeFs } from '../electron/partition-wipe';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-9222-222222222222', C = '33333333-3333-4333-a333-333333333333';
const USER = resolve('/userdata');
/** fs falso em memória: arquivos e pastas, com `rm` registrado. */
function fakeFs(files: Record<string, string> = {}, dirs: Record<string, string[]> = {}) {
  const removed: string[] = [], written: string[] = [];
  const fs: WipeFs & {files: Record<string, string>; failRm: Set<string>} = {
    files, failRm: new Set(),
    readFile: path => { if (!(path in files)) throw new Error('ENOENT'); return files[path]!; },
    writeFile: (path, data) => { files[path] = data; written.push(path); },
    rename: (from, to) => { files[to] = files[from]!; delete files[from]; },
    mkdir: () => undefined,
    readdir: path => { if (!(path in dirs)) throw new Error('ENOENT'); return dirs[path]!; },
    rm: path => { if (fs.failRm.has(path)) throw new Error('EBUSY'); removed.push(path); },
  };
  return {fs, removed, written};
}
const FILE = join(USER, 'pending-wipes.json');

describe('partitionPath', () => {
  it('monta Partitions/pokehub-<uuid> dentro do userData', () => {
    expect(partitionPath(USER, A)).toBe(join(USER, PARTITIONS_DIR, `pokehub-${A}`));
    expect(partitionPath(USER, A.toUpperCase())).toBe(join(USER, PARTITIONS_DIR, `pokehub-${A.toUpperCase()}`));
  });
  it('rejeita traversal, separadores, vazio e qualquer coisa que não seja UUID v4', () => {
    for (const id of ['..', '../..', `../${A}`, `${A}/..`, `${A}\\..\\x`, '', '.', 'pokehub-x', `${A}/extra`, '%2e%2e', null, undefined, 5, {}, `${A}\0`, 'C:\\Windows', '/etc/passwd', '11111111-1111-1111-1111-111111111111']) expect(() => partitionPath(USER, id)).toThrow();
  });
});

describe('profileIdOfDir', () => {
  it('só reconhece pokehub-<uuid>', () => {
    expect(profileIdOfDir(`pokehub-${A}`)).toBe(A);
    for (const name of ['pokehub-x', `Pokehub-${A}`, A, `pokehub-${A}.bak`, 'pokehub-../x', '']) expect(profileIdOfDir(name)).toBeNull();
  });
});

describe('fila pending-wipes.json', () => {
  it('só enfileira UUIDs válidos e grava de forma atômica (tmp + rename)', () => {
    const {fs, written} = fakeFs();
    const q = createWipeQueue(FILE, fs);
    expect(q.add(A)).toBe(true);
    for (const bad of ['../x', '', null, 3, `${B}/..`]) expect(q.add(bad)).toBe(false);
    expect(q.list()).toEqual([A]);
    expect(written).toEqual([`${FILE}.tmp`]);
    expect(JSON.parse(fs.files[FILE]!)).toEqual([A]);
    expect(`${FILE}.tmp` in fs.files).toBe(false);
    expect(q.add(A)).toBe(true); expect(written).toHaveLength(1); // repetido não regrava
  });
  it('ignora entradas inválidas e arquivo corrompido ao carregar', () => {
    expect(createWipeQueue(FILE, fakeFs({[FILE]: JSON.stringify([A, '../..', 7, null, B.toUpperCase()])}).fs).list()).toEqual([A, B]);
    expect(createWipeQueue(FILE, fakeFs({[FILE]: '{não é json'}).fs).list()).toEqual([]);
    expect(createWipeQueue(FILE, fakeFs({[FILE]: '{"a":1}'}).fs).list()).toEqual([]);
    expect(createWipeQueue(FILE, fakeFs().fs).list()).toEqual([]);
  });
  it('tem teto de tamanho e desfaz o add se a gravação falhar', () => {
    const {fs} = fakeFs();
    const q = createWipeQueue(FILE, fs);
    for (let i = 0; i < MAX_PENDING; i++) expect(q.add(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)).toBe(true);
    expect(q.add(A)).toBe(false);
    const broken = createWipeQueue(FILE, {...fakeFs().fs, writeFile: () => { throw new Error('disco cheio'); }});
    expect(broken.add(A)).toBe(false); expect(broken.list()).toEqual([]);
  });
});

describe('runPendingWipes', () => {
  it('apaga só as pastas da fila e as tira da fila; falha mantém o id', () => {
    const {fs, removed} = fakeFs({[FILE]: JSON.stringify([A, B])});
    fs.failRm.add(partitionPath(USER, B));
    const q = createWipeQueue(FILE, fs);
    expect(runPendingWipes(USER, q, fs)).toEqual({wiped: [A], failed: [B]});
    expect(removed).toEqual([partitionPath(USER, A)]);
    expect(JSON.parse(fs.files[FILE]!)).toEqual([B]);
  });
  it('nunca chama rm fora de Partitions, mesmo com a fila adulterada em memória', () => {
    const {fs, removed} = fakeFs();
    const evil = {list: () => ['../../x', `${A}/../..`, A], delete: vi.fn(), add: vi.fn(), has: vi.fn()};
    const result = runPendingWipes(USER, evil, fs);
    expect(result.wiped).toEqual([A]); expect(result.failed).toEqual(['../../x', `${A}/../..`]);
    expect(removed).toEqual([partitionPath(USER, A)]);
    expect(removed.every(path => path.startsWith(join(USER, PARTITIONS_DIR) + (process.platform === 'win32' ? '\\' : '/')))).toBe(true);
  });
});

describe('findOrphans', () => {
  const dir = join(USER, PARTITIONS_DIR);
  it('lista pokehub-<uuid> sem perfil e ainda fora da fila; ignora o resto', () => {
    const {fs} = fakeFs({[FILE]: JSON.stringify([C])}, {[dir]: [`pokehub-${A}`, `pokehub-${B}`, `pokehub-${C}`, 'pokehub-lixo', 'outra-pasta', `pokehub-${B}`]});
    const q = createWipeQueue(FILE, fs);
    expect(findOrphans(USER, [A], q, fs)).toEqual([B]); // A tem perfil, C já está na fila, B (repetido) conta uma vez
    expect(findOrphans(USER, [A.toUpperCase(), B], q, fs)).toEqual([]);
  });
  it('sem pasta Partitions não há órfãos', () => {
    const {fs} = fakeFs();
    expect(findOrphans(USER, [], createWipeQueue(FILE, fs), fs)).toEqual([]);
  });
});

describe('clearAllSessionData', () => {
  it('limpa storages, cache, caches de código, autenticação e DNS, nessa ordem', async () => {
    const calls: string[] = [];
    const s = {clearStorageData: async () => { calls.push('storage'); }, clearCache: async () => { calls.push('cache'); }, clearCodeCaches: async (o: object) => { calls.push(`code:${JSON.stringify(o)}`); }, clearAuthCache: async () => { calls.push('auth'); }, clearHostResolverCache: async () => { calls.push('dns'); }};
    await clearAllSessionData(s);
    expect(calls).toEqual(['storage', 'cache', 'code:{}', 'auth', 'dns']);
  });
  it('propaga a falha (a limpeza parcial é avisada ao usuário)', async () => {
    const s = {clearStorageData: async () => { throw new Error('x'); }, clearCache: async () => undefined, clearCodeCaches: async () => undefined, clearAuthCache: async () => undefined, clearHostResolverCache: async () => undefined};
    await expect(clearAllSessionData(s)).rejects.toThrow();
  });
});
