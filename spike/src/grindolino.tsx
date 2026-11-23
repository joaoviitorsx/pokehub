import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Profile } from '../domain/profiles';
import { GRINDOLINO_MODEL_VERSION, type CompareRow, type Hunt, type Measurement, type Objective, type RankRow } from '../contracts/grindolino';
import { checkForecast, checkHunt, checkMeasurement, fieldsChanged, formatCompact, formatDelta, formatFull, parseCount, type Checked } from './grindolino-form';
import { El, Icon, icons, Professor } from './icons';
import { LivePanel } from './live';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
type Open = {kind:'hunt'; hunt:Hunt | null} | {kind:'forecast' | 'measurement'; hunt:Hunt};

const quotes = [
 'Hipótese: mais XP. Método: grind. Conclusão: mais grind.',
 'Eureka! Quer dizer… quase. Preciso de mais amostras.',
 'A ciência exige sacrifícios. O seu é ficar mais uma hora na hunt.',
 'Correlação não é causalidade, mas XP é XP.',
 'Meu laboratório tem três regras: medir, anotar e grindar.',
 'Segundo meus cálculos, falta só mais um pouquinho. Sempre falta.',
 'Dado bom é dado anotado. O resto é boato de taverna.',
 'Não é vício, é coleta de dados em campo.',
];
export const ask = <T,>(call:Promise<unknown>, fallback = 'Falha de comunicação com o aplicativo.') => (call as Promise<Result<T>>).catch(():Result<T> => ({ok:false,error:fallback}));
const compareUnavailable = 'A comparação entre contas ainda não está disponível nesta versão. O ranking “Por conta” continua funcionando.';
const when = (iso:string) => new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
// Abates/h e shiny/h só existem nas medições ao vivo.
const pace = (seen:{killsPerHour:number|null; shinyPerHour:number|null}|null) => seen?.killsPerHour != null ? <small>{formatFull(seen.killsPerHour)} abates/h{seen.shinyPerHour != null && ` · ${seen.shinyPerHour.toLocaleString('pt-BR',{maximumFractionDigits:2})} shiny/h`}</small> : null;
const emptyRow = (hunt:Hunt):RankRow => ({hunt,eligible:true,ineligibleReason:null,forecast:null,observed:null,sortValue:null,sortSource:null,deltaRatio:null,warnings:[]});

// Arte original: cientista de cabelo espetado, óculos enormes, jaleco e frasco borbulhante.

