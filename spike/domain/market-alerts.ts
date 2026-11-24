// Alertas de anúncio no RMT: regras do usuário conferidas contra a vitrine lida (só o que o RMT aberto mostra). Puro.
import type { MarketCurrency, MarketListing } from './market';
import { listingKey } from './market-session';

export const MAX_ALERTS = 20;
export interface MarketAlert {
  id: string;
  /** Parte do nome do Pokémon (sem acento, minúsculas); vazio = qualquer um. */
  nome: string;
  moeda: MarketCurrency | null;
  precoMax: number | null;
  notaMin: number | null;
  potenciaMin: number | null;
  soShiny: boolean;
  ativo: boolean;
}
export type MarketAlertInput = Omit<MarketAlert, 'id' | 'ativo'> & {ativo?: boolean};
/** Um anúncio que casou com um alerta, já com a conta onde o RMT estava aberto. */
export interface MarketAlertHit { alertId: string; profileId: string; listing: MarketListing; em: string }

export const normName = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const numOrNull = (value: unknown, min: number, max: number): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('Alerta inválido');
  return n;
};
/** Valida o que vem da interface. Precisa de pelo menos um critério (nome, preço, nota, potência ou shiny). */
export function sanitizeAlert(raw: unknown, id: string): MarketAlert {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Alerta inválido');
  const r = raw as Record<string, unknown>;
  const nome = typeof r.nome === 'string' ? normName(r.nome).slice(0, 40) : '';
  if (nome && !/^[\p{L}\p{N} .'’()-]+$/u.test(nome)) throw new Error('Alerta inválido');
  const moeda = r.moeda === 'orb' || r.moeda === 'gold' ? r.moeda : null;
  const alert: MarketAlert = {
    id, nome, moeda, precoMax: numOrNull(r.precoMax, 1, 1e15), notaMin: numOrNull(r.notaMin, 0, 10),
    potenciaMin: r.potenciaMin === null || r.potenciaMin === undefined || r.potenciaMin === '' ? null : Math.round(numOrNull(r.potenciaMin, 1, 5)!),
    soShiny: r.soShiny === true, ativo: r.ativo !== false,
  };
  if (alert.precoMax !== null && alert.moeda === null) throw new Error('Preço exige a moeda'); // Gemas e Coins não se comparam
  if (!alert.nome && alert.precoMax === null && alert.notaMin === null && alert.potenciaMin === null && !alert.soShiny) throw new Error('Alerta vazio');
  return alert;
}
/** O anúncio casa com o alerta? Critério ausente no anúncio (ex.: nota não lida) não casa quando o alerta exige. */
export function matches(alert: MarketAlert, listing: MarketListing): boolean {
  if (!alert.ativo) return false;
  if (alert.nome && !normName(listing.name).includes(alert.nome)) return false;
  if (alert.moeda && listing.currency !== alert.moeda) return false;
  if (alert.precoMax !== null && listing.price > alert.precoMax) return false;
  if (alert.notaMin !== null && (listing.nota === null || listing.nota < alert.notaMin)) return false;
  if (alert.potenciaMin !== null && (listing.potencia === null || listing.potencia < alert.potenciaMin)) return false;
  if (alert.soShiny && !listing.shiny) return false;
  return true;
}
/** Chave de "já avisei": o mesmo anúncio não avisa duas vezes pelo mesmo alerta. */
export const hitKey = (alert: MarketAlert, listing: MarketListing) => `${alert.id}|${listingKey(listing)}`;
/** Texto curto do alerta (lista da interface e notificação). */
export function alertLabel(alert: Pick<MarketAlert, 'nome' | 'moeda' | 'precoMax' | 'notaMin' | 'potenciaMin' | 'soShiny'>): string {
  const coin = alert.moeda === 'orb' ? ' Gemas' : alert.moeda === 'gold' ? ' Coins' : '';
  const parts = [
    alert.nome ? alert.nome.replace(/(^|\s)\p{L}/gu, s => s.toUpperCase()) : 'Qualquer Pokémon',
    alert.soShiny ? 'shiny' : '',
    alert.potenciaMin !== null ? `P${alert.potenciaMin}+` : '',
    alert.notaMin !== null ? `nota ≥ ${alert.notaMin.toLocaleString('pt-BR')}` : '',
    alert.precoMax !== null ? `até ${alert.precoMax.toLocaleString('pt-BR')}${coin}` : coin.trim() ? `em${coin}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
