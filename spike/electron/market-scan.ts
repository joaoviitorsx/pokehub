import { parsePtNumber, type MarketCurrency, type MarketListing, type MarketScan, type SmartLabel } from '../domain/market';
import { atGame, isRecord, text, timed } from './hunt-snapshot';

export const MARKET_UNAVAILABLE = 'Abra o Mercado nesta conta para analisar os anúncios.';
const MAX_CARDS = 60, MAX_STR = 120;

// Código fixo executado na página do jogo: nunca recebe dado do renderer. Só LÊ o DOM do Mercado que o usuário já abriu
// (nenhum clique, escrita, rede, cookie ou storage). Seletores conferidos no jogo em 2026-11-23 (vitrine do RMT, v1.474).
export const MARKET_SCAN_SCRIPT = `(() => {
  const S = (v) => String(v == null ? '' : v).replace(/\\s+/g, ' ').trim().slice(0, ${MAX_STR});
  const lista = document.querySelector('#cm-lista');
  const open = !!lista && lista.getClientRects().length > 0;
  if (!open) return {open:false, cards:[]};
  const all = Array.from(lista.querySelectorAll(':scope > .cm-card'));
  const poke = all.filter((c) => c.classList.contains('poke'));
  const cards = (poke.length ? poke : all.filter((c) => c.querySelector('.cm-nome-txt'))).slice(0, ${MAX_CARDS});
  const txt = (c, sel) => { const e = c.querySelector(sel); return e ? S(e.textContent) : ''; };
  const cn = (x) => (typeof x.className === 'string' ? x.className : '');
  const meta = (e) => e ? S([cn(e), e.getAttribute('alt'), e.getAttribute('title')].join(' ') + ' ' + Array.from(e.querySelectorAll('*')).slice(0, 8).map((x) => cn(x) + ' ' + (x.getAttribute('alt') || '') + ' ' + (x.getAttribute('title') || '')).join(' ')) : '';
  return {open:true, cards: cards.map((c) => {
    const fav = c.querySelector('button.cm-fav'), preco = c.querySelector('.cm-rodape > .cm-preco') || c.querySelector('.cm-preco'), vit = c.querySelector('.pp-vit');
    return {
      id: fav ? S(fav.getAttribute('data-fav')) : '', cls: S(cn(c)),
      name: txt(c, '.cm-nome-txt'), sub: txt(c, '.cm-sub'), pot: txt(c, '.cm-pot'), nota: txt(c, '.pk-selo-n'),
      shiny: /shiny/i.test(cn(c)) || /✨/.test(c.textContent || ''),
      preco: preco ? S(preco.textContent) : '', moeda: S(meta(preco) + ' ' + meta(c.querySelector('.cm-rodape'))),
      smartCls: vit ? S(cn(vit)) : '', smartText: vit ? S(vit.textContent) : '',
    };
  })};
})()`;

const str = (value: unknown): string => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, MAX_STR) : '';
function currencyOf(hint: string): MarketCurrency | null {
  const orb = /orb|gema|\bgem\b/i.test(hint), gold = /gold|coin|ouro/i.test(hint);
  return orb === gold ? null : orb ? 'orb' : 'gold';
}
function smartOf(cls: string, body: string): MarketListing['smart'] {
  const label: SmartLabel | null = /pp-vit-pechincha/.test(cls) ? 'desconto' : /pp-vit-justo/.test(cls) ? 'no preço' : /pp-vit-caro/.test(cls) ? 'acima' : null;
  if (!label) return null;
  const m = /([+\-−–]?)\s*(\d{1,4}(?:[.,]\d+)?)\s*%/.exec(body);
  let pct: number | null = null;
  if (m) {
    const n = parsePtNumber(m[2]!);
    if (n !== null && n <= 1000) pct = m[1] ? (m[1] === '+' ? n : -n) : label === 'desconto' ? -n : n;
  }
  const mk = /mercado\s*:?\s*(\d[\d.,]*\s*[kmb]?)/i.exec(body);
  return {label, pct, market: mk ? parsePtNumber(mk[1]!) : null};
}
/** Converte o retorno bruto da página (remota, não confiável) em anúncios válidos; linhas malformadas são descartadas. */
export function sanitizeMarketScan(raw: unknown): MarketScan | null {
  if (!isRecord(raw) || typeof raw.open !== 'boolean') return null;
  if (!raw.open) return {open: false, listings: [], smart: false};
  if (!Array.isArray(raw.cards)) return null;
  const listings = raw.cards.slice(0, MAX_CARDS).flatMap((card): MarketListing[] => {
    if (!isRecord(card)) return [];
    const name = text(str(card.name), 80), price = parsePtNumber(str(card.preco).replace(/[^\d.,kmbKMB+-]/g, ''));
    if (name === null || price === null || price <= 0 || price > 1e15) return [];
    const idText = str(card.id), lv = /\d{1,3}(?:\.\d{3})*|\d{1,6}/.exec(str(card.sub)) /* "Nv 1.793": ponto é milhar */, pot = /P\s*(\d)/i.exec(str(card.pot)), nota = parsePtNumber(str(card.nota).replace(/[^\d.,]/g, ''));
    const level = lv ? Number(lv[0].replace(/\./g, '')) : null, potencia = pot ? Number(pot[1]) : null;
    return [{
      id: /^[\w.:-]{1,40}$/.test(idText) ? idText : null, name, level: level !== null && level >= 1 ? level : null,
      potencia: potencia !== null && potencia >= 1 && potencia <= 5 ? potencia : null, nota: nota !== null && nota >= 0 && nota <= 10 ? nota : null,
      shiny: card.shiny === true, price, currency: currencyOf(`${str(card.moeda)} ${str(card.preco)}`), smart: smartOf(str(card.smartCls), str(card.smartText)),
    }];
  });
  return {open: true, listings, smart: listings.some(l => l.smart !== null)};
}

export interface MarketTarget { url: string; run(script: string): Promise<unknown> }
export type MarketResult = {ok: true; data: MarketScan} | {ok: false; error: string};
const fail: MarketResult = {ok: false, error: MARKET_UNAVAILABLE};
/** `target` devolve `null` quando a conta não tem sessão aberta e utilizável. Nunca lança. */
export async function marketScan(id: unknown, knownIds: readonly string[], target: (id: string) => MarketTarget | null, timeoutMs = 8000): Promise<MarketResult> {
  if (typeof id !== 'string' || !knownIds.includes(id)) return fail;
  try {
    const found = target(id);
    if (!found || !atGame(found.url)) return fail; // nunca executa em página de outro site (ex.: login do provedor)
    const data = sanitizeMarketScan(await timed(found.run(MARKET_SCAN_SCRIPT), timeoutMs));
    return data ? {ok: true, data} : fail;
  } catch { return fail; }
}
