import { MAX_GOLD, MAX_ORDER_UNCONFIRMED, MAX_QTY, MAX_UNIT_PRICE, SHOP_CATS, isCatalogItem, isShopCat, isShopName, parseOrder, parseShopNumber, type ShopItem, type ShopLineResult, type ShopOrder, type ShopPlanEntry, type ShopProgress, type ShopRead } from '../domain/shop';
import { atGame, isRecord, text, timed, whole } from './hunt-snapshot';
import { ACCOUNT_BUSY, createAccountLock, type AccountLock } from './account-lock';

/*
 * LOJA RÁPIDA — compra no "Market" (NPC, só ouro/Coins) operando a própria interface do jogo.
 * Cliques que este arquivo faz dentro do jogo (scripts constantes, ou montados só com valores validados):
 *   tile "Market" do menu superior (se o Market estiver fechado), aba "Comprar", categoria (Pokébolas/Poções/Revives),
 *   o botão "Comprar" do item confirmado pelo usuário (um clique por pedido) e o "×" do Market (só se o script o abriu).
 * Escreve apenas no campo de quantidade do item. Nunca clica em "Vender", em Ovos, em gemas nem em dinheiro real.
 * Garantias no código: o card só é lido/comprado se tiver marcador de moeda de OURO (coin|ouro|gold|moeda) e nenhum de gema
 * (gem|gema|orb|diamond); só os itens do SHOP_CATALOG são comprados; os scripts rodam no mundo isolado (executeJavaScriptInIsolatedWorld).
 */
export const SHOP_UNAVAILABLE = 'Não foi possível acessar o Market desta conta.';
const BUSY = 'Já existe uma operação da Loja em andamento.';
const NEED_READ = 'Leia o estoque desta conta antes de comprar.';
const BAD_ORDER = 'Pedido inválido.';
const NOT_SUPPORTED = 'Item não suportado: fora do catálogo da Loja.';
export const SHOP_READ_MS = 20_000, SHOP_BUY_MS = 25_000, SHOP_PAUSE_MS = 1200;
export const MAX_RUN_ACCOUNTS = 4, MAX_RUN_LINES = 20, MAX_ITEMS = 60;
const MAX_STR = 120;

