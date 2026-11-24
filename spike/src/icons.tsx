import { useId } from 'react';
import type React from 'react';
import { elementOf, type Element } from './element';

export const icons = {
 edit:'M11 2.5l2.5 2.5L6 12.5l-3.5 1 1-3.5z',
 reload:'M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33M14 2v3.33h-3.33',
 restart:'M8 1.5V8M12.27 4.4a6 6 0 1 1-8.51.03',
 settings:'M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7M9 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M4 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
 diagnostics:'M1.5 8h3l2-5 3 10 2-5h3',
 plus:'M8 3v10M3 8h10',
 close:'M4 4l8 8M12 4l-8 8',
 screen:'M2 3h12v8H2zM6 13.5h4M8 11v2.5',
 stopwatch:'M8 5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M8 7.2v2.3l1.5 1M6.5 2.5h3M8 2.5V5',
 warn:'M8 2.5l6 10.5H2zM8 7v3M8 11.7v.1',
 crown:'M3 12.5h10M3 10 2.5 4.5l3.2 2.8L8 3l2.3 4.3 3.2-2.8L13 10z',
 target:'M8 2.8a5.2 5.2 0 1 0 0 10.4a5.2 5.2 0 1 0 0-10.4M8 6.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2M8 .8v2M8 13.2v2M.8 8h2M13.2 8h2',
 check:'M3.5 8.5l3 3 6-7',
 lock:'M4 7.5h8v6H4zM5.8 7.5V5.2a2.2 2.2 0 0 1 4.4 0v2.3',
 rows:'M2.5 4h11M2.5 8h11M2.5 12h11',
 note:'M9.5 2H4v12h8V4.5zM9.5 2v2.5H12M8 7.5v4M6 9.5h4',
 trash:'M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 9h6l.5-9',
 chart:'M2 2.5v11h12M4.5 10.5l3-3.5 2.5 2 3.5-4.5',
 coin:'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 5.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8',
 spark:'M9 1.8 3.8 9h3.6l-.9 5.2L12.2 7H8.6z',
 minus:'M5 8h6',
 expand:'M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9',
 collapse:'M13.5 6.5h-4v-4M9.5 6.5L14 2M2.5 9.5h4v4M6.5 9.5L2 14',
 download:'M8 2v8M4.8 7.2L8 10.4l3.2-3.2M3 13h10',
 tv:'M2 4.5h12v8H2zM5.5 1.5 8 4.5l2.5-3M5 14.5h6', // transmissão (aba Twitch)
 tag:'M2.5 2.5h5l6 6-5 5-6-6zM5.3 5.3h.01', // etiqueta de preço (selos do Mercado)
 link:'M6.8 9.2l2.4-2.4M7.5 4.8l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.5 11.2l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2',
 unlink:'M7.5 4.8l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.5 11.2l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2M2.5 2.5l11 11',
 gift:'M2.5 6h11v2.5h-11zM3.5 8.5h9v5h-9zM8 6v7.5M8 6C6.5 3 4 3.5 4.8 5.2 5.3 6 8 6 8 6zM8 6c1.5-3 4-2.5 3.2-.8C10.7 6 8 6 8 6z',
 sound:'M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.7a6 6 0 0 1 0 8.6',
 mute:'M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 6l3.5 4M14 6l-3.5 4',
 gear:'M12.59 6.27L14.44 6.56L14.44 9.44L12.59 9.73L12.46 10.02L13.57 11.54L11.54 13.57L10.02 12.46L9.73 12.59L9.44 14.44L6.56 14.44L6.27 12.59L5.98 12.46L4.46 13.57L2.43 11.54L3.54 10.02L3.41 9.73L1.56 9.44L1.56 6.56L3.41 6.27L3.54 5.98L2.43 4.46L4.46 2.43L5.98 3.54L6.27 3.41L6.56 1.56L9.44 1.56L9.73 3.41L10.02 3.54L11.54 2.43L13.57 4.46L12.46 5.98ZM8 5.9a2.1 2.1 0 1 0 0 4.2a2.1 2.1 0 1 0 0-4.2', // engrenagem (8 dentes) — abre o Gerenciar
};
export const Icon = ({d}:{d:string}) => <svg className="ic" viewBox="0 0 16 16" aria-hidden="true"><path d={d}/></svg>;
// Grade 2×2 animada por CSS (.vi): em "focus" o 1º quadrado cresce até o quadro inteiro e os outros somem.
export const ViewIcon = ({mode}:{mode:'grid'|'focus'}) => <svg className={`ic vi vi-${mode}`} viewBox="0 0 16 16" aria-hidden="true">{[[2.5,2.5],[9,2.5],[2.5,9],[9,9]].map(([x,y]) => <rect key={`${x}-${y}`} x={x} y={y} width="4.5" height="4.5"/>)}</svg>;
// Arte original: símbolos de elemento genéricos.
export const elements: Record<Element,{d:string;name:string}> = {
 flame:{name:'Chama',d:'M8 1.5c.6 2.4 3.5 4 3.5 7.3A3.6 3.6 0 0 1 8 14.5a3.6 3.6 0 0 1-3.5-3.7c0-1.5.8-2.5 1.5-3.3.3 1 .8 1.5 1.4 1.7C7 6.6 7.2 3.8 8 1.5z'},
 bolt:{name:'Raio',d:'M9.5 1.5L3.5 9h3.6l-1 5.5L12.5 7H8.8z'},
 leaf:{name:'Folha',d:'M13.5 2.5c.4 5.5-1.6 10-7 10.5-.9.1-1.8-.1-2.5-.5l-1 1.5-1-.7 1.1-1.6C1.6 8 4.5 3 13.5 2.5z'},
 drop:{name:'Gota',d:'M8 1.5c2 3 4.5 5.4 4.5 8.3a4.5 4.5 0 0 1-9 0C3.5 6.9 6 4.5 8 1.5z'},
 star:{name:'Estrela',d:'M8 1.5c.5 3.6 2.4 6 6.5 6.5-4.1.5-6 2.9-6.5 6.5-.5-3.6-2.4-6-6.5-6.5 4.1-.5 6-2.9 6.5-6.5z'},
};
export const El = ({color}:{color:string}) => <svg className="el" viewBox="0 0 16 16" aria-hidden="true"><path d={elements[elementOf(color)].d}/></svg>;

