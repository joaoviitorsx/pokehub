import type { MarketScan } from '../domain/market';
import { listingKey, type MarketProgress } from '../domain/market-session';
import { atGame, timed } from './hunt-snapshot';
import { ACCOUNT_BUSY, createAccountLock, type AccountLock } from './account-lock';
import { MARKET_SCAN_SCRIPT, MARKET_UNAVAILABLE, sanitizeMarketScan, type MarketTarget } from './market-scan';

/*
 * LEITURA ASSISTIDA DE TODAS AS PÁGINAS DA BUSCA.
 * O clique em "próxima página" (MARKET_NEXT_SCRIPT) é o único clique desta leitura (a Loja, em shop.ts, faz os seus, sempre após confirmação). Ele só existe para
 * o usuário não precisar virar as páginas à mão: não compra, não anuncia, não abre anúncio, não favorita e não escreve nada.
 * Limites: só com a busca preenchida, no máximo 30 páginas, um clique por vez no ritmo de uma pessoa (espera a página mudar
 * + 1,5 s), uma execução por conta, sempre interrompível, e para sozinho em qualquer anomalia.
 */
export const MARKET_MAX_PAGES = 30, CHANGE_POLL_MS = 250, CHANGE_TIMEOUT_MS = 6000, HUMAN_PAUSE_MS = 1500, LOCATE_PAUSE_MS = 700;
export const NEEDS_QUERY = 'Busque uma espécie no Mercado antes (ex.: Venusaur) — o Mercado inteiro tem centenas de páginas.';
const BUSY = 'Já existe uma leitura de páginas em andamento nesta conta.';
const CLOSED = 'O Mercado foi fechado; a leitura parou.';
const CHANGED = 'A busca mudou; a leitura parou.';
const GONE = 'A sessão desta conta ficou indisponível; a leitura parou.';
const STUCK = 'A página não mudou depois do clique; a leitura parou.';
const FAILED = 'Não foi possível ler as páginas; a leitura parou.';
const STOPPED = 'Parado.';

// Código fixo (nada vindo do renderer): aperta só o botão "›" do rodapé de paginação, e só se estiver habilitado.
export const MARKET_NEXT_SCRIPT = `(() => {
  const b = document.querySelector('#cm-paginas button.cm-pag:last-of-type');
  if (!b || b.disabled || (b.textContent || '').trim() !== '\u203a') return false;
  b.click();
  return true;
})()`;
// Só lê o texto "X de N" do rodapé (para detectar que a página trocou).
export const MARKET_PAGE_SCRIPT = `(() => { const s = document.querySelector('#cm-paginas span'); return s ? String(s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : ''; })()`;

