import { describe, expect, it } from 'vitest';
import { parsePtNumber, rankDeals, type MarketListing } from '../domain/market';
import { MARKET_SCAN_SCRIPT, MARKET_UNAVAILABLE, marketScan, sanitizeMarketScan } from '../electron/market-scan';

const L = (patch: Partial<MarketListing> = {}): MarketListing => ({id: 'a', name: 'Pikachu', level: 50, potencia: 3, nota: 5, shiny: false, price: 1000, currency: 'gold', smart: null, ...patch});
const base = {focus: 'equilibrado'} as const;

describe('parsePtNumber', () => {
  it('lê formatos pt-BR', () => {
    expect(parsePtNumber('1,5 M')).toBe(1.5e6);
    expect(parsePtNumber('12.345')).toBe(12345);
    expect(parsePtNumber('7,600')).toBe(7.6);
    expect(parsePtNumber('350k')).toBe(350000);
    expect(parsePtNumber('1.234,56')).toBe(1234.56);
    expect(parsePtNumber('1.5')).toBe(1.5);
    expect(parsePtNumber('2B')).toBe(2e9);
    expect(parsePtNumber('42')).toBe(42);
  });
  it('recusa lixo', () => {
    for (const v of ['', 'abc', '1.2.3,4x', null, undefined, 5, '--1', '1,5 X']) expect(parsePtNumber(v)).toBeNull();
  });
});

describe('rankDeals', () => {
  it('lista vazia e item único não geram NaN', () => {
    expect(rankDeals([], base)).toEqual([]);
    const [one] = rankDeals([L({level: null, potencia: null, nota: null})], base);
    expect(Number.isFinite(one!.score)).toBe(true);
    expect(one!.reasons.join(' ')).toMatch(/Poucos anúncios/);
  });
  it('prefere mais qualidade pelo mesmo preço e barato pela mesma qualidade', () => {
    const r = rankDeals([L({id: 'x', nota: 4}), L({id: 'y', nota: 9}), L({id: 'z', nota: 9, price: 500}), L({id: 'w', nota: 6})], base);
    expect(r.map(d => d.listing.id)).toEqual(['z', 'y', 'w', 'x']);
    expect(r[0]!.score).toBeLessThanOrEqual(100);
  });
  it('não mistura moedas', () => {
    const r = rankDeals([L({id: 'g', price: 100}), L({id: 'o', currency: 'orb', price: 5e6}), L({id: 'n', currency: null})], base);
    expect(r).toHaveLength(3);
    expect(rankDeals(r.map(d => d.listing), {...base, currency: 'orb'}).map(d => d.listing.id)).toEqual(['o']);
    // preço enorme em outra moeda não distorce o grupo de gold
    const gold = rankDeals([L({id: 'g1'}), L({id: 'g2', price: 900})], base);
    const mixed = rankDeals([L({id: 'g1'}), L({id: 'g2', price: 900}), L({id: 'o', currency: 'orb', price: 9e9})], base).filter(d => d.listing.currency === 'gold');
    expect(mixed.map(d => d.score)).toEqual(gold.map(d => d.score));
  });
  it('desconto da Smart Market domina em foco "desconto" e qualidade em "qualidade"', () => {
    const items = [L({id: 'barato', nota: 3, smart: {label: 'desconto', pct: -40, market: 1666}}), L({id: 'bom', nota: 9.5, potencia: 5, smart: {label: 'acima', pct: 20, market: 833}})];
    expect(rankDeals(items, {focus: 'desconto'})[0]!.listing.id).toBe('barato');
    expect(rankDeals(items, {focus: 'qualidade'})[0]!.listing.id).toBe('bom');
  });
  it('explica as razões em pt-BR sem exagerar', () => {
    const items = [L({id: '1', nota: 8.4, potencia: 5, shiny: true, price: 400, smart: {label: 'desconto', pct: -18, market: 500}}), ...[1, 2, 3, 4, 5].map(i => L({id: `m${i}`, nota: 4 + i / 10}))];
    const top = rankDeals(items, base)[0]!;
    expect(top.listing.id).toBe('1');
    expect(top.reasons).toContain('18% abaixo do mercado (Smart Market)');
    expect(top.reasons).toContain('Nota 8,4 — top 10% desta vitrine');
    expect(top.reasons).toContain('P5');
    expect(top.reasons).toContain('Shiny');
    expect(top.reasons.some(r => /Preço por ponto de Nota \d+% menor que a mediana/.test(r))).toBe(true);
  });
  it('filtros e determinismo', () => {
    const items = [L({id: 'a', nota: 8, potencia: 5, shiny: true}), L({id: 'b', nota: 2, potencia: 1, level: 5}), L({id: 'c', nota: null, potencia: null})];
    expect(rankDeals(items, {...base, minNota: 5}).map(d => d.listing.id)).toEqual(['a']);
    expect(rankDeals(items, {...base, minPotencia: 3}).map(d => d.listing.id)).toEqual(['a']);
    expect(rankDeals(items, {...base, minLevel: 20}).map(d => d.listing.id).sort()).toEqual(['a', 'c']);
    expect(rankDeals(items, {...base, shinyOnly: true}).map(d => d.listing.id)).toEqual(['a']);
    expect(rankDeals(items, base)).toEqual(rankDeals([...items], base));
    expect(rankDeals([L({price: 0}), L({price: NaN})], base)).toEqual([]);
  });
});

