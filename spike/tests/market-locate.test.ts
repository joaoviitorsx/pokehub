import { describe, expect, it } from 'vitest';
import { MARKET_NEXT_SCRIPT, MARKET_PAGE_SCRIPT, MARKET_PREV_SCRIPT, createMarketReader, marketHighlightScript } from '../electron/market-read';
import { MARKET_SCAN_SCRIPT } from '../electron/market-scan';

const card = (n: number) => ({id: `c${n}`, cls: 'cm-card poke', name: 'Venusaur', sub: 'Nv 10', pot: 'P1', nota: 'N 5,0', shiny: false, preco: String(1000 + n), moeda: 'cm-preco gold Coins', smartCls: '', smartText: ''});
// página p tem os cards c(2p) e c(2p+1); `shift` desloca a vitrine (anúncios vendidos)
function game(opts: {page?: number; pages?: number; query?: string; shift?: number} = {}) {
  const g = {page: opts.page ?? 1, pages: opts.pages ?? 10, query: opts.query ?? 'Venusaur', clicks: [] as string[], highlighted: -1, pending: -1};
  const run = async (s: string): Promise<unknown> => {
    if (s === MARKET_SCAN_SCRIPT) { const b = (g.page + (opts.shift ?? 0)) * 2; return {open: true, pag: `${g.page} de ${g.pages}`, query: g.query, cards: [card(b), card(b + 1)]}; }
    if (s === MARKET_PAGE_SCRIPT) { if (g.pending > 0) { g.page = g.pending; g.pending = -1; } return `${g.page} de ${g.pages}`; }
    if (s === MARKET_NEXT_SCRIPT) { if (g.page >= g.pages) return false; g.clicks.push('›'); g.pending = g.page + 1; return true; }
    if (s === MARKET_PREV_SCRIPT) { if (g.page <= 1) return false; g.clicks.push('‹'); g.pending = g.page - 1; return true; }
    const m = /cards\[(\d+)\]/.exec(s);
    if (m) { g.highlighted = Number(m[1]); return true; }
    throw new Error('script inesperado');
  };
  const reader = createMarketReader({known: () => ['a'], emit: () => undefined, sleep: async () => undefined, target: () => ({url: 'https://pokeidle.io/app', run})});
  return {g, reader};
}

describe('ir ao anúncio', () => {
  it('já na página: só destaca, sem virar página', async () => {
    const {g, reader} = game({page: 3});
    expect(await reader.locate('a', {key: 'id:c7', page: 3, query: 'venusaur'})).toEqual({ok: true, data: undefined});
    expect([g.clicks, g.highlighted]).toEqual([[], 1]);
  });
  it('vira até a página onde foi visto (para frente e para trás)', async () => {
    const a = game({page: 1});
    expect((await a.reader.locate('a', {key: 'id:c8', page: 4, query: 'Venusaur'})).ok).toBe(true);
    expect([a.g.clicks, a.g.page, a.g.highlighted]).toEqual([['›', '›', '›'], 4, 0]);
    const b = game({page: 9});
    expect((await b.reader.locate('a', {key: 'id:c5', page: 2, query: 'Venusaur'})).ok).toBe(true);
    expect(b.g.page).toBe(2);
    expect(b.g.clicks.every(c => c === '‹')).toBe(true);
  });
  it('a vitrine andou uma página: procura nas vizinhas', async () => {
    const {g, reader} = game({page: 1, shift: 1}); // c8 agora está na página 3
    expect((await reader.locate('a', {key: 'id:c8', page: 4, query: 'Venusaur'})).ok).toBe(true);
    expect(g.page).toBe(3);
  });
  it('sumiu (vendido): avisa sem andar para sempre', async () => {
    const {g, reader} = game({page: 1});
    const r = await reader.locate('a', {key: 'id:zzz', page: 5, query: 'Venusaur'});
    expect(r.ok).toBe(false);
    expect(g.clicks.length).toBeLessThanOrEqual(12);
  });
  it('busca diferente, entrada inválida e conta desconhecida', async () => {
    const {g, reader} = game({query: 'Charizard'});
    expect(await reader.locate('a', {key: 'id:c2', page: 1, query: 'Venusaur'})).toEqual({ok: false, error: expect.stringContaining('Venusaur')});
    expect(g.clicks).toEqual([]);
    expect((await reader.locate('x', {key: 'id:c2', page: 1, query: 'Venusaur'})).ok).toBe(false);
    expect((await reader.locate('a', {key: 1, page: 1, query: 'Venusaur'})).ok).toBe(false);
    expect((await reader.locate('a', {key: 'id:c2', page: 0, query: 'Venusaur'})).ok).toBe(false);
  });
  it('scripts: "‹" só no rodapé; destaque não clica', () => {
    expect(MARKET_PREV_SCRIPT.match(/\.click\(/g)).toHaveLength(1);
    expect(MARKET_PREV_SCRIPT).toContain("'#cm-paginas button.cm-pag'");
    let clicks = 0;
    const doc = (buttons: {textContent: string; disabled: boolean}[]) => ({querySelectorAll: () => buttons.map(b => ({...b, click: () => { clicks++; }}))});
    const exec = (buttons: {textContent: string; disabled: boolean}[]) => new Function('document', `return ${MARKET_PREV_SCRIPT}`)(doc(buttons));
    expect(exec([{textContent: ' ‹ ', disabled: false}, {textContent: '›', disabled: false}])).toBe(true);
    expect(exec([{textContent: '‹', disabled: true}])).toBe(false);
    expect(exec([{textContent: '›', disabled: false}])).toBe(false);
    expect(clicks).toBe(1);
    const hl = marketHighlightScript(2);
    expect(hl).not.toMatch(/\.click\(|dispatchEvent|fetch\(|innerHTML|cm-fav/);
    expect(() => new Function(`return ${hl}`)).not.toThrow();
    expect(marketHighlightScript(-5)).toContain('cards[0]');
  });
});
