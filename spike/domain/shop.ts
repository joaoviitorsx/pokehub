import { parsePtNumber } from './market';

// Loja rápida: tipos e regras puras (sem DOM, sem IPC). Só ouro (Coins) do Market do jogo; "Ovos" fica de fora de propósito.
export const SHOP_CATS = ['Pokebolas', 'Poções', 'Revives'] as const;
export type ShopCat = (typeof SHOP_CATS)[number];
export const MAX_QTY = 9999, MAX_ORDER_UNCONFIRMED = 50_000, MAX_UNIT_PRICE = 10_000_000, MAX_GOLD = 1e15;
export const SHOP_NAME = /^[\p{L}\d +.'-]{2,32}$/u;
/** Itens vistos no jogo (v1.474); o editor de kits os oferece mesmo sem leitura. Qualquer outro nome só entra se vier de uma leitura. */
export const SHOP_CATALOG: Record<ShopCat, readonly string[]> = {
  Pokebolas: ['Poke Ball', 'Great Ball', 'Super Ball', 'Ultra Ball'] // conferido no jogo v1.474 (Market → Pokébolas),
  Poções: ['Small Potion', 'Great Potion', 'Ultra Potion', 'Hyper Potion', 'Ultimate Potion', 'Golden Potion'],
  Revives: ['Revive', 'Max Revive'],
};

export interface ShopItem { cat: ShopCat; name: string; have: number; price: number }
export interface ShopRead { gold: number | null; items: ShopItem[] }
export interface ShopOrder { cat: ShopCat; name: string; qty: number; unitPrice: number; total: number }
export interface KitLine { cat: ShopCat; name: string; target: number }
export interface Kit { id: string; name: string; lines: KitLine[] }
export interface ShopLine { order: ShopOrder; fits: boolean }

/** Só estes itens (categoria + nome exato) podem ser comprados; o resto da leitura é exibido como "não suportado". */
export const isCatalogItem = (cat: ShopCat, name: string) => SHOP_CATALOG[cat].includes(name);
export const isShopCat = (value: unknown): value is ShopCat => typeof value === 'string' && (SHOP_CATS as readonly string[]).includes(value);
export const isShopName = (value: unknown): value is string => typeof value === 'string' && SHOP_NAME.test(value);
const whole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** "você tem ×10.137" -> 10137; "1.500/un." -> 1500; "56.140.570" -> 56140570. null se não houver número legível. */
export function parseShopNumber(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const m = /\d[\d.,]*/.exec(input.slice(0, 80));
  if (!m) return null;
  const digits = m[0].replace(/[.,]+$/, '');
  const value = /^\d{1,3}([.,]\d{3})+$/.test(digits) ? Number(digits.replace(/[.,]/g, '')) : parsePtNumber(digits);
  return value !== null && Number.isFinite(value) && value >= 0 && value <= MAX_GOLD ? Math.floor(value) : null;
}

export const orderTotal = (qty: number, unitPrice: number) => qty * unitPrice;

/** Só o que falta para chegar à meta de cada linha; ignora itens que a leitura não mostra, linhas já completas e limita a 9999 por linha. */
export function planRestock(items: readonly ShopItem[], lines: readonly KitLine[]): ShopOrder[] {
  const plan: ShopOrder[] = [];
  for (const line of lines) {
    const item = items.find(i => i.cat === line.cat && i.name === line.name);
    if (!item || !isCatalogItem(item.cat, item.name) || !whole(item.price, 1, MAX_UNIT_PRICE) || !whole(line.target, 1, 1e9)) continue;
    const qty = Math.min(MAX_QTY, Math.max(0, line.target - item.have));
    if (qty > 0) plan.push({cat: item.cat, name: item.name, qty, unitPrice: item.price, total: orderTotal(qty, item.price)});
  }
  return plan;
}

export const planTotal = (plan: readonly ShopOrder[]) => plan.reduce((sum, o) => sum + o.total, 0);
export const affordable = (plan: readonly ShopOrder[], gold: number | null) => gold !== null && planTotal(plan) <= gold;
/** Em ordem: cada linha só "cabe" se o ouro que sobra depois das anteriores que couberam cobre o total dela. */
export function fitPlan(plan: readonly ShopOrder[], gold: number | null): ShopLine[] {
  let left = gold ?? 0;
  return plan.map(order => { const fits = gold !== null && order.total <= left; if (fits) left -= order.total; return {order, fits}; });
}

/** Valida um pedido vindo de fora (renderer). `total` é opcional; se presente deve ser qty*preço. */
export function parseOrder(raw: unknown): ShopOrder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isShopCat(o.cat) || !isShopName(o.name) || !whole(o.qty, 1, MAX_QTY) || !whole(o.unitPrice, 1, MAX_UNIT_PRICE)) return null;
  const total = orderTotal(o.qty, o.unitPrice);
  if (o.total !== undefined && o.total !== total) return null;
  return {cat: o.cat, name: o.name, qty: o.qty, unitPrice: o.unitPrice, total};
}

// ---- Kits (localStorage `pokehub.kits`, validados na leitura) ----
export const KITS_KEY = 'pokehub.kits', MAX_KITS = 12, MAX_KIT_LINES = 12;
export function parseKits(raw: unknown): Kit[] {
  if (!Array.isArray(raw)) return [];
  const kits: Kit[] = [], ids = new Set<string>();
  for (const k of raw.slice(0, MAX_KITS)) {
    if (typeof k !== 'object' || k === null) continue;
    const r = k as Record<string, unknown>, name = typeof r.name === 'string' ? r.name.trim() : '';
    if (typeof r.id !== 'string' || !/^[\w-]{1,40}$/.test(r.id) || ids.has(r.id) || !name || name.length > 32 || !Array.isArray(r.lines)) continue;
    const lines: KitLine[] = [];
    for (const l of r.lines.slice(0, MAX_KIT_LINES)) {
      if (typeof l !== 'object' || l === null) continue;
      const x = l as Record<string, unknown>;
      if (isShopCat(x.cat) && isShopName(x.name) && whole(x.target, 1, 1e6) && !lines.some(y => y.cat === x.cat && y.name === x.name)) lines.push({cat: x.cat, name: x.name, target: x.target});
    }
    ids.add(r.id); kits.push({id: r.id, name, lines});
  }
  return kits;
}
export function loadKits(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Kit[] {
  try { return parseKits(JSON.parse(storage?.getItem(KITS_KEY) ?? 'null')); } catch { return []; }
}
export function saveKits(kits: readonly Kit[], storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
  try { storage?.setItem(KITS_KEY, JSON.stringify(kits)); } catch { /* sem armazenamento: os kits só não persistem */ }
}

// ---- Execução (processo principal -> renderer) ----
export interface ShopPlanEntry { id: string; lines: ShopOrder[] }
export interface ShopLineResult { profileId: string; order: ShopOrder; ok: boolean; bought?: number; spent?: number | null; error?: string }
export type ShopProgress =
  | {kind: 'line'; profileId: string; line: number; name: string; qty: number; status: 'buying' | 'ok' | 'error' | 'skipped'; bought?: number; spent?: number | null; error?: string}
  | {kind: 'done'; stopped: boolean};
