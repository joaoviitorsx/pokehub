import { describe, expect, it } from 'vitest';
import { SHOP_PRELUDE, SHOP_READ_SCRIPT, buildBuyScript, createShop, sanitizeBuyResult, sanitizeShopRead } from '../electron/shop';
import { FakeEl, FakeInput, el, fakeDocument } from './fake-dom';

const coin = () => el('img', 'icon', '', {alt: 'Coins', src: '/assets/ui/coin.webp'});
const gem = () => el('img', 'icon', '', {alt: 'Gems', src: '/assets/ui/gem.webp'});
const pill = (icon: FakeEl, value: string) => el('div', 'pill', '', {}, [icon, el('span', 'v', value)]);

interface CardOpts { name: string; price?: string; have?: number; icon?: 'coin' | 'gem' | 'none'; cls?: string }
function card(o: CardOpts) {
  const have = el('div', 'mk-tem', `você tem ×${o.have ?? 120}`), input = el('input') as FakeInput, btn = el('button', 'mk-acao mk-pal-comprar', 'Comprar');
  const icon = o.icon === 'gem' ? gem() : o.icon === 'none' ? null : coin();
  const price = el('div', 'mk-pal-preco', o.price ?? '130/un.', {}, icon ? [icon] : []);
  const c = el('div', `mk-card mk-pal ${o.cls ?? ''}`, '', {}, [el('img', '', '', {alt: o.name, src: `/items/${o.name.toLowerCase().replace(/ /g, '-')}.png`}), el('div', 'mk-nome', o.name), have, price, input, btn]);
  return {c, have, btn, input, price};
}
/** Market aberto na aba Comprar, categoria única já ativa; `header` fica antes das categorias. */
function market(header: FakeEl[], cards: FakeEl[]) {
  const buy = el('button', 'cmp-op on', 'Comprar'), sell = el('button', 'cmp-op', 'Vender');
  const modal = el('div', 'modal', '', {}, [el('div', 'mk-head', 'Market', {}, header), buy, sell, el('button', 'mk-cat on', 'Pokébolas'), el('button', 'mk-cat', 'Poções'), el('button', 'mk-cat', 'Revives'), ...cards]);
  modal.id = 'modal';
  const body = el('body', '', '', {}, [modal]);
  return {body, doc: fakeDocument(body), modal};
}
const run = <T>(doc: unknown, code: string): Promise<T> =>
  new Function('document', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'setTimeout', `return ${code}`)(doc, FakeInput, class {}, class {}, (f: () => void) => { f(); }) as Promise<T>;
const helpers = (doc: unknown) => new Function('document', `${SHOP_PRELUDE}; return {readGold, cardData, cardsOf};`)(doc) as {readGold(): string; cardData(c: FakeEl): {name: string; cur: string; price: string}; cardsOf(): FakeEl[]};

describe('readGold: só o saldo com ícone de moeda no cabeçalho', () => {
  it('aceita a pílula com ícone de coins', () => {
    const {doc} = market([pill(coin(), '56.209.930')], [card({name: 'Ultra Ball'}).c]);
    expect(helpers(doc).readGold()).toBe('56.209.930');
  });
  it('rejeita saldo com ícone de gema e acha a pílula de ouro ao lado', () => {
    expect(helpers(market([pill(gem(), '120')], [card({name: 'Ultra Ball'}).c]).doc).readGold()).toBe('');
    expect(helpers(market([pill(gem(), '120'), pill(coin(), '56.209.930')], [card({name: 'Ultra Ball'}).c]).doc).readGold()).toBe('56.209.930');
  });
  it('número sem ícone nenhum não vale como ouro; marcador por classe também vale', () => {
    expect(helpers(market([el('span', 'v', '999')], [card({name: 'Ultra Ball'}).c]).doc).readGold()).toBe('');
    expect(helpers(market([el('div', 'pill', '', {}, [el('span', 'moeda-ouro', ''), el('span', 'v', '4.800')])], []).doc).readGold()).toBe('4.800');
  });
  it('ignora números que estão depois das categorias (cards)', () => {
    const {doc} = market([], [card({name: 'Ultra Ball', price: '130'}).c]);
    expect(helpers(doc).readGold()).toBe('');
  });
});

describe('moeda do card', () => {
  it('coin = ouro; gem/orb/diamond = rejeitado; sem marcador = não é ouro; "Golden Potion" não conta como gold', () => {
    const {doc} = market([pill(coin(), '10')], []);
    const h = helpers(doc);
    expect(h.cardData(card({name: 'Ultra Ball'}).c).cur).toBe('coin');
    expect(h.cardData(card({name: 'Ultra Ball', icon: 'gem'}).c).cur).toBe('gem');
    expect(h.cardData(card({name: 'Ultra Ball', icon: 'none'}).c).cur).toBe('');
    expect(h.cardData(card({name: 'Golden Potion', icon: 'none'}).c).cur).toBe(''); // o alt do item ("Golden Potion") não é marcador de moeda
    const mixed = card({name: 'Ultra Ball'}).c; mixed.append(el('span', 'orb-badge'));
    expect(h.cardData(mixed).cur).toBe('gem'); // qualquer marcador de gema vence
  });
});

