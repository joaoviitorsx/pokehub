// Acúmulo de anúncios lidos de várias páginas da MESMA busca do Mercado. Puro: sem I/O nem relógio próprio (o chamador passa `now`).
import type { MarketListing, MarketScan } from './market';

export const SESSION_TTL_MS = 15 * 60_000;
export interface SessionEntry { listing: MarketListing; seenAt: number; page: number | null }
export interface MarketAccumulator { key: string; entries: Map<string, SessionEntry> }
export interface SessionStats { listings: number; pagesSeen: number; pages: number | null }

/** Chave da busca: conta + texto da busca (minúsculo, espaços colapsados). A moeda é filtro de exibição, não da chave: trocar de moeda não perde páginas lidas. */
export const sessionKey = (profileId: string, query: string): string => `${profileId}\u0000${query.replace(/\s+/g, ' ').trim().toLowerCase()}`;
/** Anúncio com id usa o id; sem id, nome+nível+preço+moeda. */
export const listingKey = (l: MarketListing): string => l.id !== null ? `id:${l.id}` : `n:${l.name.toLowerCase()}|${l.level}|${l.price}|${l.currency}`;

export const emptyAccumulator = (key: string): MarketAccumulator => ({key, entries: new Map()});
const alive = (entry: SessionEntry, now: number) => now - entry.seenAt <= SESSION_TTL_MS;

/** Soma uma leitura ao acúmulo. Busca diferente (chave nova) começa do zero; entradas com mais de 15 min caem; reler um anúncio atualiza preço e hora. */
export function accumulate(acc: MarketAccumulator | null, key: string, scan: MarketScan, now: number): MarketAccumulator {
  const entries = new Map<string, SessionEntry>();
  if (acc && acc.key === key) for (const [k, entry] of acc.entries) if (alive(entry, now)) entries.set(k, entry);
  if (scan.open) for (const listing of scan.listings) entries.set(listingKey(listing), {listing, seenAt: now, page: scan.page});
  return {key, entries};
}
/** Anúncios acumulados ainda válidos, na ordem de inserção. */
export const accumulated = (acc: MarketAccumulator | null, now: number): MarketListing[] => acc ? [...acc.entries.values()].filter(e => alive(e, now)).map(e => e.listing) : [];
export function sessionStats(acc: MarketAccumulator | null, now: number, pages: number | null): SessionStats {
  const live = acc ? [...acc.entries.values()].filter(e => alive(e, now)) : [];
  return {listings: live.length, pagesSeen: new Set(live.flatMap(e => e.page !== null ? [e.page] : [])).size, pages};
}

/** Evento `market:progress` da leitura assistida (main → renderer); `scan` é a página recém-lida, já sanitizada. */
export interface MarketProgress { profileId: string; page: number | null; pages: number | null; collected: number; done: boolean; error?: string; scan?: MarketScan }