// Página anterior: só o botão "‹" do rodapé, e só se estiver habilitado (usado ao levar o usuário até um anúncio).
export const MARKET_PREV_SCRIPT = `(() => {
  const b = Array.from(document.querySelectorAll('#cm-paginas button.cm-pag')).find((x) => (x.textContent || '').trim() === '‹');
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;
/** Rola até o card de número `index` (mesma seleção de cards da leitura) e o destaca por alguns segundos. Não clica. */
export const marketHighlightScript = (index: number) => `(() => {
  const lista = document.querySelector('#cm-lista');
  if (!lista) return false;
  const all = Array.from(lista.querySelectorAll(':scope > .cm-card'));
  const poke = all.filter((c) => c.classList.contains('poke'));
  const cards = poke.length ? poke : all.filter((c) => c.querySelector('.cm-nome-txt'));
  const c = cards[${Math.max(0, Math.floor(index))}];
  if (!c) return false;
  c.scrollIntoView({block: 'center', behavior: 'smooth'});
  const old = c.style.cssText;
  c.style.outline = '3px solid #ffcb05'; c.style.outlineOffset = '2px'; c.style.boxShadow = '0 0 0 6px rgba(255,203,5,.35), 0 0 24px rgba(255,203,5,.6)';
  c.style.transition = 'box-shadow .4s ease, outline-color .4s ease';
  setTimeout(() => { c.style.cssText = old; }, 6000);
  return true;
})()`;
export const LOCATE_MAX_CLICKS = 40;
const LOCATE_LOST = 'Não encontrei esse anúncio no Mercado: ele pode ter sido vendido ou retirado. Leia as páginas de novo.';
const LOCATE_QUERY = (q: string) => `Busque "${q}" no Mercado desta conta para ir até o anúncio.`;
export interface LocateRequest { key: string; page: number | null; query: string }

export type StartResult = {ok: true; data: undefined} | {ok: false; error: string};
export interface ReaderDeps {
  known(): readonly string[];
  target(id: string): MarketTarget | null;
  emit(progress: MarketProgress): void;
  sleep?(ms: number): Promise<void>;
  scanTimeoutMs?: number;
  lock?: AccountLock; // trava por conta compartilhada com a Loja
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const sameQuery = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createMarketReader(deps: ReaderDeps) {
  const sleep = deps.sleep ?? wait, timeout = deps.scanTimeoutMs ?? 8000, lock = deps.lock ?? createAccountLock();
  const runs = new Map<string, {stopped: boolean; finished: Promise<void>}>();
  const usable = (id: string): MarketTarget | null => { try { const t = deps.target(id); return t && atGame(t.url) ? t : null; } catch { return null; } };
  const scan = async (t: MarketTarget) => sanitizeMarketScan(await timed(t.run(MARKET_SCAN_SCRIPT), timeout));

  async function loop(id: string, state: {stopped: boolean}, first: MarketScan) {
    const seen = new Set<string>();
    let current = first, read = 1, collected = 0;
    const report = (s: MarketScan, done: boolean, error?: string) => {
      for (const l of s.listings) if (!seen.has(listingKey(l))) { seen.add(listingKey(l)); collected++; }
      deps.emit({profileId: id, page: s.page, pages: s.pages, collected, done, ...(error ? {error} : {}), scan: s});
    };
    const finish = (error?: string) => deps.emit({profileId: id, page: current.page, pages: current.pages, collected, done: true, ...(error ? {error} : {})});
    try {
      report(current, false);
      while (!state.stopped && read < MARKET_MAX_PAGES && current.page !== null && current.pages !== null && current.page < current.pages) {
        const t = usable(id);
        if (!t) return finish(GONE);
        const before = await timed(t.run(MARKET_PAGE_SCRIPT), timeout);
        if (await timed(t.run(MARKET_NEXT_SCRIPT), timeout) !== true) return finish(); // "›" desabilitado: última página
        let changed = false;
        for (let waited = 0; waited < CHANGE_TIMEOUT_MS && !state.stopped; waited += CHANGE_POLL_MS) {
          await sleep(CHANGE_POLL_MS);
          const t2 = usable(id);
          if (!t2) return finish(GONE);
          if (await timed(t2.run(MARKET_PAGE_SCRIPT), timeout) !== before) { changed = true; break; }
        }
        if (state.stopped) break;
        if (!changed) return finish(STUCK);
        await sleep(HUMAN_PAUSE_MS);
        if (state.stopped) break;
        const t3 = usable(id);
        if (!t3) return finish(GONE);
        const next = await scan(t3);
        if (!next) return finish(FAILED);
        if (!next.open) return finish(CLOSED);
        if (!sameQuery(next.query, first.query)) return finish(CHANGED);
        current = next; read++; report(next, false);
      }
      finish();
    } catch { finish(FAILED); }
  }

  /** Vira uma página (`dir` = 1 ou −1) e espera o rodapé mudar. 'end' = botão desabilitado. */
  async function turn(id: string, dir: 1 | -1, state: {stopped: boolean}): Promise<'ok' | 'end' | string> {
    const t = usable(id);
    if (!t) return GONE;
    const before = await timed(t.run(MARKET_PAGE_SCRIPT), timeout);
    if (await timed(t.run(dir > 0 ? MARKET_NEXT_SCRIPT : MARKET_PREV_SCRIPT), timeout) !== true) return 'end';
    for (let waited = 0; waited < CHANGE_TIMEOUT_MS && !state.stopped; waited += CHANGE_POLL_MS) {
      await sleep(CHANGE_POLL_MS);
      const t2 = usable(id);
      if (!t2) return GONE;
      if (await timed(t2.run(MARKET_PAGE_SCRIPT), timeout) !== before) return 'ok';
    }
    return STUCK;
  }
  /** Índice do card com a chave pedida na página atual (ou -1), junto com a leitura da página. */
  async function findHere(id: string, key: string): Promise<{index: number; scan: MarketScan} | string> {
    const t = usable(id);
    if (!t) return GONE;
    const raw = await timed(t.run(MARKET_SCAN_SCRIPT), timeout) as {cards?: unknown[]} | null;
    const scan = sanitizeMarketScan(raw);
    if (!scan) return FAILED;
    if (!scan.open) return CLOSED;
    const cards = Array.isArray(raw?.cards) ? raw.cards : [];
    const index = cards.findIndex(card => { const one = sanitizeMarketScan({open: true, pag: '', query: '', cards: [card]}); return one?.listings[0] ? listingKey(one.listings[0]) === key : false; });
    return {index, scan};
  }
  async function locateLoop(id: string, req: LocateRequest, state: {stopped: boolean}): Promise<StartResult> {
    const fail = (error: string): StartResult => ({ok: false, error});
    // páginas a visitar: a de onde o anúncio foi visto, depois as vizinhas (a vitrine anda quando algo é vendido)
    const plan = req.page !== null ? [req.page, req.page - 1, req.page + 1, req.page - 2, req.page + 2].filter(p => p >= 1) : [];
    const visited = new Set<number>();
    let clicks = 0, here = await findHere(id, req.key);
    for (;;) {
      if (typeof here === 'string') return fail(here);
      if (!sameQuery(here.scan.query, req.query)) return fail(LOCATE_QUERY(req.query));
      if (here.index >= 0) {
        const t = usable(id);
        if (!t) return fail(GONE);
        await timed(t.run(marketHighlightScript(here.index)), timeout);
        return {ok: true, data: undefined};
      }
      const {page, pages} = here.scan;
      if (page === null || pages === null) return fail(LOCATE_LOST);
      visited.add(page);
      const goal = plan.find(p => p <= pages && !visited.has(p));
      if (goal === undefined || ++clicks > LOCATE_MAX_CLICKS) return fail(LOCATE_LOST);
      if (state.stopped) return fail(STOPPED);
      const moved = await turn(id, goal > page ? 1 : -1, state);
      if (moved === 'end') { visited.add(goal); continue; }
      if (moved !== 'ok') return fail(moved);
      await sleep(LOCATE_PAUSE_MS);
      here = await findHere(id, req.key);
    }
  }

  return {
    /** Leva o Mercado da conta até a página do anúncio e o destaca (sem clicar nele). Nunca lança. */
    async locate(id: unknown, req: unknown): Promise<StartResult> {
      if (typeof id !== 'string' || !deps.known().includes(id)) return {ok: false, error: MARKET_UNAVAILABLE};
      const r = req as Partial<LocateRequest> | null;
      if (!r || typeof r.key !== 'string' || r.key.length > 300 || typeof r.query !== 'string' || r.query.length > 80 || !(r.page === null || (Number.isInteger(r.page) && r.page! >= 1 && r.page! <= 1e6))) return {ok: false, error: MARKET_UNAVAILABLE};
      if (runs.has(id)) return {ok: false, error: BUSY};
      const release = lock.acquire(id);
      if (!release) return {ok: false, error: ACCOUNT_BUSY};
      const state = {stopped: false, finished: Promise.resolve()};
      runs.set(id, state);
      let result: StartResult = {ok: false, error: FAILED};
      const work = locateLoop(id, {key: r.key, page: r.page ?? null, query: r.query}, state).then(v => { result = v; }, () => { result = {ok: false, error: FAILED}; });
      state.finished = work.finally(() => { if (runs.get(id) === state) runs.delete(id); release(); });
      await state.finished;
      return result;
    },
    /** Valida as pré-condições e inicia a leitura em segundo plano (progresso via `emit`). Nunca lança. */
    async readAll(id: unknown): Promise<StartResult> {
      if (typeof id !== 'string' || !deps.known().includes(id)) return {ok: false, error: MARKET_UNAVAILABLE};
      if (runs.has(id)) return {ok: false, error: BUSY};
      const release = lock.acquire(id);
      if (!release) return {ok: false, error: ACCOUNT_BUSY};
      const state = {stopped: false, finished: Promise.resolve()};
      runs.set(id, state); // reserva já, antes de qualquer await: duas chamadas seguidas não rodam juntas
      let first: MarketScan | null = null, error: string | null = null;
      try {
        const t = usable(id);
        first = t ? await scan(t) : null;
        if (!first || !first.open) error = MARKET_UNAVAILABLE;
        else if (!first.query) error = NEEDS_QUERY;
        else if (first.pages !== null && first.pages > MARKET_MAX_PAGES) error = `Esta busca tem ${first.pages} páginas; o limite é ${MARKET_MAX_PAGES}. Refine a busca (nome completo da espécie, por exemplo) para reduzir as páginas e tente de novo.`;
      } catch { error = MARKET_UNAVAILABLE; }
      if (error !== null || !first) { runs.delete(id); release(); return {ok: false, error: error ?? MARKET_UNAVAILABLE}; }
      state.finished = loop(id, state, first).finally(() => { if (runs.get(id) === state) runs.delete(id); release(); });
      return {ok: true, data: undefined};
    },
    /** Pede para parar; devolve true se havia uma leitura em andamento. */
    stop(id: unknown): boolean { const run = typeof id === 'string' ? runs.get(id) : undefined; if (run) run.stopped = true; return Boolean(run); },
    running: (id: string) => runs.has(id),
    /** Resolve quando a leitura da conta termina (para testes e encerramento). */
    whenDone: (id: string) => runs.get(id)?.finished ?? Promise.resolve(),
  };
}
