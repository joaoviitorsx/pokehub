import { describe, expect, it } from 'vitest';
import { MAX_QTY, KITS_KEY, affordable, fitPlan, loadKits, parseKits, parseOrder, parseShopNumber, planRestock, planTotal, saveKits, type ShopItem } from '../domain/shop';

const inv: ShopItem[] = [
  {cat: 'Pokebolas', name: 'Ultra Ball', have: 120, price: 130}, {cat: 'Pokebolas', name: 'Poke Ball', have: 33, price: 5},
  {cat: 'Poções', name: 'Hyper Potion', have: 100, price: 800}, {cat: 'Revives', name: 'Revive', have: 10, price: 600},
];
describe('números do Market', () => {
  it('lê pt-BR com milhar', () => {
    expect(parseShopNumber('você tem ×10.137')).toBe(10137);
    expect(parseShopNumber('você tem ×33')).toBe(33);
    expect(parseShopNumber('1.500/un.')).toBe(1500);
    expect(parseShopNumber('5/un.')).toBe(5);
    expect(parseShopNumber('56.140.570')).toBe(56140570);
    expect(parseShopNumber('sem número')).toBeNull();
    expect(parseShopNumber(42)).toBeNull();
  });
});
describe('planRestock', () => {
  it('compra só o que falta, pula zero e itens ausentes', () => {
    const plan = planRestock(inv, [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}, {cat: 'Revives', name: 'Revive', target: 50}, {cat: 'Poções', name: 'Hyper Potion', target: 100}, {cat: 'Poções', name: 'Golden Potion', target: 5}]);
    expect(plan).toEqual([{cat: 'Pokebolas', name: 'Ultra Ball', qty: 80, unitPrice: 130, total: 10400}, {cat: 'Revives', name: 'Revive', qty: 40, unitPrice: 600, total: 24000}]);
    expect(planTotal(plan)).toBe(34400);
  });
  it('respeita 9999 por linha', () => {
    expect(planRestock(inv, [{cat: 'Pokebolas', name: 'Poke Ball', target: 50_000}])[0]!.qty).toBe(MAX_QTY);
  });
});
describe('ouro', () => {
  const plan = planRestock(inv, [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}, {cat: 'Revives', name: 'Revive', target: 50}]);
  it('affordable', () => { expect(affordable(plan, 34400)).toBe(true); expect(affordable(plan, 34399)).toBe(false); expect(affordable(plan, null)).toBe(false); });
  it('fitPlan desativa em ordem o que não cabe', () => {
    expect(fitPlan(plan, 20000).map(l => l.fits)).toEqual([true, false]);
    expect(fitPlan(plan, 10399).map(l => l.fits)).toEqual([false, false]);
    expect(fitPlan(plan, null).every(l => !l.fits)).toBe(true);
  });
});
describe('parseOrder', () => {
  const ok = {cat: 'Pokebolas', name: 'Ultra Ball', qty: 10, unitPrice: 130, total: 1300};
  it('aceita pedido válido e total opcional', () => { expect(parseOrder(ok)).toEqual(ok); expect(parseOrder({...ok, total: undefined})).toEqual(ok); });
  it('rejeita cat, nome, qtd, preço e total errados', () => {
    for (const bad of [{...ok, cat: 'Ovos'}, {...ok, name: '<b>x</b>'}, {...ok, name: 'A'}, {...ok, qty: 0}, {...ok, qty: 10000}, {...ok, qty: 1.5}, {...ok, qty: '10'}, {...ok, unitPrice: 0}, {...ok, total: 1299}, null, 'x']) expect(parseOrder(bad)).toBeNull();
  });
});
describe('kits', () => {
  it('valida na leitura', () => {
    const kits = parseKits([{id: 'a', name: ' Farm ', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}, {cat: 'Ovos', name: 'Egg', target: 1}, {cat: 'Revives', name: 'Revive', target: 0}, {cat: 'Pokebolas', name: 'Ultra Ball', target: 5}]}, {id: 'a', name: 'dup', lines: []}, {id: '../x', name: 'ruim', lines: []}, {id: 'b', name: '', lines: []}, 7]);
    expect(kits).toEqual([{id: 'a', name: 'Farm', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}]}]);
    expect(parseKits('lixo')).toEqual([]);
  });
  it('persiste em pokehub.kits e tolera armazenamento corrompido ou ausente', () => {
    const mem = new Map<string, string>(), storage = {getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }};
    saveKits([{id: 'k1', name: 'Farm padrão', lines: [{cat: 'Revives', name: 'Revive', target: 50}]}], storage);
    expect(mem.has(KITS_KEY)).toBe(true);
    expect(loadKits(storage)).toHaveLength(1);
    mem.set(KITS_KEY, '{quebrado');
    expect(loadKits(storage)).toEqual([]);
    expect(loadKits({getItem: () => { throw new Error('x'); }})).toEqual([]);
    expect(() => saveKits([], {setItem: () => { throw new Error('x'); }})).not.toThrow();
  });
});
