import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import type { Profile } from '../domain/profiles';
import type { HuntRow, HuntSnapshot, HuntSprite } from '../contracts/hunt';
import { Ball, El, Icon, icons } from './icons';
import { huntFetchable, huntQueue, huntRefreshMs, signature } from './hunt-queue';
import { MarketPanel } from './market-side';
import { ShopPanel } from './shop-side';
import { CapturesPanel } from './captures-side';
import { LivesPanel } from './twitch-side';
import { TeamPickCard } from './team-pick';
import { DeadlinesStrip } from './deadlines-strip';

type Mode = 'xp' | 'ouro' | 'shiny';
type Entry = {data: HuntSnapshot} | {error: string};
const unavailable = 'Dados do /hunt indisponíveis nesta conta';
// O processo principal pode esperar 8 s pela sondagem, 8 s pelo cálculo e 4 s pelos sprites.
const READ_TIMEOUT_MS = 21_000;
const modes: Record<Mode,{label:string; unit:string; value:(row:HuntRow) => number}> = {
 xp:{label:'XP/h',unit:'XP/h',value:row => row.xpPorHora},
 ouro:{label:'Ouro/h',unit:'ouro/h',value:row => row.ouroPorHora},
 shiny:{label:'Shiny/h',unit:'por Shiny',value:row => row.shinyPorHora ?? 0},
};
const full = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const compact = new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
const short = (value:number) => value >= 10000 ? compact.format(value) : full.format(value);
const decimal = (value:number,digits=1) => value.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const seconds = (value:number) => value < 1 ? '<1 s' : value < 60 ? `${decimal(value)} s` : `${Math.floor(value / 60)} min`;
// Evento raro lê melhor como tempo até o próximo.
function every(perHour:number) {
 if (!(perHour > 0)) return '—';
 const hours = 1 / perHour;
 return hours < 1 ? `${full.format(hours * 60)} min` : hours < 100 ? `${full.format(hours)} h` : `${full.format(hours / 24)} d`;
}
const main = (row:HuntRow,mode:Mode) => mode === 'shiny' ? every(row.shinyPorHora ?? 0) : short(modes[mode].value(row));
const region = (row:HuntRow) => [row.regiao && row.regiao[0]!.toUpperCase() + row.regiao.slice(1),`Nv ${full.format(row.nivel)}`].filter(Boolean).join(' · ');

