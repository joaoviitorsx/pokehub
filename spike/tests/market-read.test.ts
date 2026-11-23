import { describe, expect, it } from 'vitest';
import { MARKET_MAX_PAGES, MARKET_NEXT_SCRIPT, MARKET_PAGE_SCRIPT, NEEDS_QUERY, createMarketReader } from '../electron/market-read';
import { MARKET_SCAN_SCRIPT, MARKET_UNAVAILABLE } from '../electron/market-scan';
import type { MarketProgress } from '../domain/market-session';

const card = (n: number) => ({id: `c${n}`, cls: 'cm-card poke', name: 'Venusaur', sub: 'Nv 10', pot: 'P1', nota: 'N 5,0', shiny: false, preco: String(1000 + n), moeda: 'cm-preco gold Coins', smartCls: '', smartText: ''});
// Jogo falso: `pages` páginas de 2 cards; o clique em "›" troca a página depois de `lag` leituras do rodapé.
function fakeGame(opts: {pages?: number; page?: number; query?: string; lag?: number; frozen?: boolean; closeAt?: number; queryChangeAt?: number} = {}) {
  const g = {page: opts.page ?? 1, pages: opts.pages ?? 3, query: opts.query ?? 'Venusaur', clicks: 0, open: true, scripts: [] as string[], pending: -1, url: 'https://pokeidle.io/app'};
  let lag = 0;
  const game = {g, run: async (script: string): Promise<unknown> => {
    g.scripts.push(script);
    if (script === MARKET_SCAN_SCRIPT) return g.open ? {open: true, pag: `${g.page} de ${g.pages}`, query: g.query, cards: [card(g.page * 2), card(g.page * 2 + 1)]} : {open: false, cards: []};
    if (script === MARKET_PAGE_SCRIPT) {
      if (g.pending >= 0 && lag-- <= 0 && !opts.frozen) { g.page = g.pending; g.pending = -1; if (g.page === opts.closeAt) g.open = false; if (g.page === opts.queryChangeAt) g.query = 'outra'; }
      return `${g.page} de ${g.pages}`;
    }
    if (script === MARKET_NEXT_SCRIPT) { if (g.page >= g.pages) return false; g.clicks++; g.pending = g.page + 1; lag = opts.lag ?? 0; return true; }
    throw new Error('script inesperado');
  }};
  return game;
}
function setup(game: ReturnType<typeof fakeGame>, extra: {known?: string[]; usable?: () => boolean} = {}) {
  const events: MarketProgress[] = [], sleeps: number[] = [];
  const reader = createMarketReader({known: () => extra.known ?? ['a', 'b'], emit: p => events.push(p), sleep: async ms => { sleeps.push(ms); },
    target: () => (extra.usable?.() ?? true) ? {url: game.g.url, run: s => game.run(s)} : null});
  return {reader, events, sleeps};
}

