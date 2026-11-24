import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgeScript, badgesFor, sanitizeBadges, tierOf, type Badge } from '../domain/market-badges';
import type { MarketListing, MarketScan } from '../domain/market';
import { PreferencesStore } from '../electron/preferences-store';

const l = (id: string, nota: number, price: number, over: Partial<MarketListing> = {}): MarketListing => ({id, name:'Venusaur', level:50, potencia:3, nota, shiny:false, price, currency:'gold', smart:null, ...over});
const scan = (listings: MarketListing[]): MarketScan => ({open:true, listings, smart:false, page:1, pages:2, query:'Venusaur'});

describe('selos do RMT: pontuação', () => {
  const page = [l('a', 9.4, 14_500), l('b', 3.2, 25_000), l('c', 6.1, 12_000)];
  it('um selo por card da página, com posição na busca e um único "Melhor"', () => {
    const badges = badgesFor(scan(page), page);
    expect(badges.map(b => b.id)).toEqual(['a', 'b', 'c']);
    expect(badges.filter(b => b.best)).toHaveLength(1);
    expect(badges.find(b => b.best)!.rank).toBe(1);
    for (const b of badges) { expect(b.total).toBe(3); expect(b.tier).toBe(tierOf(b.score)); }
  });
  it('compara com tudo o que já foi visto na mesma busca (outras páginas)', () => {
    const other = [l('x', 9.9, 5_000), l('y', 8, 6_000)];
    const badges = badgesFor(scan(page), [...page, ...other]);
    expect(badges.every(b => b.total === 5)).toBe(true);
    expect(badges.some(b => b.best)).toBe(false); // o melhor está em outra página
  });
  it('sem "Melhor" com menos de 3 anúncios; Mercado fechado não gera selo', () => {
    expect(badgesFor(scan(page.slice(0, 2)), page.slice(0, 2)).some(b => b.best)).toBe(false);
    expect(badgesFor({...scan(page), open:false}, page)).toEqual([]);
  });
  it('moedas não se misturam no ranking', () => {
    const mixed = [l('g1', 9, 10_000), l('g2', 5, 9_000), l('o1', 2, 3, {currency:'orb'})];
    const badges = badgesFor(scan(mixed), mixed);
    expect(badges.find(b => b.id === 'o1')).toMatchObject({rank:1, total:1});
  });
  it('limites: nível por faixa', () => { expect([tierOf(66), tierOf(65), tierOf(33), tierOf(32)]).toEqual(['alto', 'medio', 'medio', 'baixo']); });
});

describe('selos do RMT: script da página', () => {
  const ok: Badge = {id:'a1', name:'Venusaur', index:0, score:87, tier:'alto', best:true, rank:1, total:9};
  it('só passam valores validados', () => {
    expect(sanitizeBadges([ok, {...ok, id:'"><script>'}, {...ok, score:101}, {...ok, tier:'x' as never}, {...ok, name:''}, {...ok, rank:10}])).toEqual([ok]);
  });
  it('o script gerado é JavaScript válido (ligado e desligado) e não interpola texto cru', () => {
    for (const script of [badgeScript([ok], true), badgeScript([], false), badgeScript([{...ok, name:'Mr. "Mime" </script>'}], true)]) expect(() => new Function(`return ${script}`)).not.toThrow();
    // o nome do anúncio só é comparado; o HTML do selo usa apenas ícone fixo, número e rótulo fixo
    expect(badgeScript([ok], true)).toContain("el.innerHTML = (b.best ? d.crown : d.tag) + '<b>' + b.score + '</b><small>' + label + '</small>';");
    expect(badgeScript([ok], true)).not.toMatch(/innerHTML[^;]*b\.name/);
  });
  it('não clica, não faz rede, não lê campos', () => {
    const script = badgeScript([ok], true);
    for (const banned of ['.click(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'document.cookie', '.value']) expect(script).not.toContain(banned);
  });
});

describe('preferência dos selos', () => {
  it('ligada por padrão; grava booleano e recusa o resto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-badges-'));
    const prefs = new PreferencesStore(join(dir, 'app.sqlite'));
    try {
      expect(prefs.getMarketBadges()).toBe(true);
      expect(prefs.setMarketBadges(false)).toBe(false);
      expect(prefs.getMarketBadges()).toBe(false);
      expect(() => prefs.setMarketBadges('sim')).toThrow();
    } finally { prefs.close(); rmSync(dir, {recursive:true, force:true}); }
  });
});