describe('script de leitura (DOM falso)', () => {
  it('pula cards em gemas ou sem marcador e conta quantos pulou', async () => {
    const {doc} = market([pill(coin(), '56.209.930')], [card({name: 'Ultra Ball'}).c, card({name: 'Great Ball', icon: 'gem'}).c, card({name: 'Poke Ball', icon: 'none'}).c, card({name: 'Mystery Ball'}).c]);
    const raw = await run<{gold: string; items: {name: string}[]; skipped: number}>(doc, SHOP_READ_SCRIPT);
    expect(raw.gold).toBe('56.209.930');
    expect(raw.items.map(i => i.name)).toEqual(['Ultra Ball', 'Mystery Ball', 'Ultra Ball', 'Mystery Ball', 'Ultra Ball', 'Mystery Ball']); // o fake devolve os mesmos cards em cada categoria
    expect(raw.skipped).toBe(6);
    expect(Object.values(raw.items[0]!).every(v => typeof v === 'string')).toBe(true); // só primitivos
  });
  it('sanitizeShopRead segue aceitando o formato', () => { expect(sanitizeShopRead({gold: '1', items: [], skipped: 3})).toEqual({gold: 1, items: []}); });
});

describe('script de compra (DOM falso)', () => {
  const buy = (name = 'Ultra Ball') => buildBuyScript('Pokebolas', name, 10, 130);
  it('recusa card em gemas com "moeda não é ouro" e não clica em comprar', async () => {
    const g = card({name: 'Ultra Ball', icon: 'gem'}), {doc} = market([pill(coin(), '56.209.930')], [g.c]);
    expect(await run(doc, buy())).toMatchObject({ok: false, code: 'currency', error: 'moeda não é ouro'});
    expect(g.btn.clicks).toBe(0);
  });
  it('recusa card sem marcador de moeda', async () => {
    const g = card({name: 'Ultra Ball', icon: 'none'}), {doc} = market([pill(coin(), '56.209.930')], [g.c]);
    expect(await run(doc, buy())).toMatchObject({ok: false, code: 'currency'});
    expect(g.btn.clicks).toBe(0);
  });
  it('compra com ouro: usa o setter nativo, dispara input/change e clica uma vez', async () => {
    const c = card({name: 'Ultra Ball'}), {doc} = market([pill(coin(), '56.209.930')], [c.c]);
    c.btn.onclick = () => { c.have.text = 'você tem ×130'; };
    expect(await run(doc, buy())).toMatchObject({ok: true, before: 120, after: 130});
    expect(c.btn.clicks).toBe(1);
    expect(c.input.value).toBe('10');
  });
  it('sem saldo em ouro legível (ícone de gema no cabeçalho) não compra', async () => {
    const c = card({name: 'Ultra Ball'}), {doc} = market([pill(gem(), '56.209.930')], [c.c]);
    expect(await run(doc, buy())).toMatchObject({ok: false, error: 'Não consegui ler o saldo de ouro.'});
    expect(c.btn.clicks).toBe(0);
  });
  it('itens fora do SHOP_CATALOG não geram script', () => {
    for (const name of ['Mystery Ball', 'Master Ball', 'Egg Box']) expect(() => buildBuyScript('Pokebolas', name, 1, 5)).toThrow();
    expect(() => buildBuyScript('Poções', 'Golden Potion', 1, 5)).not.toThrow();
  });
  it('sanitizeBuyResult reconhece o código de moeda', () => {
    expect(sanitizeBuyResult({ok: false, code: 'currency', error: 'moeda não é ouro'})).toEqual({ok: false, code: 'currency', error: 'moeda não é ouro'});
  });
});

describe('Loja não compra item fora do catálogo, mesmo lido', () => {
  it('mostra na leitura, recusa na compra', async () => {
    const calls: string[] = [];
    const shop = createShop({known: () => ['a'], emit: () => undefined, sleep: async () => undefined, target: () => ({url: 'https://pokeidle.io/app', run: async (script: string) => { calls.push(script); return {gold: '1.000.000', items: [{cat: 'Pokebolas', name: 'Mystery Ball', have: '×1', price: '50/un.'}]}; }})});
    expect(await shop.read('a')).toMatchObject({ok: true, data: {items: [{name: 'Mystery Ball'}]}});
    expect(await shop.buy('a', {cat: 'Pokebolas', name: 'Mystery Ball', qty: 1, unitPrice: 50, total: 50})).toMatchObject({ok: false, error: expect.stringMatching(/não suportado/i)});
    expect(calls).toHaveLength(1); // só a leitura chegou à página
  });
});
