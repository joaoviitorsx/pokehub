// Selos de custo-benefício nos cards do Mercado da Comunidade (RMT), dentro da página do jogo. Puro: pontua e monta o script.
import { rankDeals, type MarketListing, type MarketScan } from './market';

export type BadgeTier = 'alto' | 'medio' | 'baixo';
/** Um selo por card da página atual: `id` do anúncio (ou nulo) + `name` e `index` para conferir o card quando não há id. */
export interface Badge { id: string | null; name: string; index: number; score: number; tier: BadgeTier; best: boolean; rank: number; total: number }
export const tierOf = (score: number): BadgeTier => score >= 66 ? 'alto' : score >= 33 ? 'medio' : 'baixo';

/**
 * Pontua os cards desta página comparando com tudo o que já foi visto na mesma busca (`pool`, que inclui a página).
 * Mesmo ranking da lateral no foco "Equilibrado", sem filtros. `best`: o 1º da busca inteira naquela moeda.
 */
export function badgesFor(scan: MarketScan, pool: readonly MarketListing[]): Badge[] {
  if (!scan.open || scan.listings.length === 0) return [];
  const deals = rankDeals(pool.length ? pool : scan.listings, {focus:'equilibrado'});
  const sameListing = (a: MarketListing, b: MarketListing) => a.id !== null && b.id !== null ? a.id === b.id : a.name === b.name && a.price === b.price && a.level === b.level && a.currency === b.currency;
  const byCurrency = new Map<string, number>();
  for (const deal of deals) byCurrency.set(`${deal.listing.currency}`, (byCurrency.get(`${deal.listing.currency}`) ?? 0) + 1);
  const rankIn = new Map<string, number>();
  const ranked = deals.map(deal => { const key = `${deal.listing.currency}`; const rank = (rankIn.get(key) ?? 0) + 1; rankIn.set(key, rank); return {deal, rank, total: byCurrency.get(key)!}; });
  return scan.listings.flatMap((listing, index): Badge[] => {
    const found = ranked.find(item => sameListing(item.deal.listing, listing));
    if (!found) return [];
    const score = Math.round(found.deal.score);
    return [{id: listing.id, name: listing.name, index, score, tier: tierOf(score), best: found.rank === 1 && found.total >= 3, rank: found.rank, total: found.total}];
  });
}

/** Só valores validados entram no script (JSON embutido): id curto, nome até 80, números inteiros pequenos. */
export function sanitizeBadges(badges: readonly Badge[]): Badge[] {
  return badges.slice(0, 60).flatMap(badge => {
    const ok = (badge.id === null || /^[\w.:-]{1,40}$/.test(badge.id)) && typeof badge.name === 'string' && badge.name.length > 0 && badge.name.length <= 80
      && Number.isInteger(badge.index) && badge.index >= 0 && badge.index < 60 && Number.isInteger(badge.score) && badge.score >= 0 && badge.score <= 100
      && (badge.tier === 'alto' || badge.tier === 'medio' || badge.tier === 'baixo') && typeof badge.best === 'boolean'
      && Number.isInteger(badge.rank) && badge.rank >= 1 && Number.isInteger(badge.total) && badge.total >= badge.rank && badge.total <= 100_000;
    return ok ? [{id:badge.id, name:badge.name, index:badge.index, score:badge.score, tier:badge.tier, best:badge.best, rank:badge.rank, total:badge.total}] : [];
  });
}

const CSS = `
.ph-selo{position:absolute;top:5px;left:5px;z-index:4;display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 6px 0 4px;border-radius:5px;
font:700 11px/18px Tahoma,Verdana,"Segoe UI",sans-serif;letter-spacing:.2px;color:#fff6ef;background:#231520e6;box-shadow:inset 0 0 0 1.5px #480e1e,0 2px 0 #0005;
pointer-events:none;white-space:nowrap;text-shadow:0 1px 0 #480e1e;animation:ph-selo-in .18s ease-out}
.ph-selo svg{width:11px;height:11px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ph-selo b{font-weight:800}
.ph-selo small{font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.9}
.ph-selo[data-t=alto]{color:#8ff0a8}.ph-selo[data-t=medio]{color:#ffe07a}.ph-selo[data-t=baixo]{color:#ff9a8c}
.ph-selo[data-best]{color:#4a3608;background:linear-gradient(#ffe07a,#fccb0f 60%,#e8a800);text-shadow:0 1px 0 #fff8;box-shadow:inset 0 0 0 1.5px #480e1e,0 2px 0 #0005,0 0 0 2px #fccb0f55}
.ph-selo.ph-compact{height:16px;padding:0 5px 0 3px;font-size:10px;line-height:16px;background:#231520cc}
.ph-selo.ph-compact small{display:none}
.ph-selo-pos{position:relative}
@keyframes ph-selo-in{from{opacity:0;transform:translateY(-2px)}}
@media (prefers-reduced-motion:reduce){.ph-selo{animation:none}}`;
const ICON_TAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h5l6 6-5 5-6-6zM5.3 5.3h.01"/></svg>';
const ICON_CROWN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5h10M3 10 2.5 4.5l3.2 2.8L8 3l2.3 4.3 3.2-2.8L13 10z"/></svg>';

