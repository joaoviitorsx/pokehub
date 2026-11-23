import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Profile } from '../domain/profiles';
import { METRIC_UNITS, SMALL_SAMPLE_MINUTES, type AnalyticsRange, type ExportResult, type Metric, type SeriesPoint, type SeriesResult } from '../contracts/analytics';
import type { Hunt } from '../contracts/grindolino';
import { bucketDate } from '../domain/analytics';
import { axisTicks, lineColor, spread } from './analytics-chart';
import { formatCompact, formatDelta } from './grindolino-form';
import { El, Icon, icons, Professor } from './icons';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
const ask = <T,>(call:Promise<unknown>) => (call as Promise<Result<T>>).catch(():Result<T> => ({ok:false,error:'Falha de comunicação com o aplicativo.'}));

const metrics:[Metric,string][] = [['xp','XP/h'],['coins','Ouro/h'],['kills','Abates/h'],['shiny','Shiny/h']];
const ranges:[AnalyticsRange,string,string][] = [['7d','7 dias','nos últimos 7 dias'],['30d','30 dias','nos últimos 30 dias'],['90d','90 dias','nos últimos 90 dias'],['all','Tudo','em todo o histórico']];
const quotes = [
 'Um ponto é um boato. Dois são uma reta. Três já dão um artigo.',
 'Todo gráfico sobe, se você escolher bem o eixo. Aqui o eixo começa no zero.',
 'A curva não mente. Quem mente é a memória de quem grindou.',
 'Linha cheia é o que aconteceu. Tracejada é o que prometeram.',
];
const full = (value:number) => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:value < 10 ? 2 : value < 100 ? 1 : 0}).format(value);
const onAxis = (value:number) => value >= 10_000 ? formatCompact(value) : full(value);
const shortDay = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'});
const longDay = new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
const duration = (minutes:number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
const samplesText = (count:number) => `${count} ${count === 1 ? 'amostra' : 'amostras'}`;
const smallLabel = `Amostra pequena (< ${SMALL_SAMPLE_MINUTES} min)`;

// Forma por posição da conta: a identidade não depende só da cor (perfis podem ter cores iguais).
function markPath(shape:number, x:number, y:number, r = 4.5) {
 if (shape === 1) return `M${x - r * .9} ${y - r * .9}h${r * 1.8}v${r * 1.8}h${-r * 1.8}z`;
 if (shape === 2) return `M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}z`;
 if (shape === 3) return `M${x} ${y - r * 1.2}L${x + r * 1.2} ${y + r * .95}H${x - r * 1.2}z`;
 return `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}
type Line = {id:string; name:string; color:string; shape:number; points:SeriesPoint[]};
const Key = ({line,kind}:{line:Line; kind:'observed'|'forecast'|'small'}) => <svg className="hist-key" viewBox="0 0 26 10" aria-hidden="true" style={{'--c':line.color} as CSSProperties}>
 <path className={kind === 'forecast' ? 'hist-forecast' : 'hist-line'} d="M1 5H25"/>{kind !== 'forecast' && <path className="hist-mark" data-small={kind === 'small' || undefined} d={markPath(line.shape,13,5,3.5)}/>}
</svg>;

const HEIGHT = 280, PAD = {left:52,right:18,top:22,bottom:28};
function Chart({lines,unit,week,label}:{lines:Line[]; unit:string; week:boolean; label:string}) {
 const box = useRef<HTMLDivElement>(null);
 const [width,setWidth] = useState(720);
 const [active,setActive] = useState<number | null>(null);
 useEffect(() => {
   if (!box.current) return;
   const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(320,Math.round(entry.contentRect.width))); });
   observer.observe(box.current);
   return () => observer.disconnect();
 },[]);
 const buckets = [...new Set(lines.flatMap(line => line.points.map(point => point.bucket)))].sort();
 const times = buckets.map(bucket => bucketDate(bucket).getTime());
 const start = times[0] ?? 0, span = (times.at(-1) ?? 0) - start;
 const plotWidth = width - PAD.left - PAD.right, plotHeight = HEIGHT - PAD.top - PAD.bottom;
 const ticks = axisTicks(Math.max(0,...lines.flatMap(line => line.points.flatMap(point => [point.perHour ?? 0,point.forecastPerHour ?? 0]))));
 const top = ticks.at(-1) ?? 1;
 const x = (bucket:string) => PAD.left + (span ? (bucketDate(bucket).getTime() - start) / span * plotWidth : plotWidth / 2);
 const y = (value:number) => PAD.top + plotHeight - value / top * plotHeight;
 const current = active === null ? null : buckets[Math.min(active,buckets.length - 1)] ?? null;
 const crossX = current === null ? 0 : x(current);
 const dayLabel = (bucket:string) => `${week ? 'Semana de ' : ''}${longDay.format(bucketDate(bucket))}`;

 function follow(event:PointerEvent<HTMLDivElement>) {
   const pointer = event.clientX - event.currentTarget.getBoundingClientRect().left;
   let nearest = 0;
   buckets.forEach((bucket,index) => { if (Math.abs(x(bucket) - pointer) < Math.abs(x(buckets[nearest]!) - pointer)) nearest = index; });
   setActive(nearest);
 }
 function step(event:KeyboardEvent) {
   const last = buckets.length - 1, at = active ?? last;
   const next = event.key === 'ArrowLeft' ? Math.max(0,at - 1) : event.key === 'ArrowRight' ? Math.min(last,at + 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'Escape' ? null : undefined;
   if (next === undefined) return;
   event.preventDefault();setActive(next);
 }
 return <div className="hist-plot" ref={box} role="group" tabIndex={0} aria-label={`${label}. Use as setas esquerda e direita para ler cada ponto; os mesmos valores estão resumidos na tabela abaixo.`} onPointerMove={follow} onPointerLeave={() => setActive(null)} onFocus={() => setActive(old => old ?? buckets.length - 1)} onBlur={() => setActive(null)} onKeyDown={step}>
  <svg viewBox={`0 0 ${width} ${HEIGHT}`} height={HEIGHT} aria-hidden="true">
   <text className="hist-axis" x={PAD.left} y={10}>{unit}</text>
   {ticks.map(tick => <g key={tick}><path className="hist-grid" d={`M${PAD.left} ${y(tick)}H${width - PAD.right}`}/><text className="hist-axis" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">{onAxis(tick)}</text></g>)}
   {spread(buckets,Math.max(2,Math.floor(plotWidth / 76))).map(bucket => <text key={bucket} className="hist-axis" x={x(bucket)} y={HEIGHT - 8} textAnchor="middle">{shortDay.format(bucketDate(bucket))}</text>)}
   {current !== null && <path className="hist-cross" d={`M${crossX} ${PAD.top}V${PAD.top + plotHeight}`}/>}
   {lines.map(line => {
    const seen = line.points.filter(point => point.perHour !== null), told = line.points.filter(point => point.forecastPerHour !== null);
    // Previsto em degraus: cada leitura vale até a próxima. Com um ponto só, vira um traço curto na altura prevista.
    const forecast = told.length === 1 ? `M${x(told[0]!.bucket) - 14} ${y(told[0]!.forecastPerHour!)}h28` : told.map((point,index) => index === 0 ? `M${x(point.bucket)} ${y(point.forecastPerHour!)}` : `H${x(point.bucket)}V${y(point.forecastPerHour!)}`).join('');
    return <g key={`${line.id}-${buckets.length}-${top}`} style={{'--c':line.color} as CSSProperties}>
     {told.length > 0 && <path className="hist-forecast" d={forecast}/>}
     {seen.length > 1 && <path className="hist-line" pathLength={1} d={seen.map((point,index) => `${index ? 'L' : 'M'}${x(point.bucket)} ${y(point.perHour!)}`).join('')}/>}
     {seen.map(point => <path key={point.bucket} className="hist-mark" data-small={point.small || undefined} data-on={point.bucket === current || undefined} d={markPath(line.shape,x(point.bucket),y(point.perHour!))}/>)}
    </g>;})}
  </svg>
  {current !== null && <div className="hist-tip" role="status" style={crossX > width / 2 ? {right:width - crossX + 12} : {left:crossX + 12}}>
   <strong>{dayLabel(current)}</strong>
   <ul>{lines.map(line => { const point = line.points.find(item => item.bucket === current); return point && <li key={line.id}>
    <span className="who"><El color={line.color}/>{line.name}</span>
    {point.perHour !== null && <span className="row"><Key line={line} kind={point.small ? 'small' : 'observed'}/><b>{full(point.perHour)}</b> {unit} <small>observado · {samplesText(point.samples)} · {duration(point.minutes)}{point.small && ` · ${smallLabel.toLowerCase()}`}</small></span>}
    {point.forecastPerHour !== null && <span className="row"><Key line={line} kind="forecast"/><b>{full(point.forecastPerHour)}</b> {unit} <small>previsto pelo jogo</small></span>}
   </li>;})}</ul>
  </div>}
 </div>;
}

export function History({profiles,onClose}:{profiles:Profile[]; onClose:()=>void}) {
 const api = window.pokehub.analytics;
 const [quote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);
 const [accountId,setAccountId] = useState<string | null>(null);
 const [huntId,setHuntId] = useState<string | null>(null);
 const [metric,setMetric] = useState<Metric>('xp');
 const [range,setRange] = useState<AnalyticsRange>('30d');
 const [hunts,setHunts] = useState<Hunt[]>([]);
 const [result,setResult] = useState<SeriesResult | null>(null);
 const [error,setError] = useState('');
 const [notice,setNotice] = useState('');
 const [busy,setBusy] = useState(false);
 useEffect(() => { void ask<Hunt[]>(window.pokehub.grindolino?.listHunts() ?? Promise.reject(new Error())).then(list => { if (list.ok) setHunts(list.data); }); },[]);
 useEffect(() => {
   if (!api) return;
   let stale = false; // resposta de um filtro anterior
   void ask<SeriesResult>(api.series({accountId,huntId,metric,range})).then(response => {
     if (stale) return;
     if (response.ok) {setResult(response.data);setError('');} else {setResult(null);setError(response.error);}
   });
   return () => {stale = true;};
 },[api,accountId,huntId,metric,range]);
 async function save(format:'csv'|'json') {
   if (!api || busy) return;
   setBusy(true);setError('');setNotice('');
   const response = await ask<ExportResult>(api.export({format,scope:{accountId,huntId,range}}));
   setBusy(false);
   if (!response.ok) setError(response.error);
   else if (response.data.saved) setNotice(`Arquivo “${response.data.fileName}” salvo com ${response.data.rows} ${response.data.rows === 1 ? 'registro' : 'registros'} e os agregados por dia.`);
 }

 const unit = METRIC_UNITS[metric];
 const head = <header className="grind-head"><Professor/><div><h1>Histórico</h1><p className="quote">{quote}</p></div><button onClick={onClose}>Voltar</button></header>;
 const foot = <p className="note">Só usa as medições e as previsões que você registrou neste computador. A exportação leva o apelido das contas, as hunts, as medições, as previsões e os agregados por dia; nunca e-mail, login, cookies ou pastas do perfil.</p>;
 if (!api || profiles.length === 0) return <section className="panel grind hist">{head}
  <div className="bubble"><h2>{api ? 'Cadê as cobaias?' : 'O arquivo do laboratório ainda está em obras'}</h2><p>{api ? 'Sem conta não há histórico. Crie um perfil no botão “Perfil” da barra, meça uma hunt e volte aqui.' : 'Esta versão do PokéHub ainda não abre o histórico. Nenhum dado foi perdido; volte após a próxima atualização.'}</p></div>
  {foot}</section>;

 const lines:Line[] = (result?.series ?? []).flatMap(series => { const index = profiles.findIndex(profile => profile.id === series.accountId), profile = profiles[index]; return profile ? [{id:profile.id,name:profile.label,color:lineColor(profile.colorToken),shape:index % 4,points:series.points}] : []; });
 const empty = result !== null && lines.every(line => line.points.length === 0);
 const week = result?.granularity === 'week';
 const compare = result?.series.some(series => series.summary.forecastPerHour !== null) ?? false;
 const anySmall = lines.some(line => line.points.some(point => point.small));
 const hunt = hunts.find(item => item.id === huntId);
 const period = ranges.find(([value]) => value === range)?.[2] ?? '';
 const title = `${unit} por ${week ? 'semana' : 'dia'} · ${accountId === null ? 'todas as contas' : profiles.find(profile => profile.id === accountId)?.label ?? ''}${hunt ? ` · ${hunt.name}` : ''}`;
 const seg = (index:number) => ({'--n':4,'--i':index} as CSSProperties);

 return <section className="panel grind hist" aria-busy={busy}>{head}
  <div className="grind-controls">
   <div className="ctl"><span id="hist-account">Conta</span><div className="accounts" role="group" aria-labelledby="hist-account"><button className="tab" aria-pressed={accountId === null} onClick={() => setAccountId(null)}><span className="name">Todas, lado a lado</span></button>{profiles.map(profile => <button key={profile.id} className="tab" style={{'--c':profile.colorToken} as CSSProperties} aria-pressed={profile.id === accountId} onClick={() => setAccountId(profile.id)}><El color={profile.colorToken}/><span className="name">{profile.label}</span></button>)}</div></div>
   <label className="ctl">Hunt<select value={huntId ?? ''} onChange={event => setHuntId(event.target.value || null)}><option value="">Todas as hunts</option>{hunts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <div className="ctl"><span id="hist-metric">Métrica</span><div className="seg" role="group" aria-labelledby="hist-metric" style={seg(metrics.findIndex(([value]) => value === metric))}>{metrics.map(([value,text]) => <button key={value} aria-pressed={value === metric} onClick={() => setMetric(value)}>{text}</button>)}</div></div>
   <div className="ctl"><span id="hist-range">Período</span><div className="seg" role="group" aria-labelledby="hist-range" style={seg(ranges.findIndex(([value]) => value === range))}>{ranges.map(([value,text]) => <button key={value} aria-pressed={value === range} onClick={() => setRange(value)}>{text}</button>)}</div></div>
  </div>
  {error && <p role="alert">{error}</p>}
  {result === null && !error && <p>Desenrolando o papel milimetrado…</p>}
  {empty && <div className="bubble"><h2>Gráfico sem pontos é só papel milimetrado!</h2><p>Não achei medição de {unit} {period}{hunt ? ` em “${hunt.name}”` : ''}. Na Grade, abra “Onde caçar?” (Ctrl+H), inicie uma medição ao vivo e deixe a hunt rodar: quando ela terminar, eu traço a curva aqui.</p>{(range !== 'all' || huntId !== null || metric !== 'xp') && <button className="primary" onClick={() => {setRange('all');setHuntId(null);setMetric('xp');}}>Ver XP/h de todo o histórico</button>}</div>}
  {result !== null && !empty && <>
   <div className="grind-title"><h2>{title}</h2><div className="actions"><button disabled={busy} title="Planilha para Excel, com separador ponto e vírgula" onClick={() => void save('csv')}><Icon d={icons.note}/>Exportar CSV</button><button disabled={busy} onClick={() => void save('json')}><Icon d={icons.note}/>Exportar JSON</button></div></div>
   <figure className="hist-chart">
    <ul className="hist-legend">{lines.length > 1 && lines.map(line => <li key={line.id}><Key line={line} kind="observed"/><span>{line.name}</span></li>)}
     {lines[0] && <><li><Key line={{...lines[0],color:'var(--muted)',shape:lines.length > 1 ? 0 : lines[0].shape}} kind="observed"/>Observado (você)</li>
     {compare && <li><Key line={{...lines[0],color:'var(--muted)'}} kind="forecast"/>Previsto pelo jogo</li>}
     {anySmall && <li><Key line={{...lines[0],color:'var(--muted)',shape:lines.length > 1 ? 0 : lines[0].shape}} kind="small"/>{smallLabel}</li>}</>}
    </ul>
    <Chart lines={lines} unit={unit} week={week} label={`Gráfico de linhas: ${title}, ${period}`}/>
   </figure>
   <p className="legend">Cada ponto é a soma dos ganhos dividida pelo tempo medido {week ? 'na semana (segunda a domingo); com mais de 60 dias de dados os pontos passam a ser semanais' : 'no dia'}. Contas ficam lado a lado e nunca são somadas{compare ? '; previsto e observado também não' : ''}.{!compare && (metric === 'xp' || metric === 'coins') && (huntId === null ? ' Escolha uma hunt para comparar com o previsto pelo jogo.' : ' Esta hunt ainda não tem previsão do jogo registrada.')}{result.duplicatesIgnored > 0 && ` ${result.duplicatesIgnored} ${result.duplicatesIgnored === 1 ? 'medição repetida foi ignorada' : 'medições repetidas foram ignoradas'}.`}</p>
   <div className="grind-scroll"><table>
    <caption className="sr">Resumo {period}, por conta</caption>
    <thead><tr><th scope="col">Conta</th><th scope="col" className="src observed"><Icon d={icons.stopwatch}/>Observado ({unit})</th><th scope="col">Amostras</th><th scope="col">Tempo medido</th>{compare && <><th scope="col" className="src forecast"><Icon d={icons.screen}/>Previsto (jogo)</th><th scope="col">Diferença</th></>}</tr></thead>
    <tbody>{result.series.map(series => { const profile = profiles.find(item => item.id === series.accountId), sum = series.summary, delta = sum.deltaRatio === null ? null : formatDelta(sum.deltaRatio); return profile && <tr key={profile.id}>
     <th scope="row" style={{'--c':profile.colorToken} as CSSProperties}><strong><El color={profile.colorToken}/> {profile.label}</strong></th>
     <td className="src observed" data-used={sum.perHour !== null}>{sum.perHour === null ? <small>sem medição</small> : <><span title={`${full(sum.perHour)} ${unit}`}>{onAxis(sum.perHour)}</span>{sum.small && <span className="warning"><Icon d={icons.warn}/>{smallLabel}</span>}</>}</td>
     <td>{sum.samples}</td><td>{sum.minutes ? duration(sum.minutes) : '—'}</td>
     {compare && <><td className="src forecast">{sum.forecastPerHour === null ? <small>sem previsão</small> : <span title={`${full(sum.forecastPerHour)} ${unit}`}>{onAxis(sum.forecastPerHour)}</span>}</td><td className="delta" data-tone={delta?.tone}>{delta ? delta.text : <small>sem comparação</small>}</td></>}
    </tr>;})}</tbody>
   </table></div>
  </>}
  <p role="status" className={notice ? undefined : 'sr'}>{notice}</p>
  {foot}
 </section>;
}
