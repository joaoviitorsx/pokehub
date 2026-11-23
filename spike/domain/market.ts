// Assistente de Mercado: classificação PURA de anúncios lidos da tela. Sem I/O. Nunca afirma certeza: a nota é uma heurística explicada.
export type MarketCurrency = 'orb' | 'gold';
export type SmartLabel = 'desconto' | 'no preço' | 'acima';
export interface MarketListing {
  id: string | null; name: string; level: number | null; potencia: number | null; nota: number | null; shiny: boolean;
  price: number; currency: MarketCurrency | null;
  smart: {label: SmartLabel; pct: number | null; market: number | null} | null;
}
/** `page`/`pages` vêm do rodapé "X de N" da vitrine; `query` é o texto da busca (vazio = sem busca). */
export interface MarketScan { open: boolean; listings: MarketListing[]; smart: boolean; page: number | null; pages: number | null; query: string }
export type MarketFocus = 'equilibrado' | 'qualidade' | 'desconto';
export interface DealOptions { currency?: MarketCurrency | null; minNota?: number; minPotencia?: number; minLevel?: number; shinyOnly?: boolean; focus: MarketFocus }
export interface Deal { listing: MarketListing; score: number; reasons: string[] }

const SUFFIX: Record<string, number> = {k: 1e3, m: 1e6, b: 1e9};
/** Número em formato pt-BR: "1,5 M", "12.345", "7,600" (=7,6), "350k". Retorna null se não der para ler. */
export function parsePtNumber(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const match = /^\s*([+-]?\d[\d.,]*)\s*([kmb])?\s*$/i.exec(input.slice(0, 60));
  if (!match) return null;
  const suffix = match[2]?.toLowerCase();
  let digits = match[1]!;
  if (digits.includes(',')) digits = digits.replace(/\./g, '').replace(',', '.');
  else if (!suffix && /^[+-]?\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, ''); // "12.345" = milhar
  if ((digits.match(/\./g) ?? []).length > 1) return null;
  const value = Number(digits) * (suffix ? SUFFIX[suffix]! : 1);
  return Number.isFinite(value) ? value : null;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const clamp = (value: number, low = 0, high = 1) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
const fmt = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',');

// Pesos de cada eixo por foco: [valor (qualidade ÷ preço), qualidade, desconto da Smart Market]. Sem selo, o eixo some e os pesos são renormalizados.
const WEIGHTS: Record<MarketFocus, [number, number, number]> = {equilibrado: [.5, .3, .2], qualidade: [.25, .65, .1], desconto: [.25, .15, .6]};
// Qualidade q = 0,9 · (Σ peso·componente / Σ peso dos componentes presentes) + 0,1 se shiny.
const Q = {nota: .5, potencia: .25, level: .15, shiny: .1};

/** Desconto em % (positivo = abaixo do mercado) a partir do selo da Smart Market, ou null. */
const discount = (l: MarketListing): number | null => l.smart && l.smart.pct !== null && Number.isFinite(l.smart.pct) ? -l.smart.pct : null;

