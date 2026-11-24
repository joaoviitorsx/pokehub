import { describe, expect, it } from 'vitest';
import { autoRestock, planAuto, type AutoShop } from '../electron/auto-restock';
import { DEFAULT_STOCK_RULES, sanitizeRules, type StockRules } from '../domain/stock';
import type { ShopRead } from '../domain/shop';

const READ: ShopRead = {gold: 1_000_000, items: [
  {cat: 'Pokebolas', name: 'Ultra Ball', have: 100, price: 130},
  {cat: 'Poções', name: 'Ultimate Potion', have: 50, price: 1500},
  {cat: 'Revives', name: 'Revive', have: 5, price: 2000},
]};
const rules = (over: Partial<StockRules> = {}): StockRules => ({...DEFAULT_STOCK_RULES, auto: true, autoKit: [
  {cat: 'Pokebolas', name: 'Ultra Ball', target: 500}, {cat: 'Poções', name: 'Ultimate Potion', target: 100}, {cat: 'Revives', name: 'Revive', target: 50}], ...over});
function fakeShop(read = READ) {
  const runs: unknown[] = [];
  const shop: AutoShop = {
    read: async () => ({ok: true, data: read}),
    run: async plan => { runs.push(plan); const lines = (plan as {lines: {qty: number; unitPrice: number; total: number; cat: never; name: string}[]}[])[0]!.lines;
      return {ok: true, data: lines.map(order => ({profileId: 'a', order, ok: true, code: 'ok' as const, bought: order.qty, spent: order.total}))}; },
  };
  return {shop, runs};
}

describe('reposição automática', () => {
  it('compra só as categorias baixas, só o que falta', async () => {
    const {shop, runs} = fakeShop();
    const r = await autoRestock(shop, 'a', rules(), ['Revives']);
    expect(r).toEqual({kind: 'bought', orders: [{cat: 'Revives', name: 'Revive', qty: 45, unitPrice: 2000, total: 90_000}], spent: 90_000, failed: 0});
    expect(runs).toHaveLength(1);
    expect((runs[0] as {id: string}[])[0]!.id).toBe('a');
  });
  it('respeita o teto por reposição e o ouro da conta', () => {
    expect(planAuto(READ, rules({autoMax: 60_000}), ['Pokebolas', 'Poções', 'Revives']).map(o => o.name)).toEqual(['Ultra Ball']); // 52.000 cabe; 75.000 e 90.000 não
    expect(planAuto({...READ, gold: 10_000}, rules(), ['Revives'])).toEqual([]);
    expect(planAuto({...READ, gold: null}, rules(), ['Revives'])).toEqual([]);
  });
  it('desligada, sem kit da categoria ou sem ouro: não compra nada', async () => {
    const {shop, runs} = fakeShop();
    expect((await autoRestock(shop, 'a', rules({auto: false}), ['Revives'])).kind).toBe('nothing');
    expect((await autoRestock(shop, 'a', rules({autoKit: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 500}]}), ['Revives'])).kind).toBe('nothing');
    expect((await autoRestock(fakeShop({...READ, gold: 0}).shop, 'a', rules(), ['Revives'])).kind).toBe('nothing');
    expect(runs).toEqual([]);
  });
  it('erro de leitura vira aviso, sem compra', async () => {
    const shop: AutoShop = {read: async () => ({ok: false, error: 'Market fechado'}), run: async () => { throw new Error('não devia comprar'); }};
    expect(await autoRestock(shop, 'a', rules(), ['Revives'])).toEqual({kind: 'error', error: 'Market fechado'});
  });
  it('regras: automática só liga com kit válido; teto validado', () => {
    expect(sanitizeRules({auto: true, autoKit: []}).auto).toBe(false);
    expect(sanitizeRules({auto: true, autoKit: [{cat: 'Revives', name: 'Revive', target: 50}, {cat: 'X', name: 'y', target: 1}]})).toMatchObject({auto: true, autoKit: [{cat: 'Revives', name: 'Revive', target: 50}]});
    expect(sanitizeRules({autoMax: -1}).autoMax).toBe(DEFAULT_STOCK_RULES.autoMax);
    expect(sanitizeRules({autoMax: 2e12}).autoMax).toBe(DEFAULT_STOCK_RULES.autoMax);
    expect(DEFAULT_STOCK_RULES.auto).toBe(false);
  });
});

describe('kit sugerido (ligar "Repor sozinho" sem kit)', () => {
  it('usa o que a conta mais tem, com meta 3× o mínimo', async () => {
    const { suggestKit, sanitizeStock } = await import('../domain/stock');
    const s = sanitizeStock({gold: 1, bolas: [{nome: 'Ultra Ball', qtd: 39_000}, {nome: 'Poke Ball', qtd: 30}], pocoes: 1, revives: 1, usaPocao: true, usaRevive: true})!;
    const items = [{cat: 'Poções' as const, name: 'Ultimate Potion', have: 10_492, price: 1500}, {cat: 'Poções' as const, name: 'Great Potion', have: 3583, price: 150}, {cat: 'Revives' as const, name: 'Max Revive', have: 77, price: 1}];
    expect(suggestKit([s], items, DEFAULT_STOCK_RULES)).toEqual([
      {cat: 'Pokebolas', name: 'Ultra Ball', target: 900}, {cat: 'Poções', name: 'Ultimate Potion', target: 300}, {cat: 'Revives', name: 'Max Revive', target: 60}]);
  });
  it('sem pista usa o padrão; categoria com mínimo 0 fica de fora; o kit passa na validação', async () => {
    const { suggestKit } = await import('../domain/stock');
    const kit = suggestKit([], [], {...DEFAULT_STOCK_RULES, min: {Pokebolas: 300, Poções: 0, Revives: 20}});
    expect(kit).toEqual([{cat: 'Pokebolas', name: 'Ultra Ball', target: 900}, {cat: 'Revives', name: 'Revive', target: 60}]);
    expect(sanitizeRules({auto: true, autoKit: kit})).toMatchObject({auto: true, autoKit: kit});
  });
});
