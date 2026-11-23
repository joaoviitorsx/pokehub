import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { Profile } from '../domain/profiles';
import type { Hunt, Measurement } from '../contracts/grindolino';
import { STAT_KEYS, type HuntTeam, type TeamHunt, type TeamMember } from '../contracts/hunt';
import { assessTeam, CLOSE_RATIO, pokemonPerformance, SMALL_SAMPLE_MINUTES, STAT_LABELS, teamIvMean, VERDICT_RULES, type PokemonVerdict } from '../domain/pokemon-assessment';
import { formatCompact, formatDelta, formatFull } from './grindolino-form';
import { Sprite, useCount } from './hunt-side';
import { huntFetchable } from './hunt-queue';
import { El, Icon, icons, Scene, type Mood, type SceneKind } from './icons';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
type Entry = {team:HuntTeam | null; error:string | null; measurements:Measurement[]; hunts:Hunt[]};
const unavailable = 'Dados do /hunt indisponíveis nesta conta';
// O processo principal pode esperar 20 s pela sondagem, 20 s pelo cálculo dos seis e 4 s pelos retratos.
const READ_TIMEOUT_MS = 46_000;
const ask = <T,>(call:() => Promise<unknown> | undefined, error = unavailable) => {
 let timer: ReturnType<typeof setTimeout> | undefined;
 const late = new Promise<never>((_resolve,reject) => {timer = setTimeout(reject,READ_TIMEOUT_MS);});
 return Promise.race([Promise.resolve().then(call),late]).then(value => (value ?? {ok:false,error}) as Result<T>).catch(():Result<T> => ({ok:false,error})).finally(() => clearTimeout(timer));
};
const title = (text:string) => text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
const clock = (at:number) => new Date(at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const signed = (value:number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}`;
const where = (hunt:TeamHunt) => [hunt.nome,title(hunt.regiao)].filter(Boolean).join(' · ');
const empty: Record<string,[SceneKind,string,string]> = {
 'sem-extensao':['plug','Extensão /hunt inativa','A previsão por Pokémon vem do cálculo da extensão /hunt. Ative-a em Configurações e recarregue a sessão desta conta.'],
 'sem-jogo':['wait','Jogo ainda não entrou','Conclua o login desta conta e espere o jogo abrir. Depois toque em “Ler equipe”.'],
 'sem-pokemon':['empty','Nenhum Pokémon recebido','O jogo ainda não informou os Pokémon desta conta. Entre no jogo e leia de novo.'],
};
const tones = {good:icons.check,warn:icons.warn,plain:icons.minus};
// Cores próprias para os tipos que o jogo envia em inglês; rótulo em português.
const TYPES: Record<string,[string,string]> = {
 NORMAL:['Normal','#b9b7a8'],FIRE:['Fogo','#ff8a4c'],WATER:['Água','#5aa9f5'],ELECTRIC:['Elétrico','#f7cf3d'],GRASS:['Planta','#6fcf73'],ICE:['Gelo','#7fdbe0'],
 FIGHTING:['Lutador','#e8705f'],POISON:['Veneno','#c07be0'],GROUND:['Terra','#d9b46a'],FLYING:['Voador','#9fb4f5'],PSYCHIC:['Psíquico','#ff7fa8'],BUG:['Inseto','#b4cf4a'],
 ROCK:['Pedra','#c9b27a'],GHOST:['Fantasma','#9a8ad6'],DRAGON:['Dragão','#8f8cf7'],DARK:['Sombrio','#a59488'],STEEL:['Aço','#9fc0cc'],FAIRY:['Fada','#f5a3d7'],
};
const typeOf = (type:string | undefined):[string,string] => type === undefined ? ['','var(--off)'] : TYPES[type.toUpperCase()] ?? [title(type),'var(--off)'];
const tint = (member:TeamMember) => ({'--t':typeOf(member.tipos[0])[1]}) as CSSProperties;
const width = (value:number, top:number) => ({'--w':top > 0 ? Math.min(1,Math.max(0,value / top)) : 0}) as CSSProperties;
const badgeName = {xp:'Melhor para XP',gold:'Melhor para ouro'};

/** A partir daqui o Professor fica preocupado. Só apresentação: o texto do veredito segue as regras do domínio. */
const WORRY_RATIO = -0.15;
/** Humor do Professor e a conclusão principal do balão, derivados do veredito já calculado. */
export function talk(name:string, verdict:PokemonVerdict):[Mood,string] {
 const {compared,real,badges,smallSample,bestXp,bestGold} = verdict;
 const ratios = [compared?.xpRatio,compared?.goldRatio].filter((ratio):ratio is number => typeof ratio === 'number');
 const worst = ratios.length ? Math.min(...ratios) : null;
 const percent = worst === null ? 0 : Math.round(Math.abs(worst) * 100);
 const lead = badges.length ? `${name} lidera a equipe em ${badges.map(badge => badge === 'xp' ? 'XP/h' : 'ouro/h').join(' e ')} previsto` : null;
 if (smallSample) return ['thinking',`${lead ? `${lead}, mas medi por pouco tempo` : `Medi ${name} por pouco tempo`}. Com ${SMALL_SAMPLE_MINUTES} min ao vivo eu concluo.`];
 if (worst !== null && compared) {
   if (worst > -CLOSE_RATIO) return ['happy',`${name} entregou o previsto em “${compared.hunt}”. Dado medido, dado confiável.`];
   const gap = `${worst === compared.xpRatio ? 'XP' : 'Ouro'} de ${name} ficou ${percent}% abaixo do previsto em “${compared.hunt}”.`;
   // preocupado só quando tudo o que foi comparado ficou bem abaixo
   if (Math.max(...ratios) <= WORRY_RATIO) return ['worried',`${gap} Aqui a previsão não se confirmou.`];
   return ['thinking',`${gap} ${ratios.length > 1 && Math.max(...ratios) > -CLOSE_RATIO ? 'A outra medida bateu com o previsto; sigo de olho.' : 'Sigo de olho.'}`];
 }
 if (lead) return ['happy',`${lead}.${real ? '' : ' Falta medir ao vivo para confirmar.'}`];
 if (!bestXp && !bestGold) return ['thinking',`O /hunt não calculou hunt para ${name}. Sem previsão não há veredito.`];
 if (!real) return ['thinking',`Ainda não medi ${name} ao vivo. Por enquanto vale só a previsão do /hunt.`];
 return ['thinking',`Medi ${name} em hunt sem previsão do /hunt. Não dá para comparar.`];
}

// Contagem curta ao montar (a ficha remonta ao trocar de Pokémon); o leitor de tela recebe só o valor final.
function Num({value}:{value:number | null}) {
 const shown = useCount(value ?? 0);
 return value === null ? <b>—</b> : <b><span aria-hidden="true">{formatCompact(shown)}</span><span className="sr">{formatCompact(value)}</span></b>;
}
// Previsto e real lado a lado na mesma escala: nunca somados.
function Versus({label,predicted,ratio}:{label:string; predicted:number; ratio:number | null}) {
 if (ratio === null || predicted <= 0) return null;
 const real = predicted * (1 + ratio), top = Math.max(predicted,real), delta = formatDelta(ratio);
 return <div className="vs"><p><strong>{label}</strong><span data-tone={delta.tone}>{delta.text}</span></p>
  <div className="vs-row" data-k="forecast"><Icon d={icons.screen}/><span>Previsto</span><i style={width(predicted,top)}/><b>{formatCompact(predicted)}</b></div>
  <div className="vs-row" data-k="observed"><Icon d={icons.stopwatch}/><span>Real</span><i style={width(real,top)}/><b>{formatCompact(real)}</b></div>
 </div>;
}
function State({scene,heading,children,alert}:{scene:SceneKind; heading:string; children:ReactNode; alert?:boolean}) {
 return <div className="team-state" role={alert ? 'alert' : undefined}><Scene kind={scene}/><div><h2>{heading}</h2><p>{children}</p></div></div>;
}

function Card({member,verdict,members}:{member:TeamMember; verdict:PokemonVerdict; members:TeamMember[]}) {
 const mean = teamIvMean(members);
 const {real,bestXp,bestGold,compared} = verdict;
 const predicted = compared && member.hunts.find(hunt => hunt.nome === compared.hunt);
 return <article className="team-card" style={tint(member)} aria-labelledby="team-name">
  <header className="hero"><div className="hero-art"><Sprite sprite={member.sprite} name={member.nome} size={96}/></div><div><h2 id="team-name">{member.nome}</h2>
   <p className="chips"><span className="chip">Nv {formatFull(member.nivel)}</span>
    {member.potencia !== null && <span className="chip pow" title={`Potência ${member.potencia} de 5`}><span aria-hidden="true">P{member.potencia}</span><span className="pips" aria-hidden="true">{[1,2,3,4,5].map(n => <i key={n} data-on={n <= member.potencia! || undefined}/>)}</span><span className="sr">Potência {member.potencia} de 5</span></span>}
    {member.tipos.map(type => { const [label,color] = typeOf(type); return <span key={type} className="chip type" style={{'--c':color} as CSSProperties}>{label}</span>; })}
    {member.ativo && <span className="chip field">em campo</span>}</p>
   {verdict.badges.length > 0 && <p className="team-tags">{verdict.badges.map(badge => <span key={badge} className="best-tag"><Icon d={icons.crown}/>{badgeName[badge]}</span>)}</p>}</div></header>
  <ul className="verdict" aria-label="Veredito">{verdict.lines.map(line => <li key={line.text} data-tone={line.tone}><Icon d={tones[line.tone]}/>{line.text}</li>)}</ul>
  <div className="team-nums">
   <section data-k="forecast" aria-labelledby="team-forecast"><h3 id="team-forecast"><Icon d={icons.screen}/>Previsto pelo /hunt</h3>
    {!bestXp && !bestGold ? <p>Sem hunt viável e liberada para este Pokémon agora.</p> : <dl>
     {bestXp && <div><dt>Melhor XP/h</dt><dd><Num value={bestXp.xpPorHora}/><small>{where(bestXp)} · {bestXp.estimado ? '≈' : ''}{formatFull(bestXp.abatesPorHora)} abates/h</small></dd></div>}
     {bestGold && <div><dt>Melhor ouro/h</dt><dd><Num value={bestGold.ouroPorHora}/><small>{where(bestGold)}</small></dd></div>}
    </dl>}</section>
   <section data-k="observed" aria-labelledby="team-real"><h3 id="team-real"><Icon d={icons.stopwatch}/>Medido ao vivo{verdict.smallSample && <span className="risk" data-tone="warn" title="Menos de 30 min medidos"><Icon d={icons.warn}/>amostra pequena</span>}</h3>
    {!real ? <p>Nenhuma medição com este Pokémon em campo. Inicie uma na lateral “Onde caçar?” e ela aparece aqui.</p> : <dl>
     <div><dt>XP/h</dt><dd><Num value={real.xpPerHour}/></dd></div>
     <div><dt>Ouro/h</dt><dd><Num value={real.coinsPerHour}/></dd></div>
     <div><dt>Abates/h</dt><dd><Num value={real.killsPerHour}/></dd></div>
     <div><dt>Tempo medido</dt><dd><b>{formatFull(real.minutes)} min</b><small>{real.samples} {real.samples === 1 ? 'medição' : 'medições'}</small></dd></div>
    </dl>}</section>
   {compared && predicted && <section className="team-vs" aria-labelledby="team-vs"><h3 id="team-vs">Previsto × real em “{compared.hunt}”<small>{formatFull(compared.minutes)} min medidos nessa hunt</small></h3>
    <div><Versus label="XP/h" predicted={predicted.xpPorHora} ratio={compared.xpRatio}/><Versus label="Ouro/h" predicted={predicted.ouroPorHora} ratio={compared.goldRatio}/></div></section>}
  </div>
  {(member.stats || member.ivs) && <table className="team-stats"><caption>Atributos informados pelo jogo</caption>
   <thead><tr><th scope="col">Atributo</th><th scope="col">Valor (barra: maior da equipe = cheia)</th><th scope="col">IV</th><th scope="col">IV × média</th></tr></thead>
   <tbody>{STAT_KEYS.map(key => { const iv = member.ivs?.[key] ?? null, base = mean[key], diff = iv !== null && base !== null ? iv - base : null, value = member.stats?.[key] ?? null;
    return <tr key={key}><th scope="row">{STAT_LABELS[key]}</th>
     <td>{value === null ? '—' : <div className="stat-bar"><i style={width(value,Math.max(...members.map(item => item.stats?.[key] ?? 0)))}/><span>{formatFull(value)}</span></div>}</td>
     <td>{iv === null ? '—' : <span className="iv">{iv}</span>}</td>
     <td data-tone={diff === null || diff === 0 ? undefined : diff > 0 ? 'good' : 'low'}>{diff === null ? '—' : diff === 0 ? 'na média' : signed(diff)}</td></tr>; })}</tbody>
  </table>}
 </article>;
}

/** "Esse Pokémon é bom?": equipe da conta com a previsão do /hunt, o que foi medido ao vivo e um veredito por regras fixas. */
export function PokemonTeam({profiles,states,head}:{profiles:Profile[]; states:Record<string,string>; head:(mood:Mood, say:string, busy?:boolean) => ReactNode}) {
 const [pick,setPick] = useState<string|null>(null);
 const [entries,setEntries] = useState<Record<string,Entry>>({});
 const [busy,setBusy] = useState<string|null>(null);
 const [chosen,setChosen] = useState<string|null>(null);
 const alive = useRef(true);
 const account = profiles.find(profile => profile.id === pick) ?? profiles[0];
 const id = account?.id;
 const usable = id !== undefined && huntFetchable(states[id]);
 async function load(accountId:string) {
   setBusy(accountId);
   const api = window.pokehub.grindolino;
   const [team,measurements,hunts] = await Promise.all([ask<HuntTeam>(() => window.pokehub.huntTeam(accountId)),ask<Measurement[]>(() => api?.listMeasurements(accountId)),ask<Hunt[]>(() => api?.listHunts())]);
   if (!alive.current) return;
   setBusy(old => old === accountId ? null : old);
   // falha na releitura não apaga a última equipe lida
   setEntries(old => ({...old,[accountId]:{team:team.ok ? team.data : old[accountId]?.team ?? null,error:team.ok ? null : team.error,measurements:measurements.ok ? measurements.data : [],hunts:hunts.ok ? hunts.data : []}}));
 }
 // Sob demanda: lê ao abrir a visão e ao trocar de conta; depois só pelo botão. O processo principal limita a 1 cálculo por conta a cada 60 s.
 useEffect(() => {
   alive.current = true;
   // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura assíncrona via IPC ao abrir/trocar de conta
   if (id && usable) void load(id);
   return () => { alive.current = false; };
 },[id,usable]);
 if (!account || !id) return <>{head('thinking','Cadê as cobaias? Preciso de uma conta para analisar.')}<State scene="empty" heading="Nenhuma conta ainda">Crie um perfil para o Professor conhecer sua equipe.</State></>;
 const entry = entries[id];
 const team = entry?.team?.estado === 'ok' ? entry.team : null;
 const verdicts = team ? assessTeam(team.membros,pokemonPerformance(entry!.measurements,id),new Map(entry!.hunts.map(hunt => [hunt.id,hunt.name]))) : [];
 const index = team ? Math.max(0,team.membros.findIndex(member => member.chave === chosen)) : 0;
 const member = team?.membros[index], verdict = verdicts[index];
 const reading = busy === id;
 const state = entry?.team && entry.team.estado !== 'ok' ? empty[entry.team.estado] : undefined;
 const waiting = usable && (reading || !entry);
 const [mood,say]:[Mood,string] = !usable ? ['thinking',`A sessão de ${account.label} está dormindo. Abra-a e eu leio a equipe.`]
  : waiting ? ['thinking','Um instante: estou lendo a equipe…']
  : member && verdict ? talk(member.nome,verdict)
  : entry?.error ? ['worried','A leitura falhou. Tente “Ler equipe” de novo em instantes.']
  : ['thinking','Ainda não tenho dados para analisar nesta conta.'];
 const topXp = Math.max(0,...verdicts.map(item => item.bestXp?.xpPorHora ?? 0));
 const move = (event:KeyboardEvent<HTMLUListElement>) => {
   const step = ({ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1} as Record<string,number>)[event.key];
   if (!step || !team) return;
   event.preventDefault();
   const next = Math.min(team.membros.length - 1,Math.max(0,index + step));
   setChosen(team.membros[next]!.chave);
   event.currentTarget.querySelectorAll('button')[next]?.focus();
 };
 return <>{head(mood,say,waiting)}<div className="team" aria-busy={reading}>
  <div className="grind-controls">
   <div className="ctl"><span id="team-account">Conta</span><div className="accounts" role="group" aria-labelledby="team-account">{profiles.map(profile => <button key={profile.id} className="tab" style={{'--c':profile.colorToken} as CSSProperties} aria-pressed={profile.id === id} onClick={() => {setPick(profile.id);setChosen(null);}}><El color={profile.colorToken}/><span className="name">{profile.label}</span></button>)}</div></div>
   <div className="ctl team-read"><span>{team ? `Lida às ${clock(team.lidoEm)}` : 'Leitura sob demanda'}</span><button disabled={reading || !usable} onClick={() => void load(id)}><Icon d={icons.reload}/>{reading ? 'Lendo…' : 'Ler equipe'}</button></div>
  </div>
  {!usable && <State scene="sleep" heading={`Sessão de ${account.label} não está pronta`}>Abra a sessão desta conta e entre no jogo. A equipe é lida da página do jogo, pela extensão /hunt.</State>}
  {usable && !entry && <div className="team-grid team-skel" role="status"><span className="sr">Lendo a equipe de {account.label}</span><div className="side-skel"><i/><i/><i/><i/></div><div className="side-skel"><i data-k="card"/><i/></div></div>}
  {usable && entry?.error && (team ? <p role="alert">{entry.error} Mostrando a leitura das {clock(team.lidoEm)}.</p> : <State alert scene="broken" heading="A leitura não funcionou">{entry.error}</State>)}
  {usable && state && <State scene={state[0]} heading={state[1]}>{state[2]}</State>}
  {team && member && verdict && <>
   <div className="team-grid">
    <ul className="team-list" aria-label={`Pokémon de ${account.label}`} onKeyDown={move}>{team.membros.map((item,i) => { const xp = verdicts[i]!.bestXp?.xpPorHora ?? null;
     return <li key={item.chave} style={tint(item)}><button aria-pressed={i === index} aria-keyshortcuts="ArrowUp ArrowDown" onClick={() => setChosen(item.chave)}>
      <Sprite sprite={item.sprite} name={item.nome} size={40}/>
      <span className="tl-main"><strong>{item.nome}</strong><small>Nv {formatFull(item.nivel)}{item.ativo && ' · em campo'}</small>
       {xp === null ? <small>sem previsão do /hunt</small> : <span className="tl-bar" title="XP/h previsto, em relação ao melhor da equipe"><i style={width(xp,topXp)}/><span>{formatCompact(xp)} XP/h</span></span>}</span>
      {verdicts[i]!.badges.length > 0 && <span className="tl-badges">{verdicts[i]!.badges.map(badge => <span key={badge} title={badgeName[badge]}><Icon d={badge === 'xp' ? icons.spark : icons.coin}/><span className="sr">{badgeName[badge]}</span></span>)}</span>}
     </button></li>; })}</ul>
    <Card key={member.chave} member={member} verdict={verdict} members={team.membros}/>
   </div>
   {team.total > team.membros.length && <p className="team-more">Mostrando {team.membros.length} de {formatFull(team.total)} Pokémon que o jogo informou: o que está em campo e os de maior nível. As comparações valem só entre eles.</p>}
  </>}
  <details className="team-rules"><summary>Como o Professor decide</summary><ul>{VERDICT_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul></details>
  <p className="note">Previsão e ficha: cálculo e dados da extensão /hunt{team?.versaoExtensao ? ` ${team.versaoExtensao}` : ''} (terceiros) na sessão desta conta{team?.versaoJogo ? `, jogo ${team.versaoJogo}` : ''}. Medido: suas medições ao vivo gravadas neste computador. Nada é enviado para fora.</p>
 </div></>;
}
