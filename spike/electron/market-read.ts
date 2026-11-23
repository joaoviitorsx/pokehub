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
export const MARKET_MAX_PAGES = 30, CHANGE_POLL_MS = 250, CHANGE_TIMEOUT_MS = 6000, HUMAN_PAUSE_MS = 1500;
export const NEEDS_QUERY = 'Busque uma espécie no Mercado antes (ex.: Venusaur) — o Mercado inteiro tem centenas de páginas.';
const BUSY = 'Já existe uma leitura de páginas em andamento nesta conta.';
const CLOSED = 'O Mercado foi fechado; a leitura parou.';
const CHANGED = 'A busca mudou; a leitura parou.';
const GONE = 'A sessão desta conta ficou indisponível; a leitura parou.';
const STUCK = 'A página não mudou depois do clique; a leitura parou.';
const FAILED = 'Não foi possível ler as páginas; a leitura parou.';

// Código fixo (nada vindo do renderer): aperta só o botão "›" do rodapé de paginação, e só se estiver habilitado.
export const MARKET_NEXT_SCRIPT = `(() => {
  const b = document.querySelector('#cm-paginas button.cm-pag:last-of-type');
  if (!b || b.disabled || (b.textContent || '').trim() !== '\u203a') return false;
  b.click();
  return true;
})()`;
// Só lê o texto "X de N" do rodapé (para detectar que a página trocou).
export const MARKET_PAGE_SCRIPT = `(() => { const s = document.querySelector('#cm-paginas span'); return s ? String(s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : ''; })()`;

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

  return {
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
