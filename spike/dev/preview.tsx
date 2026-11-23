// Ponto de entrada da prévia: o mock precisa existir antes do renderer. Abra /preview.html (bun run preview:ui).
// Parâmetros: ?accounts=1..4; ?allready=1 (todas as contas prontas); ?sidew=280..520 &rows=5|10|20 &compact=1 (lateral); ?state=empty (sem perfis); ?panel=side|market|shop|captures (abre a lateral); ?panel=manage (abre Gerenciar).
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
if (panel === 'side' || panel === 'market' || panel === 'captures' || panel?.startsWith('shop')) setTimeout(() => { emit('toggle-side'); if (panel !== 'side') setTimeout(() => document.querySelector<HTMLButtonElement>(panel === 'market' ? '.side-tabs button:nth-child(2)' : panel === 'captures' ? '.side-tabs button:nth-child(4)' : '.side-tabs button:nth-child(3)')?.click(), 400); }, 600);

// Loja: ?panel=shop (aba), shopconfirm (abre a confirmação do kit), shoprun (confirma e mostra o progresso), shopkit (editor de kit). Use com ?allready=1&accounts=2.
if (panel?.startsWith('shop')) {
  try { if (!localStorage.getItem('pokehub.kits')) localStorage.setItem('pokehub.kits', JSON.stringify([{id: 'k1', name: 'Farm padrão', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}, {cat: 'Revives', name: 'Revive', target: 50}, {cat: 'Poções', name: 'Hyper Potion', target: 100}]}])); } catch { /* prévia sem armazenamento */ }
  const press = (pattern: RegExp, at: number) => setTimeout(() => click(pattern), at);
  if (panel === 'shopconfirm' || panel === 'shoprun') {
    setTimeout(() => document.querySelector<HTMLInputElement>('.shop-accs input:not(:checked):not(:disabled)')?.click(), 3000);
    press(/^Repor\s*$/, 4000);
    if (panel === 'shoprun') { press(/Confirmar compra/, 9500); setTimeout(() => { const b = document.querySelector('.side-body.shop'); if (b) b.scrollTop = b.scrollHeight; }, 11000); }
  }
  if (panel === 'shopkit') { press(/Editar Farm/, 4500); setTimeout(() => { const b = document.querySelector('.side-body.shop'); if (b) b.scrollTop = b.scrollHeight; }, 5500); }
}
