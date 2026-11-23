// Leitura que o celular enxerga: reaproveita as funções do hub (hunt, mercado, diagnóstico) sem duplicar lógica.
// Nada de caminhos, tokens ou chaves; só dados já mostrados na tela do PC.
import { freemem, totalmem } from 'node:os';
import { rankDeals, type MarketFocus, type MarketScan } from '../domain/market';
import { accumulate, accumulated, sessionKey, sessionStats, type MarketAccumulator } from '../domain/market-session';
import { MARKET_UNAVAILABLE, type MarketResult } from '../electron/market-scan';
import type { RemoteAccount, RemoteApi } from './server';

export interface ApiDeps {
  profiles(): readonly {id: string; label: string; colorToken: string}[];
  states: ReadonlyMap<string, string>; suspended: ReadonlySet<string>;
  hunt(id: string, soLiberadas: boolean): Promise<unknown>;
  scan(id: string): Promise<MarketResult>;
  processes(): unknown;
  now?: () => number;
}
export function createRemoteApi(deps: ApiDeps) {
  const now = deps.now ?? Date.now, accs = new Map<string, MarketAccumulator>();
  /** Chamado a cada página lida (pela leitura assistida ou por "Analisar" no PC): o ranking do celular usa o mesmo acúmulo. */
  const feed = (profileId: string, scan: MarketScan) => { if (scan.open) accs.set(profileId, accumulate(accs.get(profileId) ?? null, sessionKey(profileId, scan.query), scan, now())); };
  const accounts = (): RemoteAccount[] => deps.profiles().map(p => ({id: p.id, label: p.label, color: p.colorToken, state: deps.states.get(p.id) ?? 'loading', suspended: deps.suspended.has(p.id)}));
  const api: RemoteApi = {
    accounts,
    hunt: (id, soLiberadas) => deps.hunt(id, soLiberadas),
    async market(id, focus) {
      const live = await deps.scan(id);
      if (live.ok) feed(id, live.data);
      const acc = accs.get(id) ?? null, at = now(), listings = accumulated(acc, at);
      if (!listings.length) return {estado: 'indisponivel', erro: MARKET_UNAVAILABLE};
      const stats = sessionStats(acc, at, live.ok ? live.data.pages : null);
      return {estado: 'ok', fonte: live.ok && stats.pagesSeen <= 1 ? 'pagina' : 'acumulado', query: live.ok ? live.data.query : '', anuncios: stats.listings, paginasLidas: stats.pagesSeen, paginas: stats.pages,
        ofertas: rankDeals(listings, {focus: focus as MarketFocus}).slice(0, 30)};
    },
    diag: () => ({...(deps.processes() as object), host: {totalKb: Math.round(totalmem() / 1024), freeKb: Math.round(freemem() / 1024)}}),
  };
  return {api, feed};
}
