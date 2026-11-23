import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { alertsOf, captureKey, diffNew, parseCapture, type Capture, type RawCapture } from '../domain/captures';
import { atGame, isRecord, timed } from './hunt-snapshot';

const MAX_ROWS = 50, MAX_STR = 120, POLL_MS = 30_000, POLL_LITE_MS = 60_000, READ_MS = 8000;
export const CAPTURES_RETENTION_MS = 7 * 86_400_000, CAPTURES_MAX = 5000, PER_ACCOUNT_MAX = 1000, PERSIST_MS = 5000;

// Código fixo executado na página do jogo: nunca recebe dado do renderer. Só LÊ o painel esquerdo "CAPTURAS" (nenhum clique, escrita,
// rede, cookie ou storage). Seletores conferidos no jogo em 2026-11-23 (v1.474). Lê as linhas na ordem em que estão, qualquer que seja a aba.
export const CAPTURES_SCRIPT = `(() => {
  const S = (v) => String(v == null ? '' : v).replace(/\\s+/g, ' ').trim().slice(0, ${MAX_STR});
  const lista = document.querySelector('.capturas-corpo .capturas-linhas');
  if (!lista) return {open:false, rows:[]};
  const cn = (e) => (e && typeof e.className === 'string' ? e.className : '');
  const t = (r, sel) => { const e = r.querySelector(sel); return e ? S(e.textContent) : ''; };
  return {open:true, rows: Array.from(lista.querySelectorAll('.capturas-linha')).slice(0, ${MAX_ROWS}).map((r) => {
    const pot = r.querySelector('.cm-pot');
    return {name:t(r, '.cap-nome'), nv:t(r, '.cap-nv'), hora:t(r, '.cap-hora'), pot:pot ? S(pot.textContent) : '', potCls:S(cn(pot)), iv:t(r, '.pk-selo-iv'), q:t(r, '.pk-selo-q'), n:t(r, '.pk-selo-n'), badge:t(r, '.cap-novo'), cls:S(cn(r)), txt:S(r.textContent)};
  })};
})()`;

const str = (value: unknown): string => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, MAX_STR) : '';
/** Retorno bruto da página (remota, não confiável) → capturas válidas; linhas malformadas são descartadas. null = formato inesperado. */
export function sanitizeCaptures(raw: unknown, profileId: string, now = new Date()): {open: boolean; captures: Capture[]} | null {
  if (!isRecord(raw) || typeof raw.open !== 'boolean') return null;
  if (!raw.open) return {open: false, captures: []};
  if (!Array.isArray(raw.rows)) return null;
  const captures = raw.rows.slice(0, MAX_ROWS).flatMap((row): Capture[] => {
    if (!isRecord(row)) return [];
    const r: RawCapture = {name: str(row.name), nv: str(row.nv), hora: str(row.hora), pot: str(row.pot), potCls: str(row.potCls), iv: str(row.iv), q: str(row.q), n: str(row.n), badge: str(row.badge), cls: str(row.cls), txt: str(row.txt)};
    const c = parseCapture(r, profileId, now);
    return c ? [c] : [];
  });
  return {open: true, captures};
}