// Trechos compartilhados pelos scripts da página. Código fixo; nenhum dado do renderer entra aqui.
const PRELUDE = String.raw`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, ${MAX_STR});
const N = (v) => S(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cn = (e) => (e && typeof e.className === 'string' ? e.className : '');
const vis = (e) => !!e && e.getClientRects().length > 0;
const num = (s) => { const m = /\d[\d.]*/.exec(S(s)); if (!m) return null; const d = m[0].replace(/\./g, '').slice(0, 15); return d ? Number(d) : null; };
const COIN = /(?<![a-z])(coins?|ouro|gold|moedas?)(?![a-z])/i, GEM = /(?<![a-z])(gems?|gemas?|orbs?|diamonds?|diamantes?)(?![a-z])/i;
const ATTRS = ['alt', 'src', 'title', 'aria-label', 'data-icon'];
const meta = (e, skip) => { if (!e) return ''; const out = []; const add = (x) => { if (skip && skip(x)) return; out.push(cn(x)); for (const a of ATTRS) out.push(String(x.getAttribute(a) || '').slice(0, 300)); }; add(e); for (const x of Array.from(e.querySelectorAll('*')).slice(0, 40)) add(x); return out.join(' ').toLowerCase(); };
const kindOf = (m) => GEM.test(m) ? 'gem' : COIN.test(m) ? 'coin' : '';
const findModal = () => { const m = document.querySelector('.modal#modal'); return vis(m) ? m : null; };
const isMarket = (m) => !!m && /market/i.test(S(m.textContent)) && !!m.querySelector('button.cmp-op');
const openMarket = async () => {
  let m = findModal();
  if (m) return isMarket(m) ? {opened: false} : {err: 'Outro painel do jogo está aberto.'};
  const tile = Array.from(document.querySelectorAll('.menu-topo button')).find((b) => S(b.textContent) === 'Market');
  if (!tile) return {err: 'Botão Market não encontrado.'};
  tile.click();
  for (let i = 0; i < 20; i++) { await sleep(150); m = findModal(); if (isMarket(m)) return {opened: true}; }
  return {err: 'O Market não abriu.'};
};
const ensureBuy = async () => {
  const m = findModal(); if (!m) return false;
  const buy = Array.from(m.querySelectorAll('button.cmp-op')).find((b) => N(b.textContent) === 'comprar');
  if (!buy) return false;
  if (!buy.classList.contains('on')) { buy.click(); await sleep(300); }
  const now = findModal(), on = now && now.querySelector('button.cmp-op.on');
  return !!on && N(on.textContent) === 'comprar';
};
const goCat = async (cat) => {
  const m = findModal(); if (!m) return false;
  const b = Array.from(m.querySelectorAll('button.mk-cat')).find((x) => N(x.textContent).startsWith(N(cat)));
  if (!b) return false;
  if (!b.classList.contains('on')) b.click();
  await sleep(400);
  return true;
};
const nameOf = (c) => {
  const bad = (t) => !t || /^[+\d]/.test(t);
  const n = c.querySelector('.mk-nome'), img = c.querySelector('img'), b = c.querySelector('button');
  const cands = [n && n.textContent, img && img.getAttribute('alt'), b && b.getAttribute('aria-label'), b && b.getAttribute('title'), c.getAttribute('aria-label'), c.getAttribute('title')].map((t) => S(t).replace(/^comprar\s+/i, ''));
  return cands.find((t) => !bad(t)) || '';
};
const cardCur = (c, name) => kindOf(meta(c, (x) => String(x.tagName).toUpperCase() === 'IMG' && !!name && N(x.getAttribute('alt')) === N(name)));
const cardData = (c) => { const name = nameOf(c); return {name: name, have: S((c.querySelector('.mk-tem') || {}).textContent), price: S((c.querySelector('.mk-pal-preco') || {}).textContent), cur: cardCur(c, name)}; };
const cardsOf = () => { const m = findModal(); return m ? Array.from(m.querySelectorAll('.mk-card.mk-pal')).slice(0, 40) : []; };
const NUM = /^\d{1,3}(?:\.\d{3})*$|^\d+$/;
const readGold = () => {
  const m = findModal(); if (!m) return '';
  const first = m.querySelector('.mk-cat, .mk-card'), leaves = [];
  for (const e of m.querySelectorAll('*')) {
    if (first && !(first.compareDocumentPosition(e) & 2)) continue; // só o cabeçalho do Market (antes das categorias/cards)
    const t = S(e.textContent);
    if (!NUM.test(t) || Array.from(e.children).some((c) => NUM.test(S(c.textContent)))) continue;
    leaves.push(e);
  }
  // o ícone mais próximo do número decide: precisa indicar moeda de ouro; ícone de gema rejeita
  const kindFor = (e) => {
    const k = kindOf(meta(e)); if (k) return k;
    let p = e.parentElement;
    for (let i = 0; i < 2 && p && p !== m && !(first && p.contains(first)); i++, p = p.parentElement) if (leaves.filter((x) => p.contains(x)).length === 1) { const kp = kindOf(meta(p)); if (kp) return kp; }
    return '';
  };
  for (const e of leaves) if (kindFor(e) === 'coin') return S(e.textContent);
  return '';
};
const closeModal = async () => {
  const m = findModal(); if (!m) return;
  const b = Array.from(m.querySelectorAll('button')).find((x) => !x.closest('.mk-card') && (/^[x×✕✖]$/i.test(S(x.textContent)) || /modal-fechar|fechar|close/i.test(cn(x))));
  if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
  await sleep(250);
};
`;