// Pokébola original em quatro cores (mesma arte do logo): usada no carregando, no vazio e como retrato ausente. `tone="mono"` vira silhueta (currentColor).
export function Ball({tone='color',className}:{tone?:'color'|'mono'; className?:string}) {
 const id = useId();
 if (tone === 'mono') return <svg className={`ball ${className ?? ''}`} viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M4 16h8.2M19.8 16H28" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><circle cx="16" cy="16" r="4.2" fill="none" stroke="currentColor" strokeWidth="3"/></svg>;
 return <svg className={`ball ${className ?? ''}`} viewBox="62 62 388 388" aria-hidden="true"><defs><clipPath id={`${id}c`}><circle cx="256" cy="256" r="184"/></clipPath></defs>
  <g clipPath={`url(#${id}c)`}><rect x="72" y="72" width="184" height="184" fill="#f25f5c"/><rect x="256" y="72" width="184" height="184" fill="#ffca3a"/><rect x="72" y="256" width="184" height="184" fill="#3fa7d6"/><rect x="256" y="256" width="184" height="184" fill="#59cd90"/><rect x="72" y="238" width="368" height="36" fill="#480e1e"/><rect x="253" y="72" width="6" height="368" fill="#480e1e"/></g>
  <circle cx="256" cy="256" r="184" fill="none" stroke="#480e1e" strokeWidth="20"/><circle cx="256" cy="256" r="66" fill="#480e1e"/><circle cx="256" cy="256" r="44" fill="#fff6ef"/></svg>;
}
// Ilustração do estado vazio: pokébola sobre um pedestal de madeira (o balanço de 3 vezes roda uma só vez ao montar).
export const EmptyArt = () => <div className="empty-art" aria-hidden="true"><Ball className="wobble"/><i className="stand"/><i className="shadow"/></div>;
