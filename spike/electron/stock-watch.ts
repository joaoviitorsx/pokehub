/*
 * Reposição assistida: a cada 3 min (6 min no Modo leve) lê o estoque de cada conta pelo barramento da /hunt (sem abrir o
 * Market, sem clicar) e avisa UMA vez quando uma categoria cai abaixo do mínimo; volta a poder avisar quando o estoque sobe 20%
 * acima do mínimo. O aviso só leva até a Loja: comprar continua exigindo "Confirmar compra".
 */
import { lowCats, recovered, sanitizeStock, STOCK_SCRIPT, type StockRead, type StockRules } from '../domain/stock';
import type { ShopCat } from '../domain/shop';
import { timed, type HuntTarget } from './hunt-snapshot';

export const STOCK_INTERVAL_MS = 3 * 60_000, STOCK_LITE_INTERVAL_MS = 6 * 60_000;
export interface StockEntry { stock: StockRead; low: ShopCat[]; at: number }
export interface StockDeps {
  known: () => {id: string; label: string}[];
  target: (id: string) => HuntTarget | null;
  rules: () => StockRules;
  lite: () => boolean;
  notify: (profileId: string, label: string, stock: StockRead, low: ShopCat[]) => void;
  emit: (all: Record<string, StockEntry>) => void;
}
export function createStockWatch(deps: StockDeps) {
  const current: Record<string, StockEntry> = {};
  const warned = new Map<string, Set<ShopCat>>(); // conta → categorias já avisadas (até recuperar)
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false, lastSig = '';
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const rules = deps.rules(), contas = deps.known();
      for (const id of Object.keys(current)) if (!contas.some(c => c.id === id)) { delete current[id]; warned.delete(id); }
      for (const conta of contas) {
        if (stopped) return;
        const target = deps.target(conta.id);
        if (!target || !target.hasExtension) continue;
        const stock = sanitizeStock(await timed(target.run(STOCK_SCRIPT), 5_000).catch(() => null));
        if (!stock) continue;
        const low = lowCats(stock, rules);
        current[conta.id] = {stock, low, at: Date.now()};
        const sent = warned.get(conta.id) ?? new Set<ShopCat>();
        for (const cat of [...sent]) if (recovered(stock, rules, cat)) sent.delete(cat);
        const fresh = low.filter(cat => !sent.has(cat));
        if (fresh.length) { fresh.forEach(cat => sent.add(cat)); deps.notify(conta.id, conta.label, stock, low); }
        warned.set(conta.id, sent);
      }
      const sig = JSON.stringify(Object.entries(current).map(([id, e]) => [id, e.stock, e.low]));
      if (sig !== lastSig) { lastSig = sig; deps.emit({...current}); }
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(), deps.lite() ? STOCK_LITE_INTERVAL_MS : STOCK_INTERVAL_MS);
    }
  }
  return {
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(() => void tick(), 60_000); },
    refresh() { clearTimeout(timer); void tick(); },
    stop() { stopped = true; clearTimeout(timer); },
    all: () => ({...current}),
  };
}