// Lê saldo e as 3 categorias. Devolve textos crus; o processo principal valida tudo.
/** Trechos comuns dos scripts (exportado para os testes com DOM falso). */
export const SHOP_PRELUDE = PRELUDE;
export const SHOP_READ_SCRIPT = String.raw`(async () => {${PRELUDE}
  const CATS = ${JSON.stringify(SHOP_CATS)};
  let opened = false;
  try {
    const o = await openMarket(); if (o.err) return {error: o.err};
    opened = o.opened;
    if (!(await ensureBuy())) return {error: 'Aba Comprar não encontrada.'};
    const gold = readGold(), items = [];
    let skipped = 0;
    for (const cat of CATS) { if (!(await goCat(cat))) continue; for (const c of cardsOf()) { const d = cardData(c); if (d.cur !== 'coin') { skipped++; continue; } items.push({cat: S(cat), name: d.name, have: d.have, price: d.price}); } }
    return {gold: S(gold), items: items.slice(0, ${MAX_ITEMS}), skipped: Math.min(skipped, 999)};
  } catch (e) { return {error: 'Falha ao ler o Market.'}; }
  finally { if (opened) await closeModal(); }
})()`;

/** Monta o script de compra SÓ com valores validados (categoria do enum, nome sanitizado, inteiros) embutidos via JSON.stringify. Lança se algo for inválido. */
export function buildBuyScript(cat: unknown, name: unknown, qty: unknown, unitPrice: unknown): string {
  if (!isShopCat(cat) || !isShopName(name) || !isCatalogItem(cat, name) || whole(qty, 1, MAX_QTY) === null || whole(unitPrice, 1, MAX_UNIT_PRICE) === null) throw new Error(BAD_ORDER);
  const q = qty as number, p = unitPrice as number;
  return String.raw`(async () => {${PRELUDE}
  const CAT = ${JSON.stringify(cat)}, NAME = ${JSON.stringify(name)}, QTY = ${JSON.stringify(q)}, PRICE = ${JSON.stringify(p)}, TOTAL = ${JSON.stringify(q * p)};
  const fail = (code, error, extra) => Object.assign({ok: false, code: code, error: error}, extra || {});
  const again = () => { const l = cardsOf().filter((c) => cardData(c).name === NAME); return l.length === 1 ? l[0] : null; };
  let opened = false, clicked = false;
  try {
    const o = await openMarket(); if (o.err) return fail('other', o.err);
    opened = o.opened;
    if (!(await ensureBuy())) return fail('other', 'Aba Comprar não encontrada.');
    if (!(await goCat(CAT))) return fail('other', 'Categoria não encontrada.');
    const found = cardsOf().filter((c) => cardData(c).name === NAME);
    if (found.length === 0) return fail('absent', 'Item não encontrado no Market.');
    if (found.length > 1) return fail('other', 'Nome ambíguo no Market.');
    const d = cardData(found[0]);
    if (d.cur !== 'coin') return fail('currency', 'moeda não é ouro');
    const price = num(d.price), before = num(d.have), goldBefore = num(readGold());
    if (price === null || before === null) return fail('other', 'Não consegui ler preço ou estoque do item.');
    if (price !== PRICE) return fail('price', 'O preço mudou; compra cancelada.', {before: before});
    if (goldBefore === null) return fail('other', 'Não consegui ler o saldo de ouro.');
    if (goldBefore < TOTAL) return fail('gold', 'Ouro insuficiente.', {before: before});
    let card = again(); const input = card && card.querySelector('input');
    if (!input) return fail('other', 'Campo de quantidade não encontrado.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(QTY));
    input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));
    await sleep(200);
    card = again(); const field = card && card.querySelector('input'), btn = card && card.querySelector('button.mk-acao.mk-pal-comprar');
    if (!field || !btn) return fail('other', 'Botão de compra não encontrado.');
    if (S(field.value) !== String(QTY)) return fail('other', 'O jogo não aceitou a quantidade.', {before: before});
    if (cardData(card).cur !== 'coin') return fail('currency', 'moeda não é ouro', {before: before});
    if (num(cardData(card).price) !== PRICE) return fail('price', 'O preço mudou; compra cancelada.', {before: before});
    if (btn.disabled) return fail('other', 'Botão de compra desabilitado.', {before: before});
    clicked = true; btn.click();
    let after = before;
    for (let t = 0; t < 24; t++) {
      await sleep(250);
      const c = again(), h = c ? num(cardData(c).have) : null;
      if (h !== null && h > before) { await sleep(500); const c2 = again(), h2 = c2 ? num(cardData(c2).have) : null; after = h2 !== null ? h2 : h; break; }
    }
    const goldAfter = num(readGold());
    if (after <= before) return fail('unconfirmed', 'O jogo não confirmou a compra (estoque não aumentou). Confira no jogo.', {before: before});
    return {ok: true, before: before, after: after, spent: goldAfter !== null ? goldBefore - goldAfter : null};
  } catch (e) { return fail(clicked ? 'unconfirmed' : 'other', 'Falha ao comprar no Market.'); }
  finally { if (opened) await closeModal(); }
})()`;
}