// Preferências da lateral: só aparência e filtro desta máquina, por isso ficam no localStorage do renderer.
// Faixa de largura: manter igual a SIDE_MIN/SIDE_MAX em spike/electron/layout.ts (o processo principal revalida).
export const SIDE_MIN = 280, SIDE_MAX = 520, SIDE_DEFAULT = 340;
const ROWS = [5,10,20] as const;
export interface SidePrefs {width:number; liberadas:boolean; rows:(typeof ROWS)[number]; compact:boolean}
const PREFS_KEY = 'pokehub.side';
export function loadSidePrefs():SidePrefs {
 let saved:Partial<Record<keyof SidePrefs,unknown>> = {};
 try { const value:unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'); if (value && typeof value === 'object') saved = value; } catch { /* sem armazenamento ou valor corrompido: usa o padrão */ }
 const width = saved.width, rows = ROWS.find(item => item === saved.rows);
 return {width:typeof width === 'number' && Number.isInteger(width) && width >= SIDE_MIN && width <= SIDE_MAX ? width : SIDE_DEFAULT, liberadas:saved.liberadas !== false, rows:rows ?? 10, compact:saved.compact === true};
}
export function saveSidePrefs(prefs:SidePrefs) { try { localStorage.setItem(PREFS_KEY,JSON.stringify(prefs)); } catch { /* preferência só não persiste */ } }

// O atlas vem direto de https://pokeidle.io (única origem liberada em img-src); a janela do retrato é recortada por CSS.
// Janelas de 64 px desenham o bicho no canto inferior direito (a arte transborda em tiles de 32), então cortamos 12 px do topo/esquerda
// para centralizar sem canvas. A escala é inteira quando cabe (pixel art nítida); ao reduzir usa suavização. Sem retrato: silhueta de pokébola.
const CROP = 12;
export function Sprite({sprite,name,size}:{sprite:HuntSprite|null; name:string; size:number}) {
 const [failed,setFailed] = useState<string|null>(null);
 const box = {'--s':`${size}px`} as CSSProperties;
 if (!sprite || failed === sprite.url) return <span className="spr" data-empty="" style={box} aria-hidden="true"><Ball tone="mono"/></span>;
 // Com o contorno medido (sprite.box): centraliza e escala pelo Pokémon de verdade (escala inteira quando cabe: pixel art nítida).
 // Sem ele: recorte antigo (janelas de 64 px desenham no canto inferior direito).
 const b = sprite.box;
 if (b) {
   const fit = (size - 6) / Math.max(b.w,b.h);
   const scale = fit >= 1 ? Math.floor(fit) : fit;
   return <span className="spr" style={box}><img src={sprite.url} alt={name} width={sprite.w} height={sprite.h} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} data-smooth={fit < 1 || undefined} onError={() => setFailed(sprite.url)}
    style={{left:(size - b.w * scale) / 2 - b.x * scale,top:(size - b.h * scale) / 2 - b.y * scale,objectPosition:`-${sprite.x}px -${sprite.y}px`,transform:`scale(${scale})`,clipPath:`inset(${b.y}px ${sprite.w - b.x - b.w}px ${sprite.h - b.y - b.h}px ${b.x}px)`}}/></span>;
 }
 const crop = Math.max(sprite.w,sprite.h) > 32 ? CROP : 0;
 const view = Math.max(sprite.w,sprite.h) - crop;
 const fit = size / view;
 const scale = fit >= 1 ? Math.floor(fit) : fit;
 return <span className="spr" style={box}><img src={sprite.url} alt={name} width={sprite.w} height={sprite.h} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} data-smooth={fit < 1 || undefined} onError={() => setFailed(sprite.url)}
  style={{left:(size - view * scale) / 2 - crop * scale,top:(size - view * scale) / 2 - crop * scale,objectPosition:`-${sprite.x}px -${sprite.y}px`,transform:`scale(${scale})`,clipPath:crop ? `inset(${crop}px 0 0 ${crop}px)` : undefined}}/></span>;
}
// Contagem curta ao montar: o cartão remonta ao trocar de conta, métrica ou filtro; a atualização de 10 s troca o número direto.
export function useCount(target:number) {
 const [t,setT] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0);
 useEffect(() => {
   let frame = 0;
   const start = performance.now();
   const tick = (now:number) => { const next = Math.min(1,Math.max(0,(now - start) / 420)); setT(next); if (next < 1) frame = requestAnimationFrame(tick); };
   if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) frame = requestAnimationFrame(tick);
   return () => cancelAnimationFrame(frame);
 },[]);
 return Math.max(0,target) * (1 - (1 - t) ** 3);
}
function Big({row,mode}:{row:HuntRow; mode:Mode}) {
 const shown = useCount(mode === 'shiny' ? 0 : modes[mode].value(row));
 const final = main(row,mode);
 return <p className="side-big"><span aria-hidden="true">{mode === 'shiny' ? final : short(shown)}</span><span className="sr">{final}</span> <small>{modes[mode].unit}</small></p>;
}
function Risk({row}:{row:HuntRow}) {
 const percent = Math.round(row.piorGolpe * 100);
 if (row.umHit) return <span className="risk" data-tone="bad" title="Um golpe do selvagem passa do seu HP"><Icon d={icons.warn}/>1 hit</span>;
 if (row.mortesPorHora >= 0.5) return <span className="risk" data-tone="bad" title="Mortes estimadas por hora"><Icon d={icons.warn}/>{decimal(row.mortesPorHora)} mortes/h</span>;
 const title = `O pior golpe do selvagem tira ${percent}% do seu HP`;
 return percent >= 50 ? <span className="risk" data-tone="warn" title={title}><Icon d={icons.warn}/>{percent}%</span> : <span className="risk" data-tone="ok" title={title}><Icon d={icons.check}/>{percent}%</span>;
}
const kills = (row:HuntRow) => `${row.estimado ? '≈' : ''}${full.format(row.abatesPorHora)} abates/h`;
const Locked = () => <span className="lock" title="O nível do treinador ainda não alcança esta hunt"><Icon d={icons.lock}/>bloqueada</span>;
const waiting: Record<string,[string,string]> = {
 auth_required:['Conta deslogada','Conclua o login desta conta na sessão do jogo para ver onde caçar.'],
 offline:['Sem conexão','A sessão desta conta está offline. O PokéHub tenta reconectar sozinho.'],
 error:['Sessão com erro','Reabra a sessão desta conta pela barra superior.'],
 loading:['Sessão carregando','O ranking aparece assim que o jogo terminar de abrir.'],
};
const skeleton = (label:string) => <div className="side-skel" role="status"><span className="sr">{label}</span><i data-k="poke"/><i data-k="seg"/><i data-k="card"><Ball className="wobble"/></i><i/><i/><i/><i/></div>;

