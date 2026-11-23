// Ponto de entrada da prévia: o mock precisa existir antes do renderer. Abra /preview.html (bun run preview:ui).
// Parâmetros: ?accounts=1..4; ?allready=1 (todas as contas prontas); ?sidew=280..520 &rows=5|10|20 &compact=1 (lateral); ?state=empty (sem perfis); ?panel=side|market (abre a lateral); ?panel=manage (abre Gerenciar).
import { emit } from './mock-pokehub';
import './game-placeholders';
import '../src/main';

const panel = new URLSearchParams(location.search).get('panel');
const click = (pattern: RegExp, tries = 40) => {
  const hit = [...document.querySelectorAll('button')].find(b => pattern.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`));
  if (hit) hit.click(); else if (tries > 0) setTimeout(() => click(pattern, tries - 1), 100);
};
const section = new URLSearchParams(location.search).get('section'); // ?panel=manage&section=ext|upd|layout|diag
const sectionLabel = {ext: /extens/i, upd: /atualiza/i, layout: /layout/i, diag: /diagn/i}[section ?? ''];
if (panel === 'manage') { click(/gerenciar/i); if (sectionLabel) setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('.manage-nav button')].find(b => sectionLabel.test(b.textContent ?? ''))?.click(), 700); }
if (panel === 'form') setTimeout(() => document.querySelector<HTMLButtonElement>('.tools .primary')?.click(), 1200);
if (panel === 'side' || panel === 'market') setTimeout(() => { emit('toggle-side'); if (panel === 'market') setTimeout(() => document.querySelector<HTMLButtonElement>('.side-tabs button:last-child')?.click(), 400); }, 600);

// Simula o titleBarOverlay do Electron: min/max/fechar em madeira no canto 138×48 (?wco=0 desliga).
if (new URLSearchParams(location.search).get('wco') !== '0') {
  document.documentElement.dataset.wco = 'fake';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:0;right:0;width:138px;height:48px;z-index:60;display:flex;background:#bd6951;color:#fff6ef;font:16px system-ui;-webkit-app-region:no-drag';
  box.innerHTML = ['–', '□', '✕'].map(c => `<span style="flex:1;display:grid;place-items:center">${c}</span>`).join('');
  document.body.append(box);
}