function rankGroup(group: MarketListing[], focus: MarketFocus): Deal[] {
  const levels = group.flatMap(l => l.level !== null && l.level > 0 ? [Math.log(l.level)] : []);
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const quality = group.map(l => {
    let sum = 0, weight = 0;
    if (l.nota !== null) { sum += Q.nota * clamp(l.nota / 10); weight += Q.nota; }
    if (l.potencia !== null) { sum += Q.potencia * clamp(l.potencia / 5); weight += Q.potencia; }
    if (l.level !== null && l.level > 0) { sum += Q.level * (hi > lo ? clamp((Math.log(l.level) - lo) / (hi - lo)) : .5); weight += Q.level; }
    return clamp((weight > 0 ? sum / weight : .3) * .9 + (l.shiny ? Q.shiny : 0));
  });
  const medPrice = median(group.map(l => l.price)) || 1;
  const raw = group.map((l, i) => quality[i]! * (medPrice / l.price)); // qualidade por preço relativo à mediana
  const medRaw = median(raw);
  const noteRates = group.flatMap(l => l.nota !== null && l.nota > 0 ? [l.price / l.nota] : []), medRate = median(noteRates);
  const notes = group.flatMap(l => l.nota !== null ? [l.nota] : []);
  const [wv, wq, wd] = WEIGHTS[focus];
  return group.map((l, i): Deal => {
    const value = raw[i]! + medRaw > 0 ? raw[i]! / (raw[i]! + medRaw) : .5; // 0,5 = na mediana da vitrine
    const d = discount(l);
    const parts: [number, number][] = [[wv, value], [wq, quality[i]!]];
    if (d !== null) parts.push([wd, clamp(.5 + d / 60)]);
    const total = parts.reduce((s, [w]) => s + w, 0);
    const score = Math.round(clamp(parts.reduce((s, [w, x]) => s + w * x, 0) / total) * 1000) / 10;
    const reasons: string[] = [];
    if (d !== null) {
      const a = Math.abs(d), text = fmt(a, a % 1 ? 1 : 0);
      reasons.push(a < .5 ? 'No preço de mercado (Smart Market)' : d > 0 ? `${text}% abaixo do mercado (Smart Market)` : `${text}% acima do mercado (Smart Market)`);
    } else if (l.smart) reasons.push(l.smart.label === 'desconto' ? 'Abaixo do mercado (Smart Market)' : l.smart.label === 'acima' ? 'Acima do mercado (Smart Market)' : 'No preço de mercado (Smart Market)');
    if (l.nota !== null) {
      const above = notes.filter(n => n > l.nota!).length / notes.length;
      reasons.push(notes.length >= 5 && above < .1 ? `Nota ${fmt(l.nota)} — top 10% desta vitrine` : notes.length >= 5 && above < .25 ? `Nota ${fmt(l.nota)} — top 25% desta vitrine` : `Nota ${fmt(l.nota)}`);
    }
    if (l.potencia !== null) reasons.push(`P${l.potencia}`);
    if (l.shiny) reasons.push('Shiny');
    if (l.nota !== null && l.nota > 0 && medRate > 0 && noteRates.length >= 3) {
      const rel = 1 - l.price / l.nota / medRate;
      if (rel >= .1) reasons.push(`Preço por ponto de Nota ${Math.round(rel * 100)}% menor que a mediana`);
      else if (rel <= -.1) reasons.push(`Preço por ponto de Nota ${Math.round(-rel * 100)}% maior que a mediana`);
    }
    if (group.length < 3) reasons.push('Poucos anúncios para comparar: a posição é só indicativa');
    if (!reasons.length) reasons.push('Sem dados de qualidade na tela: pontuação só pelo preço');
    return {listing: l, score, reasons};
  });
}

/** Filtra e ordena. Compara só dentro da mesma moeda. Determinístico: empate → menor preço → nome → ordem original. */
export function rankDeals(listings: readonly MarketListing[], opts: DealOptions): Deal[] {
  const kept = listings.filter(l => Number.isFinite(l.price) && l.price > 0
    && (opts.currency == null || l.currency === opts.currency)
    && (!opts.minNota || (l.nota !== null && l.nota >= opts.minNota))
    && (!opts.minPotencia || (l.potencia !== null && l.potencia >= opts.minPotencia))
    && (!opts.minLevel || (l.level !== null && l.level >= opts.minLevel))
    && (!opts.shinyOnly || l.shiny));
  const groups = new Map<string, MarketListing[]>();
  for (const l of kept) groups.set(`${l.currency}`, [...(groups.get(`${l.currency}`) ?? []), l]);
  const order = new Map(kept.map((l, i) => [l, i]));
  return [...groups.values()].flatMap(group => rankGroup(group, opts.focus))
    .sort((a, b) => b.score - a.score || a.listing.price - b.listing.price || a.listing.name.localeCompare(b.listing.name, 'pt-BR') || order.get(a.listing)! - order.get(b.listing)!);
}
