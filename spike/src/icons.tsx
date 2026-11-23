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
 flask:'M6 2h4M6.5 2v4L3 12.4a1 1 0 0 0 .9 1.6h8.2a1 1 0 0 0 .9-1.6L9.5 6V2M5.2 9.5h5.6',
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

// Arte original: o Professor Grindolino. O rosto muda com o humor; `busy` agita o frasco (leitura em andamento).
export type Mood = 'happy' | 'thinking' | 'worried';
const liquid: Record<Mood,string> = {happy:'#59cd90',thinking:'#5db8e3',worried:'#ffca3a'};
const faces: Record<Mood,{brows:string; mouth:string; grin:boolean; eyes:[number,number,number][]}> = {
 happy:{brows:'M33 35q5-4 10-1M61 33q5-4 10 0',mouth:'M42 64q10 9 20 0z',grin:true,eyes:[[44.5,49,2.6],[66.5,48,3.4]]},
 thinking:{brows:'M33 36h10M61 31q5-4 10 0',mouth:'M46 67q6-3 11 1',grin:false,eyes:[[44.5,44.5,2.6],[66.5,43.5,2.8]]},
 worried:{brows:'M33 37l10-4M62 33l10 4',mouth:'M44 68q4-4 8 0t8 0',grin:false,eyes:[[41.5,49.5,2],[63.5,49.5,2]]},
};
export function Professor({mood = 'happy',busy = false}:{mood?:Mood; busy?:boolean}) {
 const face = faces[mood], tint = liquid[mood];
 return <svg className="prof" data-mood={mood} data-busy={busy || undefined} viewBox="0 0 120 120" aria-hidden="true">
  <path d="M27 52 17 37l12 3-6-19 14 11 3-21 11 16 9-19 4 21 14-11-5 18 13-3-9 16z" fill="#cfd6e4"/>
  <path d="M22 120c0-26 12-41 30-41s30 15 30 41z" fill="#eef1f6"/>
  <path d="M52 79 43 97l9 9 9-9z" fill="#3fa7d6"/>
  <path d="M52 86l-9-5v10zM52 86l9-5v10z" fill="#ffca3a"/>
  <circle cx="52" cy="111" r="1.8" fill="#aab3c2"/>
  <path d="M30 103h10v9H30z" fill="none" stroke="#aab3c2" strokeWidth="1.4"/><path d="M33 103v-6M37 103v-4" stroke="#f25f5c" strokeWidth="1.8" strokeLinecap="round"/>
  <circle cx="31.5" cy="54" r="4" fill="#e3b48c"/><circle cx="72.5" cy="54" r="4" fill="#e3b48c"/>
  <ellipse cx="52" cy="52" rx="20" ry="22" fill="#f1c7a0"/>
  <path d={face.mouth} fill={face.grin ? '#fff' : 'none'} stroke="#1b1f2a" strokeWidth={face.grin ? 1.6 : 2.2} strokeLinecap="round" strokeLinejoin="round"/>
  <g stroke="#1b1f2a" strokeWidth="3"><circle cx="41.5" cy="48" r="10.5" fill="#d6f0fb"/><circle cx="63.5" cy="48" r="10.5" fill="#d6f0fb"/></g>
  <g className="eye" fill="#1b1f2a">{face.eyes.map(([x,y,r]) => <circle key={x} cx={x} cy={y} r={r}/>)}</g>
  <path d={face.brows} fill="none" stroke="#8b95a5" strokeWidth="2.6" strokeLinecap="round"/>
  {mood === 'happy' && <g className="twk" fill="#ffca3a"><path d="M12 58c.4 2.8 1.9 4.6 5 5-3.1.4-4.6 2.2-5 5-.4-2.8-1.9-4.6-5-5 3.1-.4 4.6-2.2 5-5z"/><path d="M84 12c.3 2 1.4 3.3 3.6 3.6-2.2.3-3.3 1.6-3.6 3.6-.3-2-1.4-3.3-3.6-3.6 2.2-.3 3.3-1.6 3.6-3.600z"/></g>}
  {mood === 'thinking' && <g className="twk" fill="none" stroke="#5db8e3" strokeWidth="2.6" strokeLinecap="round"><path d="M7 60q0-5 5-5t5 5q0 3-5 5v3"/><path d="M12 73.500v.2"/></g>}
  {mood === 'worried' && <path d="M79 30q3.5 4.5 3.5 7a3.5 3.5 0 0 1-7 0q0-2.5 3.5-7z" fill="#5db8e3"/>}
  <g className="arm">
   <path d="M76 100 92 88" stroke="#eef1f6" strokeWidth="11" strokeLinecap="round"/>
   <path d="M96 52h8v12l10 22q2 5-3 5H89q-5 0-3-5l10-22z" fill="#eef1f6" fillOpacity=".14" stroke="#cfd6e4" strokeWidth="1.6" strokeLinejoin="round"/>
   <path d="M92.2 74h15.6l5 11.6q1 3.4-2.4 3.400H89.600q-3.4 0-2.4-3.400z" fill={tint}/>
   <path d="M94 50h12" stroke="#cfd6e4" strokeWidth="2.4" strokeLinecap="round"/>
   <circle cx="92" cy="88" r="5.5" fill="#f1c7a0"/>
   <g fill={tint}><circle className="bub" cx="100" cy="42" r="3.6"/><circle className="bub b2" cx="104.5" cy="32" r="2.8"/><circle className="bub b3" cx="97" cy="25" r="2.2"/></g>
   <g fill="#eef1f6" fillOpacity=".6"><circle cx="97" cy="80" r="1.5"/><circle cx="103" cy="84" r="1"/></g>
  </g>
 </svg>;
}
// Cenas pequenas dos estados sem equipe: mesma paleta e traço do Professor.
export type SceneKind = 'plug' | 'empty' | 'broken' | 'sleep' | 'wait';
const glass = {fill:'#eef1f6',fillOpacity:.08,stroke:'#cfd6e4',strokeWidth:2,strokeLinejoin:'round'} as const;
const screen = <><rect x="20" y="10" width="50" height="34" rx="4" fill="#1f2531" stroke="#cfd6e4" strokeWidth="2"/><path d="M36 54h18M45 44v10" stroke="#cfd6e4" strokeWidth="2" strokeLinecap="round"/></>;
const scenes: Record<SceneKind,React.ReactNode> = {
 plug:<>{screen}<path d="M28 28h9l3-6 5 11 3-5h14" fill="none" stroke="#4a556a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M70 34q8 0 8 10t-6 14" fill="none" stroke="#8b95a5" strokeWidth="2" strokeLinecap="round"/><rect x="66" y="57" width="10" height="8" rx="2" fill="#ffca3a"/><path d="M76 59.500h4M76 62.500h4" stroke="#cfd6e4" strokeWidth="1.6" strokeLinecap="round"/>
  <rect x="86" y="54" width="8" height="14" rx="2" fill="#2c3443" stroke="#8b95a5" strokeWidth="1.4"/><path className="twk" d="M82 50l-2-4M84.5 48l1-5" stroke="#ffca3a" strokeWidth="1.6" strokeLinecap="round"/></>,
 empty:<><path d="M24 60V30a16 16 0 0 1 32 0v30z" {...glass}/><path d="M18 61h44" stroke="#cfd6e4" strokeWidth="3" strokeLinecap="round"/><path d="M36 16h8" stroke="#cfd6e4" strokeWidth="3" strokeLinecap="round"/>
  <ellipse cx="40" cy="50" rx="9" ry="6" fill="none" stroke="#8b95a5" strokeWidth="1.6" strokeDasharray="3 3.5"/>
  <circle cx="72" cy="30" r="9" fill="#d6f0fb" fillOpacity=".22" stroke="#ffca3a" strokeWidth="2.4"/><path d="M78.5 36.5 87 45" stroke="#ffca3a" strokeWidth="3.6" strokeLinecap="round"/></>,
 broken:<><path d="M36 10h14v14l13 28q3 8-4 8H27q-7 0-4-8l13-28z" {...glass}/><path d="M34 8h18" stroke="#cfd6e4" strokeWidth="2.4" strokeLinecap="round"/>
  <path d="M26.5 48h33l2.5 5.500q1.5 4.5-3 4.500H27q-4.5 0-3-4.500z" fill="#f25f5c"/><path d="M47 24l-5 7 6 4-4 9 5 4" fill="none" stroke="#eef1f6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  <ellipse cx="74" cy="63" rx="13" ry="3.5" fill="#f25f5c" fillOpacity=".75"/><path d="M62 52q6 2 8 9" fill="none" stroke="#f25f5c" strokeWidth="2.4" strokeLinecap="round"/>
  <g fill="#8b95a5"><circle className="bub" cx="72" cy="38" r="4"/><circle className="bub b2" cx="80" cy="28" r="3"/><circle className="bub b3" cx="70" cy="22" r="2.4"/></g></>,
 sleep:<>{screen}<path d="M47 17a10 10 0 1 0 9 14 8 8 0 0 1-9-14z" fill="#ffca3a"/><g className="twk" fill="none" stroke="#aab3c2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M76 22h7l-7 8h7"/><path d="M86 8h5l-5 6h5"/></g></>,
 wait:<><path d="M34 9h28M34 63h28" stroke="#cfd6e4" strokeWidth="3" strokeLinecap="round"/><path d="M38 9v8q0 8 10 19-10 11-10 19v8h20v-8q0-8-10-19 10-11 10-19V9z" {...glass}/>
  <path d="M42 20h12q-1 6-6 11-5-5-6-11z" fill="#ffca3a"/><path d="M41 61q1-8 7-10 6 2 7 10z" fill="#ffca3a"/><path d="M48 31v20" stroke="#ffca3a" strokeWidth="1.4" strokeDasharray="2 2"/></>,
};
export const Scene = ({kind}:{kind:SceneKind}) => <svg className="scene" viewBox="0 0 96 72" aria-hidden="true">{scenes[kind]}</svg>;
