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
