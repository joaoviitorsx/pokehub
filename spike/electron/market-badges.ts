/*
 * Selos de custo-benefício dentro do RMT: a cada 5 s (10 s no Modo leve), com a janela do PokéHub à vista, lê a vitrine de cada
 * conta pronta (mesmo script constante da lateral Mercado) e, se o Mercado da Comunidade está aberto, pontua os cards contra tudo
 * o que já foi visto na mesma busca e põe um selo pequeno em cada card. Com a opção desligada, remove os selos. Não clica em nada.
 */
import { accumulate, accumulated, sessionKey, type MarketAccumulator } from '../domain/market-session';
import { badgeScript, badgesFor } from '../domain/market-badges';
import { MARKET_SCAN_SCRIPT, sanitizeMarketScan, type MarketTarget } from './market-scan';
import { atGame, timed } from './hunt-snapshot';

export const BADGE_INTERVAL_MS = 5_000, BADGE_LITE_INTERVAL_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 4_000;
export interface BadgeDeps {
  known: () => string[];
  target: (id: string) => MarketTarget | null;
  enabled: () => boolean;
  lite: () => boolean;
  /** Janela do PokéHub à vista (ninguém vê selos com ela na bandeja ou minimizada). */
  visible: () => boolean;
}
export function createMarketBadges(deps: BadgeDeps) {
  const accs = new Map<string, MarketAccumulator>();
  const applied = new Set<string>(); // contas com selos (ou CSS) na página: precisam de limpeza ao desligar
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false;
  async function tickAccount(id: string, enabled: boolean) {
    const target = deps.target(id);
    if (!target || !atGame(target.url)) return;
    if (!enabled) {
      if (applied.has(id)) { await timed(target.run(badgeScript([],false)),SCRIPT_TIMEOUT_MS).catch(() => undefined); applied.delete(id); }
      accs.delete(id);
      return;
    }
    const scan = sanitizeMarketScan(await timed(target.run(MARKET_SCAN_SCRIPT),SCRIPT_TIMEOUT_MS).catch(() => null));
    if (!scan || !scan.open) return;
    const now = Date.now(), acc = accumulate(accs.get(id) ?? null,sessionKey(id,scan.query),scan,now);
    accs.set(id,acc);
    await timed(target.run(badgeScript(badgesFor(scan,accumulated(acc,now)),true)),SCRIPT_TIMEOUT_MS).catch(() => undefined);
    applied.add(id);
  }
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const enabled = deps.enabled();
      const ids = deps.known();
      for (const id of [...accs.keys()]) if (!ids.includes(id)) accs.delete(id);
      if (enabled && !deps.visible()) return;
      for (const id of ids) { if (stopped) return; try { await tickAccount(id,enabled); } catch { /* conta fechando: tenta no próximo ciclo */ } }
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(),deps.lite() ? BADGE_LITE_INTERVAL_MS : BADGE_INTERVAL_MS);
    }
  }
  return {
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(() => void tick(),BADGE_INTERVAL_MS); },
    /** Liga/desliga: aplica (ou limpa) já, sem esperar o próximo ciclo. */
    refresh() { clearTimeout(timer); void tick(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
