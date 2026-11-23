import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../domain/profiles';
import type { Hunt } from '../contracts/grindolino';
import type { HuntRow } from '../contracts/hunt';
import { LIVE_MIN_SAMPLE_MS, type LiveStatus } from '../contracts/live';
import { huntKey } from '../domain/grindolino';
import { perHour } from '../domain/live';
import { ask } from './grindolino';
import { formatCompact, formatFull } from './grindolino-form';
import { Icon, icons } from './icons';

const STATUS_MS = 2000; // só consulta o processo principal; a leitura do jogo é dele, a cada 5 s
const FORECAST_MS = 60_000;
const two = (value:number) => String(value).padStart(2,'0');
const clock = (ms:number) => { const s = Math.max(0,Math.floor(ms / 1000)); return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
const rare = (value:number) => value.toLocaleString('pt-BR',{maximumFractionDigits:value < 1 ? 3 : 1});
const plural = (count:number,one:string,many:string) => `${formatFull(count)} ${count === 1 ? one : many}`;

/**
 * Painel "Ao vivo" de uma conta: inicia/para a medição e mostra o observado ao lado do previsto pelo /hunt, nunca somados.
 * `rows`: hunts do /hunt já lidas por quem hospeda o painel (lateral); sem ela o painel consulta sozinho enquanto mede.
 */
export function LivePanel({account,rows,compact,onSaved}:{account:Profile; rows?:HuntRow[]|null; compact?:boolean; onSaved?:() => void}) {
 const api = window.pokehub.live, grind = window.pokehub.grindolino;
 const [status,setStatus] = useState<LiveStatus|null>(null);
 const [hunts,setHunts] = useState<Hunt[]>([]);
 const [choice,setChoice] = useState('');
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState('');
 const [now,setNow] = useState(() => Date.now());
 const [fetched,setFetched] = useState<{account:string; rows:HuntRow[]}|null>(null);
 const savedAt = useRef<number|null|undefined>(undefined); // undefined: ainda não viu o primeiro status
 const session = status?.active.find(item => item.accountId === account.id) ?? null;
 const ended = status?.ended.find(item => item.accountId === account.id) ?? null;
 const measuring = session !== null;

 useEffect(() => {
   if (!api) return;
   let alive = true;
   const read = async () => { const result = await ask<LiveStatus>(api.status()); if (alive && result.ok) setStatus(result.data); };
   void read();
   const timer = setInterval(() => { if (!document.hidden) void read(); },STATUS_MS);
   return () => {alive = false;clearInterval(timer);};
 },[api]);
 useEffect(() => { if (!measuring) return; const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); },[measuring]);
 useEffect(() => { if (grind && !measuring) void ask<Hunt[]>(grind.listHunts()).then(result => { if (result.ok) setHunts(result.data); }); },[grind,measuring,account.id]);
 // quem hospeda recarrega o ranking quando uma medição desta conta acaba de ser gravada
 const endedAt = ended?.measurement ? ended.endedAt : null;
 useEffect(() => { if (status === null) return; if (savedAt.current !== undefined && endedAt !== null && endedAt !== savedAt.current) onSaved?.(); savedAt.current = endedAt; });
 // previsão do /hunt quando a tela que hospeda não a tem (Grindolino): só durante a medição, a cada 60 s
 const own = rows === undefined && measuring;
 useEffect(() => {
   if (!own) return;
   let alive = true;
   const read = async () => { const result = await window.pokehub.huntSnapshot(account.id).catch(() => null); if (alive && result?.ok && result.data.estado === 'ok') setFetched({account:account.id,rows:result.data.hunts}); };
   void read();
   const timer = setInterval(() => void read(),FORECAST_MS);
   return () => {alive = false;clearInterval(timer);};
 },[own,account.id]);

 if (!api) return null;
 async function run(call:Promise<unknown>) {
   setBusy(true);setError('');
   const result = await ask<LiveStatus>(call);
   setBusy(false);
   if (result.ok) {setStatus(result.data);setNow(Date.now());} else setError(result.error);
 }
 const title = <h2><Icon d={icons.stopwatch}/>Ao vivo</h2>;
 if (!session) return <section className="live" data-compact={compact || undefined} aria-label={`Medição ao vivo de ${account.label}`}>
  <div className="live-head">{title}
   <label className="live-hunt"><span className={compact ? 'sr' : undefined}>Hunt</span><select value={hunts.some(hunt => hunt.id === choice) ? choice : ''} disabled={busy} onChange={event => setChoice(event.target.value)}><option value="">Detectar pela caça atual</option>{hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.name}</option>)}</select></label>
   <button className="primary" disabled={busy || status === null} onClick={() => void run(api.start(account.id,hunts.some(hunt => hunt.id === choice) ? choice : null))}>{busy ? 'Iniciando…' : 'Iniciar medição'}</button>
  </div>
  {!compact && <p className="live-what">Mede XP, ouro, abates e shinies reais de {account.label} lendo o log de mensagens que o jogo já mostra nesta sessão. Só leitura: nada é clicado nem enviado. Entre na hunt antes de iniciar; a medição para sozinha se a hunt ou o Pokémon em campo mudar, se a sessão cair ou em 12 h.</p>}
  {error && <p role="alert">{error}</p>}
  {ended && <p className="live-end" role="status" data-saved={ended.measurement ? '' : undefined}><Icon d={ended.measurement ? icons.check : icons.warn}/>{ended.notice}</p>}
 </section>;

 const elapsed = now - session.startedAt, sample = session.readAt - session.startedAt, t = session.totals;
 const rate = (amount:number) => perHour(amount,sample,LIVE_MIN_SAMPLE_MS);
 const list = rows !== undefined ? rows : fetched?.account === account.id ? fetched.rows : null;
 const forecast = session.huntName && list ? list.find(row => huntKey(row.nome) === huntKey(session.huntName!)) ?? null : null;
 const none = list === null ? 'sem dados do /hunt' : session.huntName === null ? 'aguardando a hunt' : 'hunt fora do ranking do /hunt';
 const lines:{label:string; hint?:string; value:number|null; total:string; forecast:number|null; approx?:boolean; small?:boolean; noForecast?:string}[] = [
  {label:compact ? 'XP/h treinador' : 'XP/h do treinador',value:rate(t.trainerXp),total:`${formatCompact(t.trainerXp)} no total`,forecast:null,noForecast:'só informativo; não é gravado'},
  {label:compact ? 'XP/h pokémon' : 'XP/h do pokémon',hint:'é o XP gravado na medição',value:rate(t.pokemonXp),total:`${formatCompact(t.pokemonXp)} no total`,forecast:forecast?.xpPorHora ?? null},
  {label:'Ouro/h',value:rate(t.coins),total:`${formatCompact(t.coins)} no total`,forecast:forecast?.ouroPorHora ?? null},
  {label:'Abates/h',value:rate(t.kills),total:plural(t.kills,'abate','abates'),forecast:forecast?.abatesPorHora ?? null,approx:forecast?.estimado},
  {label:'Shiny/h',value:rate(t.shinies),total:`${plural(t.shinies,'shiny','shinies')} em ${plural(t.captures,'captura','capturas')}`,forecast:forecast?.shinyPorHora ?? null,small:true},
 ];
 const show = (value:number,small?:boolean) => small ? rare(value) : formatCompact(value);
 const warming = sample < LIVE_MIN_SAMPLE_MS;
 return <section className="live" data-on="" data-compact={compact || undefined} aria-label={`Medição ao vivo de ${account.label}`}>
  <div className="live-head">{title}<i className="live-dot" aria-hidden="true"/>
   <strong className="live-name" title={session.huntName ?? undefined}>{session.huntName ?? 'Aguardando o primeiro abate…'}</strong>
   <span className="live-clock" role="timer" aria-label="Tempo de medição">{clock(elapsed)}</span>
   <button disabled={busy} onClick={() => void run(api.stop(account.id))}>{busy ? 'Gravando…' : 'Parar e gravar'}</button>
  </div>
  {session.pokemon && !compact && <p className="live-what">Em campo: {session.pokemon.name ?? 'Pokémon'}{session.pokemon.level !== null && ` Nv ${formatFull(session.pokemon.level)}`}. A medição fica registrada com ele.</p>}
  <table className="live-table">
   <thead><tr><th scope="col"><span className="sr">Métrica</span></th><th scope="col" className="src observed"><Icon d={icons.stopwatch}/>Observado</th><th scope="col" className="src forecast"><Icon d={icons.screen}/>Previsto (/hunt)</th></tr></thead>
   <tbody>{lines.map(line => <tr key={line.label}>
    <th scope="row">{line.label}{line.hint && !compact && <small>{line.hint}</small>}</th>
    <td className="src observed" title={compact ? line.total : undefined}>{line.value === null ? <b className="wait">—</b> : <b key={show(line.value,line.small)} title={`${rare(line.value)} por hora`}>{show(line.value,line.small)}</b>}<small>{line.total}</small></td>
    <td className="src forecast">{line.forecast === null ? <small title={compact ? line.noForecast ?? none : undefined}>{compact ? '—' : line.noForecast ?? none}</small> : <span title={`${rare(line.forecast)} por hora`}>{line.approx ? '≈' : ''}{show(line.forecast,line.small)}</span>}</td>
   </tr>)}</tbody>
  </table>
  {warming && <p className="live-note" role="status"><Icon d={icons.warn}/>Amostra curta: as taxas por hora aparecem com 2 min de medição (faltam {clock(LIVE_MIN_SAMPLE_MS - sample).slice(3)}). Os totais já contam.</p>}
  {!warming && t.kills === 0 && <p className="live-note" role="status"><Icon d={icons.warn}/>Nenhum abate lido até agora. Confira se a conta está caçando e se o log de mensagens do jogo está visível.</p>}
  {session.lostLines > 0 && <p className="live-note"><Icon d={icons.warn}/>Parte do log não foi lida; as taxas podem estar subestimadas.</p>}
  {error && <p role="alert">{error}</p>}
  {!compact && <p className="legend">Observado: lido do log de mensagens do jogo nesta sessão, só leitura, atualizado a cada 5 s. Previsto: cálculo da extensão /hunt. Os dois nunca são somados.</p>}
 </section>;
}
