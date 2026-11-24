// Reposição assistida: estoque das pokébolas, poções e revives que a automação do jogo USA, lido do estado do jogo (via /hunt),
// sem abrir o Market. Avisa quando uma categoria cai abaixo do mínimo; a compra continua sendo da Loja, com confirmação.
import { isShopCat, isShopName, MAX_KIT_LINES, type KitLine, type ShopCat } from './shop';

export const STOCK_CATS: readonly ShopCat[] = ['Pokebolas', 'Poções', 'Revives'];
export interface StockCat { total: number; /** só pokébolas têm nome no catálogo do jogo */ itens: {nome: string; qtd: number}[] }
export interface StockRead { gold: number | null; cats: Record<ShopCat, StockCat> }
/**
 * `auto`: repõe sozinho, sem "Confirmar compra", quando uma categoria cai abaixo do mínimo (opcional, desligado por padrão).
 * Compra só as linhas de `autoKit` das categorias que ficaram baixas, só o que falta para a meta, e no máximo `autoMax` de ouro por reposição.
 */
export interface StockRules { on: boolean; min: Record<ShopCat, number>; auto: boolean; autoKit: KitLine[]; autoMax: number }
export const DEFAULT_AUTO_MAX = 5_000_000, MAX_AUTO_MAX = 1e12;
export const DEFAULT_STOCK_RULES: StockRules = {on: true, min: {Pokebolas: 300, Poções: 100, Revives: 20}, auto: false, autoKit: [], autoMax: DEFAULT_AUTO_MAX};
/** Sai do "baixo" só com folga (20% acima do mínimo), para não avisar de novo a cada pokébola lançada. */
export const STOCK_HYSTERESIS = 1.2;

/**
 * Script fixo (mundo da página, barramento da /hunt): lê `estado.balls/items/gold` e os ids que a automação do jogo usa
 * (`automation.ballIds/potionIds/reviveIds`); nomes das pokébolas pelo `catalogoBolas` do `welcome`. Não clica, não escreve.
 */
export const STOCK_SCRIPT = `(() => {
  const P = globalThis.__pokeidleHunt;
  if (!P || typeof P.on !== 'function') return null;
  const ultimo = (t) => { let v = null; const s = P.on(t, (d) => { v = d; }); if (typeof s === 'function') s(); return v; };
  const eu = ultimo('estado'), w = ultimo('welcome');
  if (!eu || !eu.automation) return null;
  const a = eu.automation, balls = eu.balls || {}, items = eu.items || {};
  const nomes = {}; (w && Array.isArray(w.catalogoBolas) ? w.catalogoBolas : []).forEach((b) => { if (b && b.compravel) nomes[b.id] = String(b.nome || '').slice(0, 32); });
  const ids = (l) => (Array.isArray(l) ? l : []).slice(0, 20).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const bolas = ids(a.ballIds).filter((id) => nomes[id]).map((id) => ({nome: nomes[id], qtd: Number(balls[id]) || 0}));
  const soma = (l, src) => ids(l).reduce((s, id) => s + (Number(src[id]) || 0), 0);
  return {gold: Number(eu.gold), bolas, pocoes: soma(a.potionIds, items), revives: soma(a.reviveIds, items), usaPocao: a.autoPotion === true, usaRevive: a.autoRevive === true};
})()`;

const qty = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 ? Math.floor(v) : null;
/** Valida o retorno da página. Pokébolas não compráveis (ex.: Beast Ball) ficam de fora: não há como repor no Market. */
export function sanitizeStock(raw: unknown): StockRead | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const bolas = (Array.isArray(r.bolas) ? r.bolas.slice(0, 10) : []).flatMap(b => {
    if (!b || typeof b !== 'object') return [];
    const x = b as Record<string, unknown>, nome = typeof x.nome === 'string' ? x.nome.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '', n = qty(x.qtd);
    return nome && nome.length <= 32 && n !== null ? [{nome, qtd: n}] : [];
  });
  const pocoes = qty(r.pocoes), revives = qty(r.revives);
  if (pocoes === null || revives === null) return null;
  return {gold: qty(r.gold), cats: {
    Pokebolas: {total: bolas.reduce((s, b) => s + b.qtd, 0), itens: bolas},
    Poções: {total: pocoes, itens: []},
    Revives: {total: revives, itens: []},
  }};
}
export function sanitizeRules(raw: unknown): StockRules {
  if (!raw || typeof raw !== 'object') return DEFAULT_STOCK_RULES;
  const r = raw as Record<string, unknown>, min = (r.min && typeof r.min === 'object' ? r.min : {}) as Record<string, unknown>;
  const pick = (cat: ShopCat) => { const v = min[cat]; return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : DEFAULT_STOCK_RULES.min[cat]; };
  const autoKit: KitLine[] = [];
  for (const l of Array.isArray(r.autoKit) ? r.autoKit.slice(0, MAX_KIT_LINES) : []) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    if (isShopCat(x.cat) && isShopName(x.name) && typeof x.target === 'number' && Number.isInteger(x.target) && x.target >= 1 && x.target <= 1e6 && !autoKit.some(y => y.cat === x.cat && y.name === x.name)) autoKit.push({cat: x.cat, name: x.name, target: x.target});
  }
  const max = r.autoMax, autoMax = typeof max === 'number' && Number.isInteger(max) && max >= 1 && max <= MAX_AUTO_MAX ? max : DEFAULT_AUTO_MAX;
  // sem kit não há o que comprar: a automática só fica ligada com pelo menos uma linha
  return {on: r.on !== false, min: {Pokebolas: pick('Pokebolas'), Poções: pick('Poções'), Revives: pick('Revives')}, auto: r.auto === true && autoKit.length > 0, autoKit, autoMax};
}
/** Categorias abaixo do mínimo (mínimo 0 = não vigiar). */
export const lowCats = (stock: StockRead, rules: StockRules): ShopCat[] => rules.on ? STOCK_CATS.filter(cat => rules.min[cat] > 0 && stock.cats[cat].total < rules.min[cat]) : [];
/** Já saiu do "baixo" com folga? (então pode avisar de novo da próxima vez) */
export const recovered = (stock: StockRead, rules: StockRules, cat: ShopCat) => stock.cats[cat].total >= rules.min[cat] * STOCK_HYSTERESIS;
export const catLabel: Record<ShopCat, string> = {Pokebolas: 'Pokébolas', Poções: 'Poções', Revives: 'Revives'};
/** Texto do aviso: "Pokébolas: restam 33 (mínimo 300) · Revives: restam 4 (mínimo 20)". */
export function lowText(stock: StockRead, cats: readonly ShopCat[], rules: StockRules): string {
  return cats.map(cat => `${catLabel[cat]}: restam ${stock.cats[cat].total.toLocaleString('pt-BR')} (mínimo ${rules.min[cat].toLocaleString('pt-BR')})`).join(' · ');
}