export function Grindolino({profiles,initialAccount,onClose,onDirty}:{profiles:Profile[]; initialAccount?:string; onClose:()=>void; onDirty:(dirty:boolean)=>void}) {
 const api = window.pokehub.grindolino;
 const [quote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);
 const [accountId,setAccountId] = useState(initialAccount ?? profiles[0]?.id ?? '');
 const [objective,setObjective] = useState<Objective>('xp');
 const [level,setLevel] = useState('');
 const [settledLevel,setSettledLevel] = useState('');
 const [view,setView] = useState<'account'|'compare'>('account');
 const [compareRows,setCompareRows] = useState<CompareRow[] | null>(null);
 const [compareError,setCompareError] = useState('');
 const [rows,setRows] = useState<RankRow[] | null>(null);
 const [recent,setRecent] = useState<Measurement[]>([]);
 const [open,setOpen] = useState<Open | null>(null);
 const [fields,setFields] = useState<Record<string,string>>({});
 const [initialFields,setInitialFields] = useState<Record<string,string>>({});
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState('');
 const [notice,setNotice] = useState('');
 const request = useRef(0);
 const compareRequest = useRef(0);
 const parsedLevel = parseCount(level);
 const levelInvalid = parsedLevel !== null && !(parsedLevel >= 1);
 // O ranking só é refeito 250 ms depois da última tecla no nível.
 useEffect(() => {const timer = setTimeout(() => setSettledLevel(level),250);return () => clearTimeout(timer);},[level]);
 const settled = parseCount(settledLevel);
 const trainerLevel = settled !== null && settled >= 1 ? settled : null;
 const dirty = open !== null && fieldsChanged(initialFields,fields);
 useEffect(() => {onDirty(dirty);return () => onDirty(false);},[dirty,onDirty]);
 const canLeaveForm = () => !dirty || window.confirm('Descartar alterações não salvas?');
 const rateKey = objective === 'xp' ? 'xpPerHour' : 'coinsPerHour';
 const unit = objective === 'xp' ? 'XP/h' : 'Coins/h';

 async function load() {
   if (!api || !accountId) return;
   const current = ++request.current;
   const [hunts,ranked,measurements] = await Promise.all([ask<Hunt[]>(api.listHunts()),ask<RankRow[]>(api.rank({accountId,objective,trainerLevel})),ask<Measurement[]>(api.listMeasurements(accountId))]);
   if (current !== request.current) return; // resposta de uma seleção anterior
   if (!hunts.ok || !ranked.ok || !measurements.ok) {setError([hunts,ranked,measurements].find(result => !result.ok)?.error ?? '');return;}
   // Hunts sem dados aparecem mesmo que o ranking não as devolva.
   setRows([...ranked.data,...hunts.data.filter(hunt => !ranked.data.some(row => row.hunt.id === hunt.id)).map(emptyRow)]);
   setRecent(measurements.data);
 }
 // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- carga assíncrona via IPC; load depende só destes valores
 useEffect(() => {void load();},[accountId,objective,trainerLevel]);

 async function loadCompare() {
   if (!api) return;
   const current = ++compareRequest.current;
   const result:Result<CompareRow[]> = typeof api.compare === 'function' ? await ask<CompareRow[]>(api.compare({objective}),'Não foi possível comparar as contas agora. Tente de novo em instantes; o ranking “Por conta” continua funcionando.') : {ok:false,error:compareUnavailable};
   if (current !== compareRequest.current) return;
   if (result.ok && Array.isArray(result.data)) {setCompareRows(result.data);setCompareError('');}
   else {setCompareRows(null);setCompareError(result.ok ? compareUnavailable : result.error);}
 }
 // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- carga assíncrona via IPC; só quando a comparação está visível
 useEffect(() => {if (view === 'compare') void loadCompare();},[view,objective]);

 function show(next:Open, values:Record<string,string> = {}) {if (!canLeaveForm()) return;setOpen(next);setFields(values);setInitialFields(values);setError('');setNotice('');}
 function leaveForm(then:() => void) {if (!canLeaveForm()) return;setOpen(null);setError('');setNotice('');then();}
 const field = (name:string) => ({value:fields[name] ?? '', onChange:(event:{target:{value:string}}) => setFields({...fields,[name]:event.target.value})});
 async function run(call:() => Promise<unknown>, done:string) {
   setBusy(true);setError('');setNotice('');
   const result = await ask<unknown>(call());
   setBusy(false);
   if (!result.ok) {setError(result.error);return;}
   setOpen(null);setNotice(done);await load();
 }
 function submit(event:FormEvent) {
   event.preventDefault();
   if (!api || !open || busy) return;
   const text = (name:string) => fields[name] ?? '';
   const send = <T,>(checked:Checked<T>, call:(value:T) => Promise<unknown>, done:string) => checked.ok ? void run(() => call(checked.value),done) : setError(checked.error);
   if (open.kind === 'hunt') {const hunt = open.hunt;send(checkHunt({name:text('name'),region:text('region'),level:text('level')}),input => hunt ? api.updateHunt(hunt.id,input) : api.createHunt(input),hunt ? 'Hunt atualizada.' : 'Hunt cadastrada. Agora registre a previsão do jogo ou uma medição.');}
   else if (open.kind === 'forecast') send(checkForecast({xp:text('xp'),coins:text('coins')}),value => api.addForecast({accountId,huntId:open.hunt.id,...value}),'Previsão do jogo registrada.');
   else send(checkMeasurement({minutes:text('minutes'),xp:text('xp'),coins:text('coins')}),value => api.addMeasurement({accountId,huntId:open.hunt.id,...value}),'Medição registrada. A ciência agradece.');
 }
 function removeHunt(hunt:Hunt) {
   if (!api || !window.confirm(`Remover a hunt “${hunt.name}”? Todas as previsões e medições dela, em todas as contas, serão apagadas. Esta ação não pode ser desfeita.`)) return;
   void run(() => api.removeHunt(hunt.id),'Hunt removida, com suas previsões e medições.');
 }
 function removeMeasurement(measurement:Measurement, huntName:string) {
   if (!api || !window.confirm(`Remover a medição de ${when(measurement.recordedAt)} em “${huntName}”?`)) return;
   void run(() => api.removeMeasurement(measurement.id),'Medição removida.');
 }

 const account = profiles.find(profile => profile.id === accountId);
 const ranked = rows?.filter(row => row.eligible && row.sortValue !== null) ?? [];
 const huntName = (id:string) => rows?.find(row => row.hunt.id === id)?.hunt.name ?? 'Hunt removida';
 const head = <header className="grind-head"><Professor/><div><h1>Professor Grindolino</h1><p className="quote">{quote}</p></div><button onClick={onClose}>Voltar</button></header>;
 const foot = <p className="note">Modelo {GRINDOLINO_MODEL_VERSION}: só usa números que você digitou ou mediu ao vivo; não calcula combate. Nas medições ao vivo o XP é o do treinador.</p>;

 const compareView = <>
  <div className="grind-title"><h2>Comparação entre contas por {unit}</h2></div>
  {compareError && <p role="alert">{compareError}</p>}
  {compareRows === null && !compareError && <p>Alinhando as contas na bancada…</p>}
  {compareRows?.length === 0 && <div className="bubble"><h2>Nada para comparar ainda</h2><p>Cadastre hunts e registre previsões ou medições em “Por conta”. Depois eu coloco as contas lado a lado.</p><button className="primary" onClick={() => setView('account')}>Ir para “Por conta”</button></div>}
  {compareRows !== null && compareRows.length > 0 && <><div className="grind-scroll"><table className="cmp">
   <thead><tr><th scope="col">Hunt</th>{profiles.map(profile => <th scope="col" key={profile.id} style={{'--c':profile.colorToken} as CSSProperties}><El color={profile.colorToken}/>{profile.label}</th>)}</tr></thead>
   <tbody>{compareRows.map(row => <tr key={row.hunt.id}>
    <th scope="row"><strong>{row.hunt.name}</strong><small>{[row.hunt.region,row.hunt.requiredTrainerLevel === null ? null : `nível ${row.hunt.requiredTrainerLevel}`].filter(Boolean).join(' · ') || 'sem região'}</small></th>
    {profiles.map(profile => {
     const cell = row.cells.find(item => item.accountId === profile.id);
     const observed = cell?.observedPerHour ?? null, forecast = cell?.forecastPerHour ?? null, value = observed ?? forecast;
     if (!cell || value === null || row.missingAccountIds.includes(profile.id)) return <td key={profile.id} className="none"><small>sem dados</small></td>;
     const best = row.bestAccountId === profile.id;
     return <td key={profile.id} data-source={observed === null ? 'forecast' : 'observed'} className={best ? 'best' : undefined}>
      <span className="val"><Icon d={observed === null ? icons.screen : icons.stopwatch}/><span title={`${formatFull(value)} ${unit}`}>{formatCompact(value)}</span><em>{observed === null ? 'Previsto' : 'Observado'}</em></span>
      <small>{observed === null ? 'sem medição' : `${cell.samples} ${cell.samples === 1 ? 'amostra' : 'amostras'} · ${formatFull(cell.totalMinutes)} min`}</small>
      {pace(cell)}
      {observed !== null && forecast !== null && <small>previsto pelo jogo: <span title={`${formatFull(forecast)} ${unit}`}>{formatCompact(forecast)}</span></small>}
      {best && <span className="best-tag"><Icon d={icons.crown}/>Melhor conta</span>}
     </td>;})}
   </tr>)}</tbody>
  </table></div>
  <p className="legend">Cada célula mostra o observado quando existe; senão, o previsto pelo jogo. Contas não são somadas: regras de spawn compartilhado ainda não confirmadas.</p></>}
 </>;

 if (!api || !account) return <section className="panel grind">{head}
  <div className="bubble"><h2>{api ? 'Cadê as cobaias?' : 'O laboratório ainda está em obras'}</h2><p>{api ? 'Preciso de pelo menos uma conta para analisar. Crie um perfil no botão “Perfil” da barra e volte aqui.' : 'O Professor ainda está montando os equipamentos nesta versão do PokéHub. Nenhum dado foi perdido; volte após a próxima atualização.'}</p></div>
  {foot}</section>;

 return <section className="panel grind" aria-busy={busy}>{head}
  <div className="grind-controls">
   <div className="ctl"><span id="grind-view">Visão</span><div className="seg" role="group" aria-labelledby="grind-view"><button aria-pressed={view === 'account'} onClick={() => leaveForm(() => setView('account'))}>Por conta</button><button aria-pressed={view === 'compare'} onClick={() => leaveForm(() => setView('compare'))}>Comparar contas</button></div></div>
   {view === 'account' && <div className="ctl"><span id="grind-account">Conta analisada</span><div className="accounts" role="group" aria-labelledby="grind-account">{profiles.map(profile => <button key={profile.id} className="tab" style={{'--c':profile.colorToken} as CSSProperties} aria-pressed={profile.id === accountId} onClick={() => leaveForm(() => setAccountId(profile.id))}><El color={profile.colorToken}/><span className="name">{profile.label}</span></button>)}</div></div>}
   <div className="ctl"><span id="grind-objective">Objetivo</span><div className="seg" role="group" aria-labelledby="grind-objective"><button aria-pressed={objective === 'xp'} onClick={() => setObjective('xp')}>XP/h</button><button aria-pressed={objective === 'coins'} onClick={() => setObjective('coins')}>Coins/h</button></div></div>
   {view === 'account' && <label className="ctl level">Nível do treinador (opcional)<input inputMode="numeric" maxLength={6} placeholder="ex.: 150" aria-invalid={levelInvalid} aria-describedby="grind-level-hint" value={level} onChange={event => setLevel(event.target.value)}/><small id="grind-level-hint">{levelInvalid ? 'Use um número inteiro a partir de 1.' : 'Só marca hunts fora do seu nível. Não é salvo.'}</small></label>}
  </div>

  {open && <form className="grind-form" noValidate aria-busy={busy} aria-describedby={error ? 'grind-error' : undefined} onSubmit={submit} key={`${open.kind}-${open.hunt?.id ?? 'new'}`}>
   {open.kind === 'hunt' && <><h2>{open.hunt ? `Editar hunt “${open.hunt.name}”` : 'Cadastrar hunt'}</h2><div className="fields"><label>Nome da hunt<input autoFocus required maxLength={60} {...field('name')}/></label><label>Região (opcional)<input maxLength={40} {...field('region')}/></label><label>Nível de treinador exigido (opcional)<input inputMode="numeric" maxLength={6} {...field('level')}/></label></div></>}
   {open.kind === 'forecast' && <><h2><Icon d={icons.screen}/>Previsão do jogo para “{open.hunt.name}” · {account.label}</h2><p>Copie os valores que o Hunt Analyser do jogo mostra para esta conta. Preencha pelo menos um.</p><div className="fields"><label>XP por hora (previsto)<input autoFocus inputMode="numeric" maxLength={19} placeholder="ex.: 1.250.000" {...field('xp')}/></label><label>Coins por hora (previsto)<input inputMode="numeric" maxLength={19} placeholder="ex.: 80.000" {...field('coins')}/></label></div></>}
   {open.kind === 'measurement' && <><h2><Icon d={icons.stopwatch}/>Medição em “{open.hunt.name}” · {account.label}</h2><p>Anote quanto você ganhou de verdade em um intervalo. O Professor calcula a taxa por hora.</p><div className="fields"><label>Duração (minutos)<input autoFocus required inputMode="numeric" maxLength={4} placeholder="1 a 1440" {...field('minutes')}/></label><label>XP ganho<input inputMode="numeric" maxLength={19} placeholder="ex.: 640.000" {...field('xp')}/></label><label>Coins ganhos<input inputMode="numeric" maxLength={19} placeholder="ex.: 41.000" {...field('coins')}/></label></div></>}
   <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Salvando…' : open.kind === 'hunt' ? 'Salvar hunt' : open.kind === 'forecast' ? 'Registrar previsão' : 'Registrar medição'}</button><button type="button" disabled={busy} onClick={() => leaveForm(() => {})}>Cancelar</button>{open.kind === 'hunt' && open.hunt && <button type="button" className="danger push" disabled={busy} onClick={() => removeHunt(open.hunt!)}><Icon d={icons.trash}/>Remover hunt</button>}</div>
  </form>}
  {error && <p role="alert" id="grind-error">{error}</p>}
  <p role="status" className={notice ? undefined : 'sr'}>{notice}</p>

  {view === 'compare' ? compareView : <>
  <LivePanel key={account.id} account={account} onSaved={() => void load()}/>
  <div className="grind-title"><h2>Ranking de {account.label} por {unit}</h2><button disabled={busy} onClick={() => show({kind:'hunt',hunt:null})}><Icon d={icons.plus}/>Nova hunt</button></div>
  {rows === null && !error && <p>Aquecendo os tubos de ensaio…</p>}
  {rows?.length === 0 && <div className="bubble"><h2>Sem dados, sem ciência!</h2><p>Me traga uma hunt: cadastre o nome, copie a previsão do Hunt Analyser do jogo e depois meça o que você ganhou de verdade. Eu comparo os dois e digo quem está mentindo.</p><button className="primary" disabled={busy} onClick={() => show({kind:'hunt',hunt:null})}>Cadastrar primeira hunt</button></div>}
  {rows !== null && rows.length > 0 && <div className="grind-scroll"><table>
   <thead><tr><th scope="col"><span className="sr">Posição</span>#</th><th scope="col">Hunt</th><th scope="col" className="src forecast"><Icon d={icons.screen}/>Previsto (jogo)</th><th scope="col" className="src observed"><Icon d={icons.stopwatch}/>Observado (você)</th><th scope="col">Diferença</th><th scope="col"><span className="sr">Ações</span></th></tr></thead>
   <tbody>{rows.map(row => {
    const position = ranked.indexOf(row) + 1;
    const forecast = row.forecast?.[rateKey] ?? null, observed = row.observed?.[rateKey] ?? null;
    const delta = row.deltaRatio === null ? null : formatDelta(row.deltaRatio);
    const used = (source:string) => row.sortSource === source ? <span className="sr"> (usado no ranking)</span> : null;
    return <tr key={row.hunt.id} className={row.eligible ? undefined : 'off'}>
     <td className="pos">{position || '—'}</td>
     <th scope="row"><strong>{row.hunt.name}</strong><small>{[row.hunt.region,row.hunt.requiredTrainerLevel === null ? null : `nível ${row.hunt.requiredTrainerLevel}`].filter(Boolean).join(' · ') || 'sem região'}</small>
      {!row.eligible && <span className="badge"><b>Inelegível</b>{row.ineligibleReason ?? 'Nível insuficiente'}</span>}
      {row.warnings.map(warning => <span className="warning" key={warning}><Icon d={icons.warn}/>{warning}</span>)}</th>
     <td className="src forecast" data-used={row.sortSource === 'forecast'}>{forecast === null ? <small>sem previsão</small> : <><span title={`${formatFull(forecast)} ${unit}`}>{formatCompact(forecast)}</span>{used('forecast')}<small>lido em {when(row.forecast!.readAt)}</small></>}</td>
     <td className="src observed" data-used={row.sortSource === 'observed'}>{observed === null ? <small>sem medição</small> : <><span title={`${formatFull(observed)} ${unit}`}>{formatCompact(observed)}</span>{used('observed')}<small>{row.observed!.samples} {row.observed!.samples === 1 ? 'amostra' : 'amostras'} · {formatFull(row.observed!.totalMinutes)} min</small></>}{pace(row.observed)}</td>
     <td className="delta" data-tone={delta?.tone}>{delta ? delta.text : <small>sem comparação</small>}</td>
     <td className="row-actions"><button disabled={busy} title={`Registrar previsão do jogo para ${row.hunt.name}`} onClick={() => show({kind:'forecast',hunt:row.hunt})}>Previsão</button><button disabled={busy} title={`Registrar medição em ${row.hunt.name}`} onClick={() => show({kind:'measurement',hunt:row.hunt})}>Medição</button><button className="icon" disabled={busy} aria-label={`Editar ou remover ${row.hunt.name}`} title={`Editar ou remover ${row.hunt.name}`} onClick={() => show({kind:'hunt',hunt:row.hunt},{name:row.hunt.name,region:row.hunt.region,level:row.hunt.requiredTrainerLevel?.toString() ?? ''})}><Icon d={icons.edit}/></button></td>
    </tr>;})}</tbody>
  </table></div>}
  {rows !== null && rows.length > 0 && <p className="legend">O valor em destaque ordena o ranking: o observado tem prioridade quando existe. Previsto e observado nunca são somados.</p>}

  {recent.length > 0 && <><h2 className="recent-title">Medições recentes de {account.label}</h2><ul className="recent">{recent.map(measurement => { const name = huntName(measurement.huntId); return <li key={measurement.id}><span><strong>{name}</strong><small>{when(measurement.recordedAt)} · {measurement.minutes} min{measurement.killCount != null && ` · ${formatFull(measurement.killCount)} abates · ao vivo`}</small></span><span className="gain">{measurement.xpGained !== null && <span title={formatFull(measurement.xpGained)}>{formatCompact(measurement.xpGained)} XP</span>}{measurement.coinsGained !== null && <span title={formatFull(measurement.coinsGained)}>{formatCompact(measurement.coinsGained)} Coins</span>}</span><button className="icon" disabled={busy} aria-label={`Remover medição de ${when(measurement.recordedAt)} em ${name}`} title="Remover medição" onClick={() => removeMeasurement(measurement,name)}><Icon d={icons.trash}/></button></li>;})}</ul></>}
  </>}
  {foot}
 </section>;
}
