/*
 * Reposição AUTOMÁTICA (opcional, ligada pelo usuário na Loja): quando o vigia de estoque vê uma categoria abaixo do mínimo,
 * lê o Market da conta, planeja só o que falta para as metas do kit escolhido (apenas nas categorias baixas) e compra sem pedir
 * "Confirmar compra". Limites: só itens do catálogo, só ouro, no máximo `autoMax` de ouro por reposição, nunca mais que o ouro
 * que a conta tem, e uma reposição por vez (a Loja e a leitura do Market usam a mesma trava por conta).
 */
import { fitPlan, planRestock, type ShopCat, type ShopLineResult, type ShopOrder, type ShopRead } from '../domain/shop';
import type { StockRules } from '../domain/stock';

export interface AutoShop {
  read(id: string): Promise<{ok: true; data: ShopRead} | {ok: false; error: string}>;
  run(plan: unknown): Promise<{ok: true; data: ShopLineResult[]} | {ok: false; error: string}>;
}
export type AutoOutcome = {kind: 'bought'; orders: ShopOrder[]; spent: number; failed: number} | {kind: 'nothing'; why: string} | {kind: 'error'; error: string};

/** Plano da reposição automática: linhas do kit das categorias baixas, que cabem no ouro e, somadas, no teto `autoMax`. */
export function planAuto(read: ShopRead, rules: StockRules, low: readonly ShopCat[]): ShopOrder[] {
  const lines = rules.autoKit.filter(l => low.includes(l.cat));
  let budget = rules.autoMax;
  return fitPlan(planRestock(read.items, lines), read.gold).filter(l => l.fits).map(l => l.order).filter(o => { if (o.total > budget) return false; budget -= o.total; return true; });
}

export async function autoRestock(shop: AutoShop, id: string, rules: StockRules, low: readonly ShopCat[]): Promise<AutoOutcome> {
  if (!rules.auto || !rules.autoKit.length) return {kind: 'nothing', why: 'Reposição automática desligada.'};
  if (!rules.autoKit.some(l => low.includes(l.cat))) return {kind: 'nothing', why: 'O kit da reposição não tem itens dessa categoria.'};
  const read = await shop.read(id).catch(() => ({ok: false as const, error: 'Não foi possível acessar o Market desta conta.'}));
  if (!read.ok) return {kind: 'error', error: read.error};
  const orders = planAuto(read.data, rules, low);
  if (!orders.length) return {kind: 'nothing', why: read.data.gold === null ? 'Ouro ilegível no Market.' : 'Sem ouro suficiente (ou acima do limite por reposição) para as metas do kit.'};
  const r = await shop.run([{id, lines: orders}]).catch(() => ({ok: false as const, error: 'Falha ao comprar.'}));
  if (!r.ok) return {kind: 'error', error: r.error};
  const ok = r.data.filter(x => x.ok);
  return {kind: 'bought', orders: ok.map(x => ({...x.order, qty: x.bought ?? x.order.qty})), spent: ok.reduce((s, x) => s + (x.spent ?? x.order.total), 0), failed: r.data.length - ok.length};
}