/** Valida a leitura crua da página: nomes, números pt-BR e limites. Devolve null se o formato for inesperado. */
export function sanitizeShopRead(raw: unknown): ShopRead | null {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
  const gold = typeof raw.gold === 'string' ? parseShopNumber(raw.gold) : null, items: ShopItem[] = [], seen = new Set<string>();
  for (const it of raw.items.slice(0, MAX_ITEMS)) {
    if (!isRecord(it) || !isShopCat(it.cat)) continue;
    const name = text(it.name, 40), have = typeof it.have === 'string' ? parseShopNumber(it.have) : null, price = typeof it.price === 'string' ? parseShopNumber(it.price) : null;
    if (name === null || !isShopName(name) || have === null || price === null || price < 1 || price > MAX_UNIT_PRICE || seen.has(`${it.cat}|${name}`)) continue;
    seen.add(`${it.cat}|${name}`); items.push({cat: it.cat, name, have, price});
  }
  return {gold: gold !== null && gold <= MAX_GOLD ? gold : null, items};
}

export interface BuyData { before: number; after: number; bought: number; spent: number | null }
type Code = 'price' | 'gold' | 'absent' | 'unconfirmed' | 'currency' | 'other';
type Bought = {ok: true; data: BuyData} | {ok: false; error: string; code: Code};
export function sanitizeBuyResult(raw: unknown): Bought {
  if (!isRecord(raw)) return {ok: false, error: SHOP_UNAVAILABLE, code: 'other'};
  if (raw.ok === true) {
    const before = whole(raw.before, 0, 1e15), after = whole(raw.after, 0, 1e15), spent = whole(raw.spent, -1e15, 1e15);
    if (before === null || after === null || after <= before) return {ok: false, error: 'O jogo não confirmou a compra. Confira no jogo.', code: 'unconfirmed'};
    return {ok: true, data: {before, after, bought: after - before, spent}};
  }
  const code = (['price', 'gold', 'absent', 'unconfirmed', 'currency'] as const).find(c => c === raw.code) ?? 'other';
  return {ok: false, error: text(raw.error, 120) ?? SHOP_UNAVAILABLE, code};
}

/** `run` executa no MUNDO ISOLADO da página (executeJavaScriptInIsolatedWorld): o DOM é o mesmo, mas os globais e protótipos da página não. */
export interface ShopTarget { url: string; run(script: string): Promise<unknown> }
export interface ShopDeps {
  known(): readonly string[];
  target(id: string): ShopTarget | null;
  emit(progress: ShopProgress): void;
  sleep?(ms: number): Promise<void>;
  readMs?: number; buyMs?: number; pauseMs?: number;
  lock?: AccountLock; // trava por conta compartilhada com a leitura do Market
}
export type ShopResult<T> = {ok: true; data: T} | {ok: false; error: string};
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const SOFT: readonly Code[] = ['price', 'gold', 'absent']; // erros que não impedem as outras linhas da mesma conta