/** Valida uma captura vinda do captures.json (arquivo editável pelo usuário). */
function revive(value: unknown, known: ReadonlySet<string>): Capture | null {
  if (!isRecord(value)) return null;
  const { profileId, name, level, time, at, potencia, iv, quality, nota, shiny, record, hints } = value;
  const n = (v: unknown, max: number) => v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
  if (typeof profileId !== 'string' || !known.has(profileId) || typeof name !== 'string' || !name || name.length > 40 || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  const lv = n(level, 1e6), pot = n(potencia, 5), v1 = n(iv, 1e4), q = n(quality, 1e9), nt = n(nota, 1e9);
  if ([lv, pot, v1, q, nt].includes(undefined) || typeof shiny !== 'boolean' || typeof record !== 'boolean' || !Array.isArray(hints)) return null;
  return {profileId, name, level: lv as number | null, time, at: new Date(at).toISOString(), potencia: pot as number | null, iv: v1 as number | null, quality: q as number | null, nota: nt as number | null, shiny, record, hints: hints.filter((h): h is string => typeof h === 'string' && /^[\p{L}\d -]{1,24}$/u.test(h)).slice(0, 9)};
}

export interface CaptureQuery { profileId?: string; onlyAlerts?: boolean; limit?: number; notaMin?: number | null }
export interface CaptureLogDeps { file?: string | null; known: () => readonly string[]; now?: () => Date }
const byRecent = (a: Capture, b: Capture) => Date.parse(b.at) - Date.parse(a.at);
/** Registro em memória (limitado) com persistência opcional em JSON: últimos 7 dias, no máx. 5.000 entradas, gravação com atraso e atômica. */
export function createCaptureLog(deps: CaptureLogDeps) {
  const now = deps.now ?? (() => new Date());
  const accounts = new Map<string, Capture[]>(); // mais novas primeiro
  const keys = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined, dirty = false;
  const keysOf = (id: string) => { let k = keys.get(id); if (!k) keys.set(id, k = new Set()); return k; };
  const set = (id: string, list: Capture[]) => { accounts.set(id, list); keys.set(id, new Set(list.map(captureKey))); };
  const trim = () => {
    const cutoff = now().getTime() - CAPTURES_RETENTION_MS;
    for (const [id, list] of accounts) { const kept = list.filter(c => Date.parse(c.at) >= cutoff).slice(0, PER_ACCOUNT_MAX); if (kept.length !== list.length) set(id, kept); }
    const all = [...accounts.values()].flat();
    if (all.length > CAPTURES_MAX) {
      const drop = new Set(all.sort(byRecent).slice(CAPTURES_MAX));
      for (const [id, list] of accounts) set(id, list.filter(c => !drop.has(c)));
    }
  };
  const save = () => {
    clearTimeout(timer); timer = undefined;
    if (!deps.file || !dirty) return;
    dirty = false;
    try {
      trim();
      mkdirSync(dirname(deps.file), {recursive: true});
      const tmp = `${deps.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({v: 1, items: [...accounts.values()].flat()}));
      renameSync(tmp, deps.file); // troca atômica: nunca fica um arquivo pela metade
    } catch { /* sem disco: o registro em memória continua valendo */ }
  };
  const touch = () => { dirty = true; if (deps.file && !timer) { timer = setTimeout(save, PERSIST_MS); timer.unref?.(); } };
  if (deps.file) {
    try {
      const data: unknown = JSON.parse(readFileSync(deps.file, 'utf8')), ids = new Set(deps.known());
      if (isRecord(data) && Array.isArray(data.items)) {
        for (const item of data.items.slice(0, CAPTURES_MAX * 2)) {
          const c = revive(item, ids);
          if (c && !keysOf(c.profileId).has(captureKey(c))) { keysOf(c.profileId).add(captureKey(c)); const list = accounts.get(c.profileId) ?? []; list.push(c); accounts.set(c.profileId, list); }
        }
        for (const list of accounts.values()) list.sort(byRecent);
        trim();
      }
    } catch { /* arquivo ausente ou corrompido: começa vazio */ }
  }
  return {
    /** Registra o que ainda não existe e devolve só as novas (a mais recente primeiro). */
    add(profileId: string, captures: readonly Capture[]): Capture[] {
      const fresh = diffNew(keysOf(profileId), captures).sort(byRecent);
      if (!fresh.length) return [];
      set(profileId, [...fresh, ...(accounts.get(profileId) ?? [])].sort(byRecent).slice(0, PER_ACCOUNT_MAX));
      touch();
      return fresh;
    },
    list(query: CaptureQuery = {}): Capture[] {
      const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 100))), ids = new Set(deps.known());
      const source = query.profileId ? [accounts.get(query.profileId) ?? []] : [...accounts.values()];
      return source.flat().filter(c => ids.has(c.profileId) && (!query.onlyAlerts || alertsOf(c, {notaMin: query.notaMin}).length > 0)).sort(byRecent).slice(0, limit);
    },
    clear() { accounts.clear(); keys.clear(); dirty = true; save(); },
    flush: save,
    size: () => [...accounts.values()].reduce((n, l) => n + l.length, 0),
  };
}
export type CaptureLog = ReturnType<typeof createCaptureLog>;

/** Valida os argumentos de `captures:list` vindos do renderer; null = recusado. */
export function parseQuery(value: unknown, known: readonly string[]): CaptureQuery | null {
  const v = value === undefined || value === null ? {} : value;
  if (!isRecord(v)) return null;
  const q: CaptureQuery = {};
  if (v.profileId !== undefined && v.profileId !== null) { if (typeof v.profileId !== 'string' || !known.includes(v.profileId)) return null; q.profileId = v.profileId; }
  if (v.onlyAlerts !== undefined) { if (typeof v.onlyAlerts !== 'boolean') return null; q.onlyAlerts = v.onlyAlerts; }
  if (v.limit !== undefined) { if (typeof v.limit !== 'number' || !Number.isInteger(v.limit) || v.limit < 1 || v.limit > 500) return null; q.limit = v.limit; }
  if (v.notaMin !== undefined && v.notaMin !== null) { if (typeof v.notaMin !== 'number' || !Number.isFinite(v.notaMin) || v.notaMin < 0 || v.notaMin > 1e9) return null; q.notaMin = v.notaMin; }
  return q;
}

export interface CaptureTarget { url: string; run(script: string): Promise<unknown> }
export interface CaptureEvent { captures: Capture[] }
export interface CaptureWatcherDeps {
  known: () => readonly string[];
  target: (profileId: string) => CaptureTarget | null;   // readable(): null se a sessão não está utilizável
  suspended?: (profileId: string) => boolean;
  lite?: () => boolean;
  log: CaptureLog;
  onEvent?: (event: CaptureEvent) => void;   // destino do desktop: recebe eventos mas NÃO conta como "alguém precisa"
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
}
/**
 * Lê as capturas de cada conta (30 s; 60 s no Modo leve) SÓ enquanto alguém precisa: o painel do desktop aberto (`setDesktop`)
 * ou algum assinante (`subscribe`, ex.: o servidor remoto). A primeira leitura de cada conta é só base (histórico, sem evento).
 */
export function createCaptureWatcher(deps: CaptureWatcherDeps) {
  const now = deps.now ?? (() => new Date()), setT = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)), clearT = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const subs = new Set<(event: CaptureEvent) => void>(), primed = new Set<string>();
  let desktop = false, timer: unknown = null, running = false, generation = 0;
  const needed = () => desktop || subs.size > 0;
  const emit = (event: CaptureEvent) => { try { deps.onEvent?.(event); } catch { /* idem */ } for (const fn of [...subs]) { try { fn(event); } catch { /* assinante com defeito não derruba os outros */ } } };
  async function readOne(id: string): Promise<Capture[]> {
    try {
      const target = deps.target(id);
      if (!target || !atGame(target.url)) return [];
      const read = sanitizeCaptures(await timed(target.run(CAPTURES_SCRIPT), READ_MS), id, now());
      if (!read || !read.open) return []; // painel do jogo ausente: não conta como base
      const fresh = deps.log.add(id, read.captures);
      if (!primed.has(id)) { primed.add(id); return []; }
      return fresh;
    } catch { return []; }
  }
  async function tick() {
    if (running) return;
    running = true;
    const mine = generation;
    try {
      const fresh: Capture[] = [];
      for (const id of deps.known()) {
        if (!needed() || mine !== generation) break;
        if (deps.suspended?.(id)) continue;
        fresh.push(...await readOne(id));
      }
      if (fresh.length && mine === generation) emit({captures: fresh.sort(byRecent)});
    } finally { running = false; }
  }
  function schedule() {
    if (timer !== null || !needed()) return;
    timer = setT(() => { timer = null; void tick().finally(schedule); }, deps.lite?.() ? POLL_LITE_MS : POLL_MS);
  }
  function update() {
    if (needed()) { if (timer === null && !running) void tick().finally(schedule); }
    else { generation++; if (timer !== null) clearT(timer); timer = null; }
  }
  const api = {
    subscribe(fn: (event: CaptureEvent) => void): () => void { subs.add(fn); update(); return () => api.unsubscribe(fn); },
    unsubscribe(fn: (event: CaptureEvent) => void) { subs.delete(fn); update(); },
    /** Painel "Capturas" do desktop aberto/fechado. */
    setDesktop(open: boolean) { if (desktop === open) return; desktop = open; update(); },
    stop() { desktop = false; subs.clear(); update(); },
    tick,
    active: needed,
  };
  return api;
}
export type CaptureWatcher = ReturnType<typeof createCaptureWatcher>;

/** Atalho usado pelo processo principal (e, depois, pelo servidor remoto): registro + leitor juntos. */
export function createCaptureService(deps: Omit<CaptureWatcherDeps, 'log'> & {file?: string | null}) {
  const log = createCaptureLog({file: deps.file, known: deps.known, now: deps.now});
  const watcher = createCaptureWatcher({...deps, log});
  return {log, watcher, list: log.list, clear: log.clear, subscribe: watcher.subscribe, unsubscribe: watcher.unsubscribe, setDesktop: watcher.setDesktop, stop: () => { watcher.stop(); log.flush(); }};
}
export type CaptureService = ReturnType<typeof createCaptureService>;
