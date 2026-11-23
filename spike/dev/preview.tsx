// Ponto de entrada da prévia: o mock precisa existir antes do renderer. Abra /preview.html (bun run preview:ui).
// Parâmetros: ?state=empty (sem perfis); ?panel=side|market (abre a lateral); ?panel=manage (abre Gerenciar).
import { emit } from './mock-pokehub';
import './game-placeholders';
import '../src/main';

const panel = new URLSearchParams(location.search).get('panel');
const click = (pattern: RegExp, tries = 40) => {
  const hit = [...document.querySelectorAll('button')].find(b => pattern.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`));
  if (hit) hit.click(); else if (tries > 0) setTimeout(() => click(pattern, tries - 1), 100);
};
if (panel === 'manage') click(/gerenciar/i);
if (panel === 'side' || panel === 'market') setTimeout(() => { emit('toggle-side'); if (panel === 'market') setTimeout(() => click(/mercado/i), 400); }, 600);
