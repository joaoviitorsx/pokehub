import { describe, expect, it } from 'vitest';
import type { ShopProgress } from '../domain/shop';
import { SHOP_READ_SCRIPT, buildBuyScript, createShop, sanitizeBuyResult, sanitizeShopRead } from '../electron/shop';

const read = {gold: '56.140.570', items: [
  {cat: 'Pokebolas', name: 'Ultra Ball', have: 'você tem ×120', price: '130/un.'}, {cat: 'Poções', name: 'Hyper Potion', have: 'você tem ×1.000', price: '800/un.'},
  {cat: 'Revives', name: 'Revive', have: 'você tem ×10', price: '600/un.'},
]};
const order = {cat: 'Pokebolas', name: 'Ultra Ball', qty: 10, unitPrice: 130, total: 1300};

describe('sanitizeShopRead', () => {
  it('converte pt-BR e descarta lixo', () => {
    const data = sanitizeShopRead({...read, items: [...read.items, {cat: 'Ovos', name: 'Egg Box', have: '×1', price: '5/un.'}, {cat: 'Revives', name: '<img src=x onerror=1>', have: '×1', price: '5/un.'}, {cat: 'Revives', name: 'Revive', have: '×1', price: '5/un.'}, {cat: 'Revives', name: 'Max Revive', have: 'x', price: '5.000/un.'}, {cat: 'Revives', name: 'Max Revive', have: '×1', price: '0'}, 5]})!;
    expect(data.gold).toBe(56140570);
    expect(data.items.map(i => [i.name, i.have, i.price])).toEqual([['Ultra Ball', 120, 130], ['Hyper Potion', 1000, 800], ['Revive', 10, 600]]);
    expect(sanitizeShopRead({items: 'x'})).toBeNull();
    expect(sanitizeShopRead({gold: '???', items: []})!.gold).toBeNull();
  });
});