describe('scripts da leitura assistida', () => {
  it('só apertam "›" do rodapé de paginação; nada além disso', () => {
    expect(MARKET_NEXT_SCRIPT.match(/\.click\(/g)).toHaveLength(1);
    expect(MARKET_NEXT_SCRIPT).toContain('#cm-paginas button.cm-pag:last-of-type');
    expect(MARKET_NEXT_SCRIPT).toContain('disabled');
    expect(MARKET_NEXT_SCRIPT).not.toMatch(/dispatchEvent|fetch\(|XMLHttpRequest|cookie|Storage|\.value\s*=|innerHTML|cm-fav|cm-card|comprar/i);
    // os scripts rodam de verdade contra um DOM mínimo (pega escapes errados no template)
    const dom = (button: {disabled: boolean; textContent: string}) => ({querySelector: (sel: string) => sel === '#cm-paginas span' ? {textContent: ' 3   de\n 7 '} : sel === '#cm-paginas button.cm-pag:last-of-type' ? {...button, click: () => { clicks++; }} : null});
    let clicks = 0;
    const exec = (script: string, button = {disabled: false, textContent: '›'}) => new Function('document', `return ${script}`)(dom(button));
    expect(exec(MARKET_PAGE_SCRIPT)).toBe('3 de 7');
    expect(exec(MARKET_NEXT_SCRIPT)).toBe(true);
    expect(clicks).toBe(1);
    expect(exec(MARKET_NEXT_SCRIPT, {disabled: true, textContent: '›'})).toBe(false);
    expect(exec(MARKET_NEXT_SCRIPT, {disabled: false, textContent: '‹'})).toBe(false);
    expect(clicks).toBe(1);
    expect(MARKET_PAGE_SCRIPT).not.toMatch(/\.click\(|dispatchEvent|fetch\(|\.value\s*=/);
  });
});

describe('leitura de todas as páginas', () => {
  it('lê da página 1 até a última e avisa o fim', async () => {
    const game = fakeGame({pages: 3, lag: 2}), {reader, events, sleeps} = setup(game);
    expect(await reader.readAll('a')).toEqual({ok: true, data: undefined});
    await reader.whenDone('a');
    expect(game.g.clicks).toBe(2);
    expect(events.map(e => [e.page, e.pages, e.collected, e.done])).toEqual([[1, 3, 2, false], [2, 3, 4, false], [3, 3, 6, false], [3, 3, 6, true]]);
    expect(events.every(e => e.profileId === 'a' && !e.error)).toBe(true);
    expect(events[1]!.scan!.listings.map(l => l.id)).toEqual(['c4', 'c5']);
    expect(events.at(-1)!.scan).toBeUndefined();
    expect(sleeps.filter(ms => ms === 1500)).toHaveLength(2); // pausa humana depois de cada troca
    expect(sleeps.filter(ms => ms === 250).length).toBeGreaterThanOrEqual(2); // espera a troca sem martelar a página
    expect(reader.running('a')).toBe(false);
  });
  it('começando no meio, lê só do ponto atual até o fim', async () => {
    const game = fakeGame({pages: 4, page: 3}), {reader, events} = setup(game);
    await reader.readAll('a'); await reader.whenDone('a');
    expect(events.filter(e => !e.done).map(e => e.page)).toEqual([3, 4]);
    expect(game.g.clicks).toBe(1);
  });
  it('um clique por troca e só os três scripts fixos', async () => {
    const game = fakeGame({pages: 2}), {reader} = setup(game);
    await reader.readAll('a'); await reader.whenDone('a');
    expect(game.g.clicks).toBe(1);
    expect(new Set(game.g.scripts)).toEqual(new Set([MARKET_SCAN_SCRIPT, MARKET_PAGE_SCRIPT, MARKET_NEXT_SCRIPT]));
  });
  it('para quando o botão "›" está desabilitado (o script devolve false)', async () => {
    const game = fakeGame({pages: 5}), run = game.run;
    game.run = async s => s === MARKET_NEXT_SCRIPT ? false : run(s);
    const {reader, events} = setup(game);
    await reader.readAll('a'); await reader.whenDone('a');
    expect(events.at(-1)).toMatchObject({done: true, page: 1});
    expect(events.at(-1)!.error).toBeUndefined();
  });
  it('uma página só: lê e termina sem clicar', async () => {
    const game = fakeGame({pages: 1}), {reader, events} = setup(game);
    await reader.readAll('a'); await reader.whenDone('a');
    expect(game.g.clicks).toBe(0);
    expect(events).toHaveLength(2);
  });
  it('recusa sem busca, com mais de 30 páginas, sem Mercado e sem sessão — sem clicar', async () => {
    const noQuery = fakeGame({query: ''}), a = setup(noQuery);
    expect(await a.reader.readAll('a')).toEqual({ok: false, error: NEEDS_QUERY});
    expect(NEEDS_QUERY).toBe('Busque uma espécie no Mercado antes (ex.: Venusaur) — o Mercado inteiro tem centenas de páginas.');
    const big = fakeGame({pages: MARKET_MAX_PAGES + 1}), r = await setup(big).reader.readAll('a');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/31 páginas.*limite é 30/);
    const edge = setup(fakeGame({pages: 30}));
    expect((await edge.reader.readAll('a')).ok).toBe(true);
    await edge.reader.whenDone('a');
    const closed = fakeGame(); closed.g.open = false;
    expect(await setup(closed).reader.readAll('a')).toEqual({ok: false, error: MARKET_UNAVAILABLE});
    expect(await setup(fakeGame(), {usable: () => false}).reader.readAll('a')).toEqual({ok: false, error: MARKET_UNAVAILABLE});
    for (const id of ['x', 5, null]) expect(await setup(fakeGame()).reader.readAll(id)).toEqual({ok: false, error: MARKET_UNAVAILABLE});
    const other = fakeGame(); other.g.url = 'https://accounts.google.com/';
    expect(await setup(other).reader.readAll('a')).toEqual({ok: false, error: MARKET_UNAVAILABLE});
    expect([noQuery, big, closed, other].every(x => x.g.clicks === 0)).toBe(true);
    expect(a.reader.running('a')).toBe(false);
  });
  it('parar() interrompe antes do próximo clique e libera a conta', async () => {
    const game = fakeGame({pages: 10}), events: MarketProgress[] = [];
    const reader = createMarketReader({known: () => ['a'], emit: p => events.push(p), target: () => ({url: game.g.url, run: s => game.run(s)}),
      sleep: async ms => { if (ms === 1500) reader.stop('a'); }});
    await reader.readAll('a'); await reader.whenDone('a');
    expect(game.g.clicks).toBe(1);
    expect(events.at(-1)).toMatchObject({done: true});
    expect(events.at(-1)!.error).toBeUndefined();
    expect(reader.running('a')).toBe(false);
    expect(reader.stop('a')).toBe(false);
    expect(reader.stop(7)).toBe(false);
  });
  it('uma leitura por conta; outra conta pode ler', async () => {
    const game = fakeGame({pages: 3}), {reader} = setup(game);
    const [one, two, other] = await Promise.all([reader.readAll('a'), reader.readAll('a'), reader.readAll('b')]);
    expect([one.ok, two.ok, other.ok]).toEqual([true, false, true]);
    expect(!two.ok && two.error).toMatch(/em andamento/);
    await Promise.all([reader.whenDone('a'), reader.whenDone('b')]);
    expect((await reader.readAll('a')).ok).toBe(true); // liberada ao terminar
    await reader.whenDone('a');
  });
  it('erros param a leitura com mensagem em pt-BR', async () => {
    const last = async (game: ReturnType<typeof fakeGame>, extra: Parameters<typeof setup>[1] = {}) => {
      const s = setup(game, extra); await s.reader.readAll('a'); await s.reader.whenDone('a');
      expect(s.reader.running('a')).toBe(false);
      return s.events;
    };
    const stuck = fakeGame({frozen: true});
    expect((await last(stuck)).at(-1)).toMatchObject({done: true, error: expect.stringMatching(/não mudou/)});
    expect(stuck.g.clicks).toBe(1);
    expect((await last(fakeGame({pages: 5, closeAt: 2}))).at(-1)).toMatchObject({done: true, error: expect.stringMatching(/fechado/)});
    expect((await last(fakeGame({pages: 5, queryChangeAt: 2}))).at(-1)).toMatchObject({done: true, error: expect.stringMatching(/busca mudou/)});
    let calls = 0;
    expect((await last(fakeGame({pages: 5}), {usable: () => ++calls <= 2})).at(-1)).toMatchObject({done: true, error: expect.stringMatching(/indisponível/)});
    const boom = fakeGame({pages: 5}), run = boom.run; let n = 0;
    boom.run = async s => { if (s !== MARKET_SCAN_SCRIPT || ++n < 2) return run(s); throw new Error('segredo'); };
    const events = await last(boom);
    expect(events.at(-1)).toMatchObject({done: true, error: expect.stringMatching(/Não foi possível ler/)});
    expect(JSON.stringify(events)).not.toContain('segredo');
  });
  it('lê no máximo 30 páginas por execução', async () => {
    const game = fakeGame({pages: 30}), {reader, events} = setup(game);
    await reader.readAll('a'); await reader.whenDone('a');
    expect(events.filter(e => !e.done)).toHaveLength(30);
    expect(game.g.clicks).toBe(29);
  });
});
