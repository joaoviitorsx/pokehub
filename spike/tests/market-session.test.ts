import { describe, expect, it } from 'vitest';
import { rankDeals, type MarketListing, type MarketScan } from '../domain/market';
import { SESSION_TTL_MS, accumulate, accumulated, emptyAccumulator, listingKey, sessionKey, sessionStats } from '../domain/market-session';

const L = (patch: Partial<MarketListing> = {}): MarketListing => ({id: 'a', name: 'Venusaur', level: 50, potencia: 3, nota: 5, shiny: false, price: 1000, currency: 'gold', smart: null, ...patch});
const scan = (listings: MarketListing[], page: number | null = 1, query = 'Venusaur'): MarketScan => ({open: true, listings, smart: false, page, pages: 5, query});
const key = sessionKey('p1', 'venusaur');

describe('sessionKey / listingKey', () => {
  it('ignora caixa e espaços da busca, mas separa contas', () => {
    expect(sessionKey('p1', '  VenuSaur ')).toBe(key);
    expect(sessionKey('p1', 'venu  saur')).toBe(sessionKey('p1', 'Venu saur'));
    expect(sessionKey('p2', 'venusaur')).not.toBe(key);
    expect(sessionKey('p1', 'charizard')).not.toBe(key);
  });
  it('id quando existe; senão nome+nível+preço+moeda', () => {
    expect(listingKey(L({id: '9'}))).toBe(listingKey(L({id: '9', price: 5})));
    expect(listingKey(L({id: null}))).toBe(listingKey(L({id: null, name: 'VENUSAUR'})));
    expect(listingKey(L({id: null}))).not.toBe(listingKey(L({id: null, price: 1001})));
    expect(listingKey(L({id: null}))).not.toBe(listingKey(L({id: null, level: 51})));
  });
});

describe('accumulate', () => {
  it('soma páginas diferentes e deduplica por id (a leitura mais nova vence)', () => {
    let acc = accumulate(null, key, scan([L({id: '1'}), L({id: '2'})], 1), 0);
    acc = accumulate(acc, key, scan([L({id: '3'}), L({id: '2', price: 777})], 2), 10);
    expect(accumulated(acc, 10).map(l => [l.id, l.price])).toEqual([['1', 1000], ['2', 777], ['3', 1000]]);
    expect(sessionStats(acc, 10, 5)).toEqual({listings: 3, pagesSeen: 2, pages: 5});
  });
  it('anúncios sem id deduplicam por nome+nível+preço', () => {
    let acc = accumulate(null, key, scan([L({id: null}), L({id: null, level: 60})]), 0);
    acc = accumulate(acc, key, scan([L({id: null})]), 5);
    expect(accumulated(acc, 5)).toHaveLength(2);
  });
  it('busca diferente zera o acúmulo', () => {
    const acc = accumulate(null, key, scan([L({id: '1'})]), 0);
    const other = accumulate(acc, sessionKey('p1', 'charizard'), scan([L({id: '2', name: 'Charizard'})], 1, 'Charizard'), 1);
    expect(accumulated(other, 1).map(l => l.id)).toEqual(['2']);
    expect(accumulated(accumulate(other, key, scan([]), 2), 2)).toEqual([]);
  });
  it('reler um anúncio renova a hora dele', () => {
    let acc = accumulate(null, key, scan([L({id: '1'}), L({id: '2'})], 1), 0);
    acc = accumulate(acc, key, scan([L({id: '2'})], 1), SESSION_TTL_MS - 1);
    expect(accumulated(acc, SESSION_TTL_MS + 5).map(l => l.id)).toEqual(['2']); // "1" venceu, "2" foi renovado
  });
  it('entradas velhas somem na próxima leitura e na consulta', () => {
    const acc = accumulate(null, key, scan([L({id: '1'})]), 0);
    expect(accumulated(acc, SESSION_TTL_MS)).toHaveLength(1);
    expect(accumulated(acc, SESSION_TTL_MS + 1)).toHaveLength(0);
    expect(sessionStats(acc, SESSION_TTL_MS + 1, 5)).toEqual({listings: 0, pagesSeen: 0, pages: 5});
    expect(accumulate(acc, key, scan([L({id: '2'})]), SESSION_TTL_MS + 1).entries.size).toBe(1);
  });
  it('mercado fechado não acrescenta nem apaga', () => {
    const acc = accumulate(null, key, scan([L({id: '1'})]), 0);
    expect(accumulate(acc, key, {open: false, listings: [], smart: false, page: null, pages: null, query: ''}, 1).entries.size).toBe(1);
    expect(accumulated(emptyAccumulator(key), 0)).toEqual([]);
    expect(accumulated(null, 0)).toEqual([]);
  });
});

describe('ranking sobre o acumulado', () => {
  it('compara anúncios de páginas diferentes na mesma lista', () => {
    let acc = accumulate(null, key, scan([L({id: '1', nota: 4, price: 1000}), L({id: '2', nota: 5, price: 1000})], 1), 0);
    acc = accumulate(acc, key, scan([L({id: '3', nota: 9, price: 1000}), L({id: '4', nota: 6, price: 1000})], 2), 1);
    const deals = rankDeals(accumulated(acc, 1), {focus: 'qualidade'});
    expect(deals).toHaveLength(4);
    expect(deals[0]!.listing.id).toBe('3');
    expect(sessionStats(acc, 1, 5).pagesSeen).toBe(2);
  });
});