// focusId: conta em foco/expandida (a lateral a seleciona ao abrir e quando ela muda); onAccount: devolve a conta mostrada (o processo principal a usa no foco automático).
export function HuntSide({profiles,states,prefs,onPrefs,onClose,onSettings,focusId,onAccount,lite=false,tabRequest=null}:{profiles:Profile[]; states:Record<string,string>; prefs:SidePrefs; onPrefs:Dispatch<SetStateAction<SidePrefs>>; onClose:() => void; onSettings:() => void; focusId:string|null; onAccount:(id:string|null) => void; lite?:boolean; tabRequest?:{tab:'mercado' | 'loja'; n:number; profileId?: string} | null}) {
 const [pick,setPick] = useState<string|null>(focusId);
 const [seenFocus,setSeenFocus] = useState(focusId);
 if (seenFocus !== focusId) { setSeenFocus(focusId); if (focusId) setPick(focusId); }
 const [mode,setMode] = useState<Mode>('xp');
 const [tab,setTab] = useState<'cacar'|'mercado'|'loja'|'capturas'|'twitch'>('cacar');
 const [seenReq,setSeenReq] = useState(tabRequest?.n ?? 0);
 if (tabRequest && tabRequest.n !== seenReq) { setSeenReq(tabRequest.n); setTab(tabRequest.tab); } // "Ver" no aviso do RMT
 const [entries,setEntries] = useState<Record<string,Entry>>({});
 const [stamp,setStamp] = useState(0);
 const frame = useRef(0);
 // Largura provisória do arrasto: a lateral acompanha o ponteiro e a largura só vai ao processo principal ao soltar.
 const [drag,setDrag] = useState<number|null>(null);
 const dragging = useRef<number|null>(null);
 const stop = useRef<AbortController|null>(null);
 const account = profiles.find(profile => profile.id === pick) ?? profiles[0];
 const id = account?.id;
 useEffect(() => { onAccount(id ?? null); },[id,onAccount]);
 const state = id ? states[id] ?? '' : '';
 const {liberadas} = prefs;
 const slot = `${id}|${liberadas}`;
 const readAt = useRef<Record<string,number>>({});
 const [busy,setBusy] = useState<string|null>(null);
 // As contas pré-aquecidas vêm de uma chave em texto: só uma mudança real (quem pode ser lido) a altera, e o ciclo não reinicia por ela.
 const pool = useMemo(() => profiles.filter(profile => huntFetchable(states[profile.id])).map(profile => profile.id).join(','),[profiles,states]);
 const poolRef = useRef(pool);
 useEffect(() => { poolRef.current = pool; },[pool]);
 const live = huntFetchable(state);
 const seen = useRef<Record<string,string>>({}); // assinatura do último retrato por conta: igual = sem setState
 const refreshMs = huntRefreshMs(lite);
 useEffect(() => {
   if (!id || tab !== 'cacar') return;
   let alive = true, timer = 0;
   const read = async (account:string) => {
     const key = `${account}|${liberadas}`;
     readAt.current[key] = Date.now();
     if (account === id) setBusy(key);
     let timeout: ReturnType<typeof setTimeout> | undefined;
     const result = await Promise.race([window.pokehub.huntSnapshot(account,liberadas),new Promise<never>((_resolve,reject) => {timeout = setTimeout(reject,READ_TIMEOUT_MS);})]).catch(() => ({ok:false as const,error:unavailable})).finally(() => clearTimeout(timeout));
     if (!alive) return;
     setBusy(old => old === key ? null : old);
     const next = result.ok ? signature(result.data) : account === id ? `E${result.error}` : null; // falha no pré-aquecimento não apaga o último retrato
     if (next === null || seen.current[key] === next) return;
     seen.current[key] = next;
     setEntries(old => ({...old,[key]:result.ok ? {data:result.data} : {error:result.error}}));
   };
   // uma conta por vez: o cálculo roda dentro da página do jogo
   const cycle = async () => {
     const pooled = poolRef.current;
     if (!document.hidden) for (const account of huntQueue(pooled ? pooled.split(',') : [],id,item => readAt.current[`${item}|${liberadas}`],Date.now(),!lite)) { if (!alive) return; await read(account); }
     if (alive) timer = window.setTimeout(() => void cycle(),refreshMs);
   };
   void cycle();
   return () => {alive = false;clearTimeout(timer);};
 },[id,stamp,liberadas,live,tab,lite,refreshMs]);
 useEffect(() => () => { cancelAnimationFrame(frame.current); stop.current?.abort(); if (dragging.current !== null) void window.pokehub.drag(false).catch(() => {}); },[]);
 const cached = id && live ? entries[slot] : undefined;
 // A página pode continuar em "carregando" mesmo depois de responder; mostre também erros e estados vazios da leitura.
 const entry = cached;
 const snapshot = entry && 'data' in entry ? entry.data : null;
 const ok = snapshot?.estado === 'ok' ? snapshot : null;
 const hasShiny = Boolean(ok?.hunts.some(row => (row.shinyPorHora ?? 0) > 0));
 const current:Mode = mode === 'shiny' && !hasShiny ? 'xp' : mode;
 const rows = ok ? ok.hunts.filter(row => current !== 'shiny' || (row.shinyPorHora ?? 0) > 0).sort((a,b) => modes[current].value(b) - modes[current].value(a) || b.xpPorHora - a.xpPorHora).slice(0,prefs.rows) : [];
 const best = rows[0];
 const top = best ? modes[current].value(best) : 0;
 const shown:Mode[] = hasShiny ? ['xp','ouro','shiny'] : ['xp','ouro'];
 const message = (title:string,body:string,action?:React.ReactNode) => <div className="side-msg" role="status"><strong>{title}</strong><p>{body}</p>{action}</div>;
 const retry = <button onClick={() => setStamp(value => value + 1)}><Icon d={icons.reload}/>Tentar de novo</button>;
 const patch = (change:Partial<SidePrefs>) => onPrefs(old => ({...old,...change}));
 const clamp = (value:number) => Math.round(Math.min(SIDE_MAX,Math.max(SIDE_MIN,value)));
 const resize = (value:number) => { const width = clamp(value); onPrefs(old => old.width === width ? old : {...old,width}); };
 const endDrag = () => {
   const width = dragging.current;
   if (width === null) return;
   dragging.current = null; stop.current?.abort(); cancelAnimationFrame(frame.current); setDrag(null); resize(width);
   setTimeout(() => void window.pokehub.drag(false).catch(() => {}),0); // depois do layout com a largura nova: as sessões reaparecem já no lugar
 };
 // Escuta na janela, não na borda: o arrasto termina mesmo se a captura do ponteiro se perder sem aviso.
 const startDrag = () => {
   const hide = () => void window.pokehub.drag(true).catch(() => {});
   const signal = (stop.current = new AbortController()).signal;
   dragging.current = prefs.width; setDrag(prefs.width); hide();
   const beat = setInterval(hide,5000); // arrasto longo: renova o prazo de segurança de 10 s do processo principal
   signal.addEventListener('abort',() => clearInterval(beat));
   window.addEventListener('pointermove',event => {
     if (event.buttons === 0) return endDrag(); // botão solto fora da janela
     dragging.current = clamp(window.innerWidth - event.clientX);
     cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => setDrag(dragging.current));
   },{signal});
   for (const type of ['pointerup','pointercancel','blur']) window.addEventListener(type,endDrag,{signal});
 };

 const sprite = prefs.compact ? 28 : 36;
 return <aside className="side" aria-label="Assistente: caçar, mercado, loja, capturas e lives" data-compact={prefs.compact || undefined} data-drag={drag !== null || undefined} style={{'--side':`${drag ?? prefs.width}px`} as CSSProperties}>
  {drag !== null && <div className="side-ghost" aria-hidden="true"><span>Ajustando a lateral · {drag} px</span></div>}
  <div className="side-grip" role="separator" aria-orientation="vertical" aria-label="Largura da lateral" aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={drag ?? prefs.width} tabIndex={0} title="Arraste para ajustar a largura. Duplo clique volta ao padrão."
   onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); /* não inicia seleção de texto */ event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); startDrag(); }}
   onLostPointerCapture={endDrag}
   onDoubleClick={() => resize(SIDE_DEFAULT)}
   onKeyDown={event => { const next = {ArrowLeft:prefs.width + 16,ArrowRight:prefs.width - 16,Home:SIDE_MAX,End:SIDE_MIN}[event.key]; if (next !== undefined) { event.preventDefault(); resize(next); } }}/>
  <header className="side-head"><h2>{tab === 'mercado' ? 'Mercado' : tab === 'loja' ? 'Loja' : tab === 'capturas' ? 'Capturas' : tab === 'twitch' ? 'Lives' : 'Onde caçar?'}</h2><button className="icon" aria-label="Atualizar dados" title="Atualizar dados" disabled={!live || tab !== 'cacar'} onClick={() => setStamp(value => value + 1)}><Icon d={icons.reload}/></button><button className="icon" aria-label="Fechar lateral" title="Fechar (Ctrl+H)" onClick={onClose}><Icon d={icons.close}/></button></header>
  <div className="side-accounts" role="group" aria-label="Conta">{profiles.map(profile => {const s=states[profile.id] ?? '';return <button key={profile.id} className="tab" style={{'--c':profile.colorToken} as CSSProperties} aria-pressed={profile.id === id} title={profile.label} onClick={() => setPick(profile.id)}><El color={profile.colorToken}/><span className="name">{profile.label}</span><span className="st" data-state={s}><b/></span></button>;})}</div>
  <div className="seg side-tabs" role="group" aria-label="Seção" style={{'--n':5,'--i':['cacar','mercado','loja','capturas','twitch'].indexOf(tab)} as CSSProperties}><button aria-pressed={tab === 'cacar'} onClick={() => setTab('cacar')}>Caçar</button><button aria-pressed={tab === 'mercado'} onClick={() => setTab('mercado')}>Mercado</button><button aria-pressed={tab === 'loja'} onClick={() => setTab('loja')}>Loja</button><button aria-pressed={tab === 'capturas'} onClick={() => setTab('capturas')}>Capturas</button><button aria-pressed={tab === 'twitch'} onClick={() => setTab('twitch')}>Lives</button></div>
  {tab === 'mercado' && <MarketPanel id={id} state={state} profiles={profiles}/>}
  <CapturesPanel profiles={profiles} active={tab === 'capturas'}/>
  <ShopPanel profiles={profiles} states={states} id={id} active={tab === 'loja'} restockRequest={tabRequest?.tab === 'loja' && tabRequest.profileId ? {profileId: tabRequest.profileId, n: tabRequest.n} : null}/>
  <LivesPanel profiles={profiles} active={tab === 'twitch'}/>
  {lite && tab === 'cacar' && <p className="lite-tip" role="note">Nas contas que você não está olhando, ative o Modo economia do próprio jogo (botão na tela de sessão) — economiza CPU/GPU.</p>}
  <div className="side-body" hidden={tab !== 'cacar'} aria-busy={state === 'ready' && !entry}>
   <DeadlinesStrip id={id} active={tab === 'cacar'}/>
   <TeamPickCard id={id} live={live} active={tab === 'cacar'}/>
   {!entry && state !== 'ready' ? message(...(waiting[state] ?? waiting.loading!))
   : !entry ? skeleton('Lendo o jogo…')
   : 'error' in entry ? message('Dados indisponíveis',`${entry.error}. O jogo pode ainda estar conectando.`,retry)
   : entry.data.estado === 'sem-extensao' ? message('Extensão /hunt inativa','Ative a extensão em Gerenciar e recarregue as sessões para ver o ranking aqui.',<button className="primary" onClick={onSettings}>Abrir Gerenciar</button>)
   : entry.data.estado === 'sem-jogo' ? message('Conta deslogada','Entre no jogo nesta conta. O ranking aparece quando o jogo conectar.')
   : entry.data.estado === 'sem-pokemon' ? message('Nenhum Pokémon em campo','Coloque um Pokémon em campo nesta conta para ver onde caçar.')
   : ok && <>
    <div className="side-poke"><Sprite sprite={ok.pokemon.sprite} name={ok.pokemon.nome} size={52}/><div><strong title={ok.pokemon.nome}>{ok.pokemon.nome}</strong><span>Nv {full.format(ok.pokemon.nivel)} · em campo</span></div>{ok.bonus && <span className="side-bonus" title={ok.bonus.itens.length ? ok.bonus.itens.map(item => `${item.nome} ×${decimal(item.mult,2)}`).join(' · ') : 'Nenhum bônus ativo'}>XP <b>×{decimal(ok.bonus.pokemon,2)}</b></span>}</div>
    <div className="seg" role="group" aria-label="Ordenar por" style={{'--n':shown.length,'--i':shown.indexOf(current)} as CSSProperties}>{shown.map(item => <button key={item} aria-pressed={current === item} onClick={() => setMode(item)}>{modes[item].label}</button>)}</div>
    <div className="side-opts">
     <button className="opt" aria-pressed={liberadas} title={liberadas ? 'Mostrando só as hunts que o nível do treinador já alcança' : 'Mostrando também as hunts ainda bloqueadas'} onClick={() => patch({liberadas:!liberadas})}><Icon d={liberadas ? icons.check : icons.lock}/>Só liberadas</button>
     <div className="seg" role="group" aria-label="Quantidade de hunts" style={{'--n':ROWS.length,'--i':ROWS.indexOf(prefs.rows)} as CSSProperties}>{ROWS.map(item => <button key={item} aria-pressed={prefs.rows === item} aria-label={`${item} hunts`} title={`Mostrar ${item} hunts`} onClick={() => patch({rows:item})}>{item}</button>)}</div>
     <button className="icon" aria-pressed={prefs.compact} aria-label="Modo compacto" title={prefs.compact ? 'Modo compacto ligado' : 'Modo compacto: linhas mais baixas'} onClick={() => patch({compact:!prefs.compact})}><Icon d={icons.rows}/></button>
    </div>
    {!best ? message('Nenhuma hunt encontrada',liberadas ? 'A extensão não encontrou hunt viável para o nível desta conta.' : 'A extensão não encontrou hunt viável para este Pokémon.') : <div className="side-rank" key={`${current}|${liberadas}`}>
     <p className="sr" role="status">Melhor hunt: {best.nome}, {main(best,current)} {modes[current].unit}</p>
     <section className="side-best" key={best.nome} aria-label="Melhor hunt"><div className="best-top"><div><span className="best-tag"><Icon d={icons.crown}/>Melhor hunt</span><strong>{best.nome}</strong><small>{region(best)}{!best.liberada && <Locked/>}</small></div><Sprite sprite={best.sprite} name={best.nome} size={52}/></div>
      <div className="best-val"><Big row={best} mode={current}/></div>
      <dl><div><dt>{current === 'xp' ? 'Ouro/h' : 'XP/h'}</dt><dd>{short(current === 'xp' ? best.ouroPorHora : best.xpPorHora)}</dd></div><div><dt>Abates/h</dt><dd>{best.estimado ? '≈' : ''}{full.format(best.abatesPorHora)}</dd></div><div><dt>Mata em</dt><dd>{seconds(best.mataEm)}</dd></div><div><dt>Risco</dt><dd><Risk row={best}/></dd></div></dl>
     </section>
     <ol className="side-list" start={2}>{rows.slice(1).map((row,index) => <li key={`${row.nome}-${row.nivel}`} style={{'--i':index,'--p':top > 0 ? Math.max(.02,modes[current].value(row) / top) : 0} as CSSProperties}><span className="pos">{index + 2}</span><Sprite sprite={row.sprite} name={row.nome} size={sprite}/><div className="who"><strong title={row.nome}>{row.nome}</strong><small>{region(row)}{!row.liberada && <Locked/>}</small></div><div className="val"><b>{main(row,current)}</b><Risk row={row}/></div><small className="more">{current === 'xp' ? `${short(row.ouroPorHora)} ouro/h` : `${short(row.xpPorHora)} XP/h`} · {kills(row)}</small><i className="meter" aria-hidden="true"/></li>)}</ol>
    </div>}
    <p className="side-foot">{ok.liberadas} de {ok.total} hunts liberadas{ok.versaoJogo && ` · jogo v${ok.versaoJogo}`}. Atualiza a cada {refreshMs / 1000} s.<span className="side-sync" data-on={busy === slot || undefined} aria-hidden="true">Atualizando…</span></p>
   </>}
  </div>
  <p className="side-credit" hidden={tab !== 'cacar'}>Dados: extensão /hunt (Liang){ok?.versaoExtensao && ` ${ok.versaoExtensao}`}</p>
 </aside>;
}
