import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isProfileId } from '../domain/profiles';

/*
 * DADOS ÓRFÃOS: `userData/Partitions/pokehub-<uuid>` guarda os cookies de login de cada conta. Com o app aberto o Chromium mantém a pasta
 * em uso, então apagar/remover um perfil só ENFILEIRA o id em `pending-wipes.json`; no próximo início, antes de qualquer sessão existir,
 * as pastas da fila são apagadas. Só ids no formato UUID e caminhos que ficam dentro de `Partitions` chegam ao `rm`.
 */
export const PENDING_FILE = 'pending-wipes.json', PARTITIONS_DIR = 'Partitions', MAX_PENDING = 64;
const PREFIX = 'pokehub-';
/** Pastas da sessão da Twitch de cada perfil (`persist:pokehubtw-<uuid>`): fila própria, mesmas travas. */
export const TWITCH_PREFIX = 'pokehubtw-';

export interface WipeFs {
  readFile(path: string): string;
  writeFile(path: string, data: string): void;
  rename(from: string, to: string): void;
  mkdir(path: string): void;
  readdir(path: string): string[];
  rm(path: string): void;
}
export const realFs: WipeFs = {
  readFile: path => readFileSync(path, 'utf8'),
  writeFile: (path, data) => writeFileSync(path, data),
  rename: renameSync,
  mkdir: path => { mkdirSync(path, {recursive: true}); },
  readdir: path => readdirSync(path),
  rm: path => rmSync(path, {recursive: true, force: true, maxRetries: 3, retryDelay: 100}),
};

/** Pasta da partição do perfil, garantidamente dentro de `<userData>/Partitions`. Lança para id que não é UUID ou caminho fora. */
export function partitionPath(userData: string, id: unknown, prefix: string = PREFIX): string {
  if (!isProfileId(id)) throw new Error('Identificador de perfil inválido');
  if (prefix !== PREFIX && prefix !== TWITCH_PREFIX) throw new Error('Prefixo de partição desconhecido');
  const root = resolve(userData, PARTITIONS_DIR), target = resolve(root, `${prefix}${id}`), rel = relative(root, target);
  if (!rel || rel.startsWith('..') || rel.includes(sep) || resolve(root, rel) !== target) throw new Error('Caminho fora das partições');
  return target;
}
/** Id do perfil de uma pasta `pokehub-<uuid>`; null para qualquer outro nome. */
export function profileIdOfDir(name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const id = name.slice(PREFIX.length);
  return isProfileId(id) ? id.toLowerCase() : null;
}

export function createWipeQueue(file: string, fs: WipeFs = realFs) {
  const ids = new Set<string>();
  try {
    const data: unknown = JSON.parse(fs.readFile(file));
    if (Array.isArray(data)) for (const id of data.slice(0, MAX_PENDING)) if (isProfileId(id)) ids.add(id.toLowerCase());
  } catch { /* arquivo ausente ou corrompido: fila vazia */ }
  const save = () => {
    fs.mkdir(dirname(file));
    const tmp = `${file}.tmp`;
    fs.writeFile(tmp, JSON.stringify([...ids]));
    fs.rename(tmp, file); // troca atômica: nunca fica um arquivo pela metade
  };
  return {
    /** Enfileira um id; false se não for UUID (nada é gravado) ou se a fila estourou o limite. */
    add(id: unknown): boolean {
      if (!isProfileId(id)) return false;
      const key = id.toLowerCase();
      if (ids.has(key)) return true;
      if (ids.size >= MAX_PENDING) return false;
      ids.add(key);
      try { save(); } catch { ids.delete(key); return false; }
      return true;
    },
    delete(id: string) { if (ids.delete(id)) { try { save(); } catch { /* tenta de novo na próxima mudança */ } } },
    has: (id: string) => ids.has(id.toLowerCase()),
    list: () => [...ids],
  };
}
export type WipeQueue = ReturnType<typeof createWipeQueue>;

/** Apaga as pastas da fila (chamar ANTES de criar qualquer sessão). Quem falha continua na fila para a próxima tentativa. */
export function runPendingWipes(userData: string, queue: WipeQueue, fs: WipeFs = realFs, prefix: string = PREFIX): {wiped: string[]; failed: string[]} {
  const wiped: string[] = [], failed: string[] = [];
  for (const id of queue.list()) {
    try { fs.rm(partitionPath(userData, id, prefix)); queue.delete(id); wiped.push(id); }
    catch { failed.push(id); }
  }
  return {wiped, failed};
}

/** Pastas `pokehub-<uuid>` sem perfil (e que ainda não estão na fila de apagamento). */
export function findOrphans(userData: string, known: Iterable<string>, queue: WipeQueue, fs: WipeFs = realFs): string[] {
  const live = new Set([...known].map(id => id.toLowerCase()));
  let names: string[];
  try { names = fs.readdir(join(userData, PARTITIONS_DIR)); } catch { return []; }
  const found = new Set<string>();
  for (const name of names) { const id = profileIdOfDir(name); if (id && !live.has(id) && !queue.has(id)) found.add(id); }
  return [...found];
}

/** Limpeza completa da sessão em uso (cookies e todos os armazenamentos, caches de código, autenticação HTTP e DNS). */
export interface ClearableSession {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  clearCodeCaches(options: object): Promise<void>;
  clearAuthCache(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
}
export async function clearAllSessionData(session: ClearableSession): Promise<void> {
  await session.clearStorageData(); // sem opções: todos os tipos de armazenamento (cookies, localStorage, IndexedDB, service workers, cache storage...)
  await session.clearCache();
  await session.clearCodeCaches({});
  await session.clearAuthCache();
  await session.clearHostResolverCache();
}