/**
 * Script do mundo isolado: guarda os selos em `window.__phSelos` e os (re)aplica nos cards de `#cm-lista`, inclusive quando o jogo
 * redesenha a vitrine (MutationObserver). Só cria `span.ph-selo` dentro dos cards e um `<style id="ph-selo-css">`; não clica, não
 * lê campos, não faz rede. Com `badges` vazio e `enabled` falso, remove tudo o que criou. Com a Smart Market no card (`.pp-vit`),
 * o selo fica compacto (só o número) para não poluir.
 */
export function badgeScript(badges: readonly Badge[], enabled: boolean): string {
  const data = JSON.stringify({enabled, badges:sanitizeBadges(badges), css:CSS, tag:ICON_TAG, crown:ICON_CROWN});
  return `(() => {
  const D = ${data};
  const st = window.__phSelos || (window.__phSelos = {data:null, obs:null, list:null, raf:0});
  st.data = D;
  const clear = () => { document.querySelectorAll('.ph-selo').forEach((e) => e.remove()); document.querySelectorAll('.ph-selo-pos').forEach((e) => e.classList.remove('ph-selo-pos')); };
  if (!D.enabled) { if (st.obs) st.obs.disconnect(); st.obs = null; st.list = null; clear(); const css = document.getElementById('ph-selo-css'); if (css) css.remove(); return 0; }
  if (!document.getElementById('ph-selo-css')) { const s = document.createElement('style'); s.id = 'ph-selo-css'; s.textContent = D.css; (document.head || document.documentElement).appendChild(s); }
  const apply = () => {
    const d = st.data; const lista = document.querySelector('#cm-lista'); if (!d || !lista) return 0;
    const all = Array.from(lista.querySelectorAll(':scope > .cm-card')); const poke = all.filter((c) => c.classList.contains('poke'));
    const cards = (poke.length ? poke : all.filter((c) => c.querySelector('.cm-nome-txt'))).slice(0, 60);
    const norm = (v) => String(v == null ? '' : v).replace(/\\s+/g, ' ').trim();
    let n = 0;
    cards.forEach((card, i) => {
      const fav = card.querySelector('button.cm-fav'); const id = fav ? norm(fav.getAttribute('data-fav')) : '';
      const name = (() => { const e = card.querySelector('.cm-nome-txt'); return e ? norm(e.textContent).slice(0, 80) : ''; })();
      const b = d.badges.find((x) => x.id ? x.id === id : (x.index === i && x.name === name));
      let el = card.querySelector(':scope > .ph-selo');
      if (!b) { if (el) el.remove(); return; }
      const compact = Boolean(card.querySelector('.pp-vit'));
      const sig = [b.score, b.tier, b.best, compact].join('|');
      if (el && el.dataset.sig === sig) { n++; return; }
      if (!el) { el = document.createElement('span'); el.className = 'ph-selo'; card.appendChild(el); }
      if (getComputedStyle(card).position === 'static') card.classList.add('ph-selo-pos');
      el.dataset.sig = sig; el.dataset.t = b.tier; el.classList.toggle('ph-compact', compact);
      if (b.best) el.dataset.best = ''; else delete el.dataset.best;
      const label = b.best ? 'Melhor' : b.tier === 'alto' ? 'Bom negócio' : b.tier === 'medio' ? 'Na média' : 'Fraco';
      el.innerHTML = (b.best ? d.crown : d.tag) + '<b>' + b.score + '</b><small>' + label + '</small>';
      el.setAttribute('aria-label', 'PokéHub: custo-benefício ' + b.score + ' de 100, ' + label + ', ' + b.rank + 'º de ' + b.total + ' nesta busca');
      n++;
    });
    return n;
  };
  const lista = document.querySelector('#cm-lista');
  if (lista && st.list !== lista) {
    if (st.obs) st.obs.disconnect();
    st.list = lista;
    const ours = (x) => x.nodeType === 1 && (x.classList.contains('ph-selo') || Boolean(x.closest && x.closest('.ph-selo')));
    st.obs = new MutationObserver((muts) => { if (muts.every((m) => ours(m.target) || Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).every((x) => x.nodeType === 1 && x.classList.contains('ph-selo')))) return; /* mudanças só nos selos: ignora */ clearTimeout(st.raf); st.raf = setTimeout(apply, 60); }); // setTimeout, não rAF: rAF para com a janela encoberta
    st.obs.observe(lista, {childList:true, subtree:true});
  }
  return apply();
})()`;
}
