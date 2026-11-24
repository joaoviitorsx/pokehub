/*
 * Vitrine do RMT a cada 5 s (10 s no Modo leve), em cada conta pronta com o Mercado da Comunidade aberto (mesmo script constante
 * da lateral Mercado). Duas coisas saem da mesma leitura:
 *  - selos de custo-benefício nos cards (só com a opção ligada e a janela do PokéHub à vista);
 *  - alertas do usuário: anúncio que casa com uma regra avisa uma vez (notificação + lista na lateral) e ganha o selo de sino.
 *    Os alertas rodam também com a janela na bandeja, mas só enxergam o que o RMT aberto mostra. Não clica em nada.
 */
import { accumulate, accumulated, sessionKey, type MarketAccumulator } from '../domain/market-session';
import { badgeScript, badgesFor } from '../domain/market-badges';
import { hitKey, matches, type MarketAlert, type MarketAlertHit } from '../domain/market-alerts';
import type { MarketListing } from '../domain/market';
import { MARKET_SCAN_SCRIPT, sanitizeMarketScan, type MarketTarget } from './market-scan';
import { atGame, timed } from './hunt-snapshot';

export const BADGE_INTERVAL_MS = 5_000, BADGE_LITE_INTERVAL_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 4_000;
const SEEN_TTL_MS = 6 * 60 * 60_000; // o mesmo anúncio não avisa de novo por 6 h
const MAX_SEEN = 5_000;
export interface BadgeDeps {
  known: () => string[];
  target: (id: string) => MarketTarget | null;
  enabled: () => boolean;
  lite: () => boolean;
  /** Janela do PokéHub à vista (ninguém vê selos com ela na bandeja ou minimizada). */
  visible: () => boolean;
  alerts?: () => MarketAlert[];
  onHit?: (hits: MarketAlertHit[]) => void;
}
export function createMarketBadges(deps: BadgeDeps) {
  const accs = new Map<string, MarketAccumulator>();
  const applied = new Set<string>(); // contas com selos (ou CSS) na página: precisam de limpeza ao desligar
  const seen = new Map<string, number>(); // hitKey → quando avisou
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false, tickNo = 0;
  const closedSince = new Map<string, number>(); // conta → ciclo em que o RMT foi visto fechado (lê de novo a cada 3 ciclos)
  const fresh = (key: string, now: number) => { const at = seen.get(key); return at === undefined || now - at > SEEN_TTL_MS; };
  function prune(now: number) {
    if (seen.size <= MAX_SEEN) return;
    for (const [key, at] of seen) if (now - at > SEEN_TTL_MS || seen.size > MAX_SEEN) seen.delete(key);
  }
  async function tickAccount(id: string, badges: boolean, alerts: MarketAlert[]) {
    const target = deps.target(id);
    if (!target || !atGame(target.url)) return;
    if (!badges && !alerts.length) {
      if (applied.has(id)) { await timed(target.run(badgeScript([],false)),SCRIPT_TIMEOUT_MS).catch(() => undefined); applied.delete(id); }
      accs.delete(id);
      return;
    }
    const closedAt = closedSince.get(id);
    if (closedAt !== undefined && (tickNo - closedAt) % 3 !== 0) return; // RMT fechado: confere com menos frequência
    const scan = sanitizeMarketScan(await timed(target.run(MARKET_SCAN_SCRIPT),SCRIPT_TIMEOUT_MS).catch(() => null));
    if (!scan || !scan.open) { if (closedAt === undefined) closedSince.set(id,tickNo); return; }
    closedSince.delete(id);
    const now = Date.now(), acc = accumulate(accs.get(id) ?? null,sessionKey(id,scan.query),scan,now);
    accs.set(id,acc);
    const alerted = (listing: MarketListing) => alerts.some(alert => matches(alert,listing));
    if (alerts.length) {
      const hits: MarketAlertHit[] = [];
      for (const listing of scan.listings) for (const alert of alerts) {
        if (!matches(alert,listing)) continue;
        const key = hitKey(alert,listing);
        if (!fresh(key,now)) continue;
        seen.set(key,now);
        hits.push({alertId:alert.id, profileId:id, listing, em:new Date(now).toISOString()});
      }
      prune(now);
      if (hits.length) deps.onHit?.(hits);
    }
    if (badges) { await timed(target.run(badgeScript(badgesFor(scan,accumulated(acc,now),alerted),true)),SCRIPT_TIMEOUT_MS).catch(() => undefined); applied.add(id); }
    else if (applied.has(id)) { await timed(target.run(badgeScript([],false)),SCRIPT_TIMEOUT_MS).catch(() => undefined); applied.delete(id); }
  }
  async function tick() {
    if (running || stopped) return;
    running = true; tickNo++;
    try {
      const alerts = (deps.alerts?.() ?? []).filter(alert => alert.ativo);
      const badges = deps.enabled();
      if (badges && !alerts.length && !deps.visible()) return; // escondida e sem alertas: nada a fazer (os selos ficam como estão)
      const ids = deps.known();
      for (const id of [...accs.keys()]) if (!ids.includes(id)) accs.delete(id);
      if (!badges && !alerts.length && !applied.size) return;
      for (const id of ids) { if (stopped) return; try { await tickAccount(id,badges,alerts); } catch { /* conta fechando: tenta no próximo ciclo */ } }
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(),deps.lite() ? BADGE_LITE_INTERVAL_MS : BADGE_INTERVAL_MS);
    }
  }
  return {
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(() => void tick(),BADGE_INTERVAL_MS); },
    /** Liga/desliga ou mudou um alerta: aplica já, sem esperar o próximo ciclo. */
    refresh() { closedSince.clear(); clearTimeout(timer); void tick(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