export function createShop(deps: ShopDeps) {
  const sleep = deps.sleep ?? wait, readMs = deps.readMs ?? SHOP_READ_MS, buyMs = deps.buyMs ?? SHOP_BUY_MS, pauseMs = deps.pauseMs ?? SHOP_PAUSE_MS;
  const last = new Map<string, ShopRead>(); // última leitura saneada por conta: só itens que ela mostrou podem ser comprados
  const lock = deps.lock ?? createAccountLock();
  let running = false, stopRequested = false;
  const usable = (id: string): ShopTarget | null => { try { const t = deps.target(id); return t && atGame(t.url) ? t : null; } catch { return null; } };
  const known = (id: unknown): id is string => typeof id === 'string' && deps.known().includes(id);

  async function doRead(id: string): Promise<ShopResult<ShopRead>> {
    try {
      const t = usable(id);
      if (!t) return {ok: false, error: SHOP_UNAVAILABLE};
      const raw = await timed(t.run(SHOP_READ_SCRIPT), readMs);
      if (isRecord(raw) && typeof raw.error === 'string') return {ok: false, error: text(raw.error, 120) ?? SHOP_UNAVAILABLE};
      const data = sanitizeShopRead(raw);
      if (!data || data.items.length === 0) return {ok: false, error: SHOP_UNAVAILABLE};
      last.set(id, data);
      return {ok: true, data};
    } catch { return {ok: false, error: SHOP_UNAVAILABLE}; }
  }
  async function doBuy(id: string, order: ShopOrder): Promise<Bought> {
    const read = last.get(id);
    if (!isCatalogItem(order.cat, order.name)) return {ok: false, error: NOT_SUPPORTED, code: 'other'};
    if (!read?.items.some(i => i.cat === order.cat && i.name === order.name)) return {ok: false, error: NEED_READ, code: 'other'};
    try {
      const t = usable(id);
      if (!t) return {ok: false, error: SHOP_UNAVAILABLE, code: 'other'};
      const result = sanitizeBuyResult(await timed(t.run(buildBuyScript(order.cat, order.name, order.qty, order.unitPrice)), buyMs));
      if (result.ok) { // gasto AUTORIZADO = preço × quantidade comprada (o delta de ouro do jogo ocioso inclui ganhos); a leitura segue em dia
        const bought = Math.min(order.qty, result.data.bought); result.data.bought = bought; result.data.spent = order.unitPrice * bought;
        last.set(id, {gold: read.gold === null ? null : Math.max(0, read.gold - result.data.spent), items: read.items.map(i => i.cat === order.cat && i.name === order.name ? {...i, have: result.data.after} : i)});
      }
      return result;
    } catch { return {ok: false, error: 'Não foi possível concluir a compra. Confira no jogo.', code: 'unconfirmed'}; }
  }
  /** Uma operação por conta (e nenhuma durante uma execução): reserva antes de qualquer await. */
  async function guarded<T>(id: string, work: () => Promise<T>, busyValue: (error: string) => T): Promise<T> {
    if (running) return busyValue(BUSY);
    const release = lock.acquire(id);
    if (!release) return busyValue(ACCOUNT_BUSY);
    try { return await work(); } finally { release(); }
  }

  return {
    async read(id: unknown): Promise<ShopResult<ShopRead>> {
      if (!known(id)) return {ok: false, error: SHOP_UNAVAILABLE};
      return guarded(id, () => doRead(id), error => ({ok: false, error}));
    },
    /** Compra única. O total confirmado (`order.total`) deve bater com qtd × preço; sem ele, vale o teto de 50.000 de ouro. */
    async buy(id: unknown, rawOrder: unknown): Promise<ShopResult<BuyData>> {
      const order = parseOrder(rawOrder);
      if (!known(id) || !order) return {ok: false, error: BAD_ORDER};
      const confirmed = isRecord(rawOrder) && rawOrder.total === order.total;
      if (!confirmed && order.total > MAX_ORDER_UNCONFIRMED) return {ok: false, error: `Acima de ${MAX_ORDER_UNCONFIRMED} de ouro só com confirmação do total.`};
      const r = await guarded<Bought>(id, () => doBuy(id, order), error => ({ok: false, error, code: 'other'}));
      return r.ok ? {ok: true, data: r.data} : {ok: false, error: r.error};
    },
    /** Executa um plano já confirmado: contas em sequência, linhas em ordem, 1,2 s entre compras. Progresso via `emit`. */
    async run(rawPlan: unknown): Promise<ShopResult<ShopLineResult[]>> {
      if (!Array.isArray(rawPlan) || rawPlan.length === 0 || rawPlan.length > MAX_RUN_ACCOUNTS) return {ok: false, error: BAD_ORDER};
      const plan: ShopPlanEntry[] = [], ids = new Set<string>();
      for (const entry of rawPlan) {
        if (!isRecord(entry) || !known(entry.id) || ids.has(entry.id) || !Array.isArray(entry.lines) || entry.lines.length === 0 || entry.lines.length > MAX_RUN_LINES) return {ok: false, error: BAD_ORDER};
        const lines = entry.lines.map(parseOrder);
        // em lote o total confirmado é obrigatório (o que o usuário viu na confirmação)
        if (lines.some(l => l === null) || !entry.lines.every((l, i) => isRecord(l) && l.total === lines[i]!.total)) return {ok: false, error: BAD_ORDER};
        ids.add(entry.id); plan.push({id: entry.id, lines: lines as ShopOrder[]});
      }
      if (running) return {ok: false, error: BUSY};
      const releases: (() => void)[] = [];
      for (const p of plan) { const release = lock.acquire(p.id); if (!release) { for (const r of releases) r(); return {ok: false, error: ACCOUNT_BUSY}; } releases.push(release); }
      running = true; stopRequested = false;
      const results: ShopLineResult[] = [];
      let first = true;
      try {
        for (const {id, lines} of plan) {
          let halted = false;
          for (const [line, order] of lines.entries()) {
            const base = {kind: 'line' as const, profileId: id, line, name: order.name, qty: order.qty};
            const skip = (why: string) => { deps.emit({...base, status: 'skipped'}); results.push({profileId: id, order, ok: false, code: 'skipped', error: why}); };
            if (halted) { skip('Interrompido após um erro nesta conta.'); continue; }
            if (stopRequested) { skip('Interrompido pelo usuário.'); continue; }
            if (!first) await sleep(pauseMs);
            first = false;
            if (stopRequested) { skip('Interrompido pelo usuário.'); continue; }
            deps.emit({...base, status: 'buying'});
            const r = await doBuy(id, order);
            if (r.ok) { deps.emit({...base, status: 'ok', bought: r.data.bought, spent: r.data.spent}); results.push({profileId: id, order, ok: true, code: 'ok', bought: r.data.bought, spent: r.data.spent}); }
            else { deps.emit({...base, status: 'error', error: r.error}); results.push({profileId: id, order, ok: false, code: r.code, error: r.error}); if (!SOFT.includes(r.code)) halted = true; }
          }
        }
      } finally { running = false; for (const r of releases) r(); deps.emit({kind: 'done', stopped: stopRequested}); }
      return {ok: true, data: results};
    },
    /** Pede para parar: a compra em andamento termina; as próximas linhas são puladas. */
    stop(): boolean { const was = running; if (running) stopRequested = true; return was; },
    isRunning: () => running,
    lastRead: (id: string) => last.get(id) ?? null,
  };
}
