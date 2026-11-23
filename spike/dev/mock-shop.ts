// Loja falsa para a prévia: roda o controlador REAL (spike/electron/shop.ts) contra um "jogo" simulado (ouro, estoque e preços da v1.474).
// Só desenvolvimento. O script de compra é lido por regex (valores embutidos por JSON.stringify), como o jogo faria ao executá-lo.
import { SHOP_READ_SCRIPT, createShop } from '../electron/shop';
import type { ShopProgress } from '../domain/shop';

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const PRICES: [string, string, number, number][] = [
  ['Pokebolas', 'Poke Ball', 5, 33], ['Pokebolas', 'Great Ball', 20, 10137], ['Pokebolas', 'Ultra Ball', 130, 120],
  ['Poções', 'Small Potion', 50, 4], ['Poções', 'Great Potion', 150, 0], ['Poções', 'Ultra Potion', 400, 12], ['Poções', 'Hyper Potion', 800, 60], ['Poções', 'Ultimate Potion', 1500, 3], ['Poções', 'Golden Potion', 2500, 0],
  ['Revives', 'Revive', 600, 22], ['Revives', 'Max Revive', 5000, 1],
];
type Game = {gold: number; have: Map<string, number>};
const games = new Map<string, Game>();
const gameOf = (id: string, index: number): Game => {
  let g = games.get(id);
  if (!g) { g = {gold: [56_140_570, 4_800, 1_250_000, 90_000][index % 4]!, have: new Map(PRICES.map(([, name, , have]) => [name, have]))}; games.set(id, g); }
  return g;
};
const grab = (script: string, name: string) => JSON.parse(new RegExp(String.raw`\b${name} = ("[^"]*"|\d+)`).exec(script)![1]!) as string | number;

export function createMockShop(ids: () => string[], emit: (p: ShopProgress) => void, delay = 700) {
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  return createShop({
    known: ids, emit, sleep: ms => wait(Math.min(ms, 300)),
    target: id => ({url: 'https://pokeidle.io/app', run: async (script: string) => {
      const g = gameOf(id, ids().indexOf(id));
      await wait(delay);
      if (script === SHOP_READ_SCRIPT) return {gold: fmt(g.gold), items: PRICES.map(([cat, name, price]) => ({cat, name, have: `você tem ×${fmt(g.have.get(name)!)}`, price: `${fmt(price)}/un.`}))};
      const name = grab(script, 'NAME') as string, qty = grab(script, 'QTY') as number, price = grab(script, 'PRICE') as number;
      const real = PRICES.find(p => p[1] === name);
      if (!real) return {ok: false, code: 'absent', error: 'Item não encontrado no Market.'};
      if (real[2] !== price) return {ok: false, code: 'price', error: 'O preço mudou; compra cancelada.'};
      if (g.gold < qty * price) return {ok: false, code: 'gold', error: 'Ouro insuficiente.'};
      const before = g.have.get(name)!;
      g.gold -= qty * price; g.have.set(name, before + qty);
      return {ok: true, before, after: before + qty, spent: qty * price};
    }}),
  });
}