const card = {id: 'f1', cls: 'cm-card poke', name: 'Charizard', sub: 'Nv 100', pot: 'P3', nota: '7,600', shiny: false, preco: '1,5 M', moeda: 'cm-preco orb', smartCls: 'pp-vit pp-vit-pechincha', smartText: '−18% mercado 1,8 M · faixa 1,6M–2M'};
describe('sanitizeMarketScan', () => {
  it('converte um card completo', () => {
    expect(sanitizeMarketScan({open: true, cards: [card]})).toEqual({open: true, smart: true, listings: [{id: 'f1', name: 'Charizard', level: 100, potencia: 3, nota: 7.6, shiny: false, price: 1.5e6, currency: 'orb', smart: {label: 'desconto', pct: -18, market: 1.8e6}}]});
  });
  it('Smart Market: sinais e rótulos', () => {
    const one = (patch: object) => sanitizeMarketScan({open: true, cards: [{...card, ...patch}]})!.listings[0]!.smart;
    expect(one({smartCls: 'pp-vit pp-vit-caro', smartText: '+12% mercado 900'})).toEqual({label: 'acima', pct: 12, market: 900});
    expect(one({smartCls: 'pp-vit pp-vit-justo', smartText: 'no preço'})).toEqual({label: 'no preço', pct: null, market: null});
    expect(one({smartCls: 'x', smartText: '-5%'})).toBeNull();
    expect(one({smartCls: 'pp-vit-pechincha', smartText: '18%'})!.pct).toBe(-18);
  });
  it('moeda desconhecida ou ambígua vira null', () => {
    const cur = (moeda: string, preco = '10') => sanitizeMarketScan({open: true, cards: [{...card, moeda, preco}]})!.listings[0]!.currency;
    expect(cur('icon gold')).toBe('gold');
    expect(cur('Gemas')).toBe('orb');
    expect(cur('')).toBeNull();
    expect(cur('orb gold')).toBeNull();
  });
  it('descarta linhas malformadas e campos fora de faixa', () => {
    const r = sanitizeMarketScan({open: true, cards: [null, 'x', {...card, name: ''}, {...card, preco: 'grátis'}, {...card, preco: '0'}, {...card, name: 5}, {...card, id: 'a b<script>', pot: 'P9', nota: '77', sub: ''}]});
    expect(r!.listings).toHaveLength(1);
    expect(r!.listings[0]).toMatchObject({id: null, potencia: null, nota: null, level: null});
  });
  it('limita cards e tamanho de texto; ignora campos extras', () => {
    const r = sanitizeMarketScan({open: true, cards: Array.from({length: 500}, () => ({...card, name: 'n'.repeat(900), segredo: 'x'}))});
    expect(r!.listings).toHaveLength(60);
    expect(r!.listings[0]!.name.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(r)).not.toContain('segredo');
  });
  it('mercado fechado e formas inválidas', () => {
    expect(sanitizeMarketScan({open: false, cards: []})).toEqual({open: false, listings: [], smart: false});
    for (const v of [null, 'x', 3, [], {}, {open: 'sim'}, {open: true, cards: 'x'}]) expect(sanitizeMarketScan(v)).toBeNull();
  });
});

describe('marketScan (guardas)', () => {
  const fail = {ok: false, error: MARKET_UNAVAILABLE};
  const good = {url: 'https://pokeidle.io/app', run: async () => ({open: true, cards: [card]})};
  it('script é constante, só lê e não toca em segredos', () => {
    expect(MARKET_SCAN_SCRIPT).not.toMatch(/\.click\(|dispatchEvent|fetch\(|XMLHttpRequest|cookie|localStorage|sessionStorage|\.value\s*=|innerHTML\s*=|WebSocket/);
    expect(MARKET_SCAN_SCRIPT).toContain('#cm-lista');
  });
  it('recusa perfil desconhecido, tipo errado, sem sessão e página de outro site', async () => {
    expect(await marketScan('x', ['a'], () => good)).toEqual(fail);
    expect(await marketScan(5, ['5'], () => good)).toEqual(fail);
    expect(await marketScan('a', ['a'], () => null)).toEqual(fail);
    for (const url of ['https://accounts.google.com/', 'https://pokeidle.io.evil.example/', 'http://pokeidle.io/app', 'lixo']) expect(await marketScan('a', ['a'], () => ({...good, url}))).toEqual(fail);
  });
  it('só executa o script constante e devolve dados válidos', async () => {
    const seen: string[] = [];
    const r = await marketScan('a', ['a'], () => ({...good, run: async (s: string) => { seen.push(s); return {open: true, cards: [card]}; }}));
    expect(seen).toEqual([MARKET_SCAN_SCRIPT]);
    expect(r.ok && r.data.listings[0]!.name).toBe('Charizard');
  });
  it('erro, retorno inválido e tempo esgotado viram a mensagem genérica', async () => {
    expect(await marketScan('a', ['a'], () => ({...good, run: async () => { throw new Error('boom: segredo'); }}))).toEqual(fail);
    expect(await marketScan('a', ['a'], () => ({...good, run: async () => 'x'}))).toEqual(fail);
    expect(await marketScan('a', ['a'], () => { throw new Error('x'); })).toEqual(fail);
    expect(await marketScan('a', ['a'], () => ({...good, run: () => new Promise(() => {})}), 20)).toEqual(fail);
  });
});