describe('buildBuyScript', () => {
  it('rejeita categoria, nome e quantidade fora do permitido', () => {
    for (const args of [['Ovos', 'Ultra Ball', 1, 5], ['Pokebolas', 'x"; alert(1); "', 1, 5], ['Pokebolas', 'A', 1, 5], ['Pokebolas', 'Ultra Ball', 0, 5], ['Pokebolas', 'Ultra Ball', 10000, 5], ['Pokebolas', 'Ultra Ball', 1.5, 5], ['Pokebolas', 'Ultra Ball', '5', 5], ['Pokebolas', 'Ultra Ball', 1, 0], ['Pokebolas', 'Ultra Ball', 1, 1e9]] as const) expect(() => buildBuyScript(args[0], args[1], args[2], args[3])).toThrow();
  });
  it('embute só valores JSON e clica uma vez no comprar', () => {
    const script = buildBuyScript('Pokebolas', 'Ultra Ball', 10, 130);
    expect(script).toContain('const CAT = "Pokebolas", NAME = "Ultra Ball", QTY = 10, PRICE = 130, TOTAL = 1300;');
    expect(script.match(/btn\.click\(\)/g)).toHaveLength(1);
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|cookie|localStorage|eval\(|Function\(/);
    expect(() => new Function(`return ${script}`)).not.toThrow(); // sintaxe válida
  });
  it('script de leitura tem sintaxe válida, só categorias permitidas e não compra', () => {
    expect(() => new Function(`return ${SHOP_READ_SCRIPT}`)).not.toThrow();
    expect(SHOP_READ_SCRIPT).toContain('["Pokebolas","Poções","Revives"]');
    expect(SHOP_READ_SCRIPT).not.toContain('btn.click');
    expect(SHOP_READ_SCRIPT).not.toMatch(/Ovos|Vender/);
  });
});

describe('sanitizeBuyResult', () => {
  it('valida números e códigos', () => {
    expect(sanitizeBuyResult({ok: true, before: 120, after: 130, spent: 1300})).toEqual({ok: true, data: {before: 120, after: 130, bought: 10, spent: 1300}});
    expect(sanitizeBuyResult({ok: true, before: 120, after: 120})).toMatchObject({ok: false, code: 'unconfirmed'});
    expect(sanitizeBuyResult({ok: false, code: 'price', error: 'O preço mudou'})).toEqual({ok: false, code: 'price', error: 'O preço mudou'});
    expect(sanitizeBuyResult({ok: false, code: 'hack'})).toMatchObject({ok: false, code: 'other'});
    expect(sanitizeBuyResult('x')).toMatchObject({ok: false});
  });
});

// Jogo falso: devolve o que o script devolveria, lendo os valores embutidos nele.
function setup(opts: {gold?: number; price?: number; delay?: boolean} = {}) {
  const state = {gold: opts.gold ?? 56140570, have: 120, price: opts.price ?? 130, buys: [] as string[], open: 0, maxOpen: 0, url: 'https://pokeidle.io/app', fail: false};
  const events: ShopProgress[] = [], sleeps: number[] = [], log: string[] = [];
  const shop = createShop({known: () => ['a', 'b'], emit: e => events.push(e), sleep: async ms => { sleeps.push(ms); }, pauseMs: 1200,
    target: id => ({url: state.url, run: async (script: string) => {
      state.open++; state.maxOpen = Math.max(state.maxOpen, state.open);
      if (opts.delay) await new Promise(r => setTimeout(r, 5));
      try {
        if (script === SHOP_READ_SCRIPT) return {gold: String(state.gold), items: [{cat: 'Pokebolas', name: 'Ultra Ball', have: `×${state.have}`, price: `${state.price}/un.`}]};
        const qty = Number(/QTY = (\d+)/.exec(script)![1]), price = Number(/PRICE = (\d+)/.exec(script)![1]);
        log.push(`${id}:${qty}`);
        if (state.fail) return {ok: false, code: 'other', error: 'Falha'};
        if (price !== state.price) return {ok: false, code: 'price', error: 'O preço mudou; compra cancelada.'};
        if (state.gold < qty * price) return {ok: false, code: 'gold', error: 'Ouro insuficiente.'};
        state.gold -= qty * price; state.buys.push(`${id}:${qty}`);
        const before = state.have; state.have += qty;
        return {ok: true, before, after: state.have, spent: qty * price};
      } finally { state.open--; }
    }})});
  return {shop, state, events, sleeps, log};
}

describe('guardas da Loja', () => {
  it('lê e devolve estoque saneado; recusa id desconhecido, tipo errado e página de outro site', async () => {
    const {shop, state} = setup();
    expect(await shop.read('a')).toMatchObject({ok: true, data: {gold: 56140570, items: [{name: 'Ultra Ball', have: 120, price: 130}]}});
    for (const id of ['x', null, 5, {id: 'a'}]) expect(await shop.read(id)).toMatchObject({ok: false});
    state.url = 'https://accounts.exemplo.com/login';
    expect(await shop.read('a')).toMatchObject({ok: false});
    expect(await shop.buy('a', order)).toMatchObject({ok: false});
    expect(state.buys).toEqual([]);
  });
  it('só compra item que a última leitura mostrou', async () => {
    const {shop, log} = setup();
    expect(await shop.buy('a', order)).toMatchObject({ok: false, error: expect.stringContaining('Leia o estoque')});
    await shop.read('a');
    expect(await shop.buy('a', {...order, name: 'Master Ball', unitPrice: 5, total: 50})).toMatchObject({ok: false});
    expect(log).toEqual([]);
    expect(await shop.buy('a', order)).toMatchObject({ok: true, data: {before: 120, after: 130, bought: 10, spent: 1300}});
    expect(log).toEqual(['a:10']);
  });
  it('preço mudou: aborta sem comprar', async () => {
    const {shop, state} = setup();
    await shop.read('a'); state.price = 150; // o preço confirmado era 130
    expect(await shop.buy('a', order)).toMatchObject({ok: false, error: expect.stringContaining('preço mudou')});
    expect(state.buys).toEqual([]);
  });
  it('ouro insuficiente: recusa', async () => {
    const {shop, state} = setup({gold: 1000});
    await shop.read('a');
    expect(await shop.buy('a', order)).toMatchObject({ok: false, error: 'Ouro insuficiente.'});
    expect(state.buys).toEqual([]);
  });
  it('pedido inválido, total divergente e teto sem total confirmado', async () => {
    const {shop, log} = setup();
    await shop.read('a');
    for (const bad of [{...order, total: 1}, {...order, qty: 0}, {...order, cat: 'Ovos'}, null]) expect(await shop.buy('a', bad)).toEqual({ok: false, error: 'Pedido inválido.'});
    expect(await shop.buy('a', {...order, qty: 9999, total: undefined})).toMatchObject({ok: false, error: expect.stringContaining('50000')});
    expect(log).toEqual([]);
    expect(await shop.buy('a', {...order, qty: 9999, total: 9999 * 130})).toMatchObject({ok: true}); // total explícito = o que o usuário viu
  });
  it('uma operação por conta: segunda chamada simultânea é recusada', async () => {
    const {shop, state} = setup({delay: true});
    await shop.read('a');
    const [first, second] = await Promise.all([shop.buy('a', order), shop.buy('a', order)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(state.maxOpen).toBe(1);
    expect(state.buys).toHaveLength(1);
  });
});

describe('execução em lote', () => {
  const plan = [{id: 'a', lines: [order, {...order, qty: 5, total: 650}]}, {id: 'b', lines: [order]}];
  it('contas em sequência, 1,2 s entre compras e progresso por linha', async () => {
    const {shop, state, events, sleeps} = setup({delay: true});
    await shop.read('a'); await shop.read('b');
    const r = await shop.run(plan);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.data.every(x => x.ok)).toBe(true);
    expect(state.buys).toEqual(['a:10', 'a:5', 'b:10']);
    expect(state.maxOpen).toBe(1);
    expect(sleeps).toEqual([1200, 1200]);
    expect(events.flatMap(e => e.kind === 'line' && e.status === 'ok' ? [`${e.profileId}${e.line}`] : [])).toEqual(['a0', 'a1', 'b0']);
    expect(events.at(-1)).toEqual({kind: 'done', stopped: false});
    expect(shop.isRunning()).toBe(false);
  });
  it('exige total confirmado, contas conhecidas e limites', async () => {
    const {shop} = setup();
    await shop.read('a');
    for (const bad of [[], 'x', [{id: 'z', lines: [order]}], [{id: 'a', lines: []}], [{id: 'a', lines: [{...order, total: undefined}]}], [{id: 'a', lines: [order]}, {id: 'a', lines: [order]}], [{id: 'a', lines: Array(21).fill(order)}], Array(5).fill({id: 'a', lines: [order]})]) expect(await shop.run(bad)).toEqual({ok: false, error: 'Pedido inválido.'});
  });
  it('erro leve (ouro) segue; erro inesperado interrompe só aquela conta', async () => {
    const g = setup({gold: 1500});
    await g.shop.read('a'); await g.shop.read('b');
    const r = await g.shop.run(plan);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.data.map(x => [x.profileId, x.ok])).toEqual([['a', true], ['a', false], ['b', false]]); // 1300 compra; sobram 200: nem 650 nem 1300 cabem
    const h = setup();
    await h.shop.read('a'); await h.shop.read('b'); h.state.fail = true;
    const r2 = await h.shop.run(plan);
    if (!r2.ok) throw new Error('esperava ok');
    expect(r2.data.map(x => x.error)).toEqual(['Falha', 'Interrompido após um erro nesta conta.', 'Falha']);
    expect(h.log).toEqual(['a:10', 'b:10']);
  });
  it('não roda duas vezes junto e bloqueia leituras durante a execução; parar pula as próximas', async () => {
    const {shop, events} = setup({delay: true});
    await shop.read('a'); await shop.read('b');
    const running = shop.run(plan);
    expect(await shop.run(plan)).toMatchObject({ok: false});
    expect(await shop.read('b')).toMatchObject({ok: false});
    expect(shop.stop()).toBe(true);
    const r = await running;
    if (!r.ok) throw new Error('esperava ok');
    expect(r.data.some(x => x.error === 'Interrompido pelo usuário.')).toBe(true);
    expect(events.at(-1)).toEqual({kind: 'done', stopped: true});
    expect(shop.stop()).toBe(false);
  });
});
