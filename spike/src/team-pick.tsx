import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TeamMetric, TeamPick } from '../contracts/team';
import { recommend, tempoAte, tipoCor, tipoNome } from '../domain/team-pick';
import { Icon, icons } from './icons';
import { Sprite } from './hunt-side';

const METRICS: [TeamMetric, string, string][] = [['treinador', 'XP treinador', 'XP do treinador'], ['ouro', 'Ouro', 'ouro'], ['pokemon', 'Upar', 'XP do Pokémon']];
const compact = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const short = (value: number) => value >= 10_000 ? compact.format(value) : full.format(value);
const PREFS_KEY = 'pokehub.teampick';
const REFRESH_MS = 120_000;
function loadPrefs(): {open: boolean; metric: TeamMetric} {
  try { const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as {open?: unknown; metric?: unknown}; return {open: v.open !== false, metric: METRICS.some(([k]) => k === v.metric) ? v.metric as TeamMetric : 'treinador'}; } catch { return {open: true, metric: 'treinador'}; }
}
type Entry = {data: TeamPick} | {error: string};

/** "Quem colocar em campo?" + tipagem do dia, para a conta escolhida na lateral. Só lê com o cartão aberto e a aba Caçar visível. */
export function TeamPickCard({id, live, active}: {id: string | undefined; live: boolean; active: boolean}) {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* só não persiste */ } }, [prefs]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const force = useRef(false);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (!id || !live || !active || !prefs.open) return;
    let alive = true, timer = 0;
    const read = async () => {
      if (!document.hidden) {
        setBusy(true);
        const result = await window.pokehub.huntTeam(id, force.current).catch(() => ({ok: false as const, error: 'Falha de comunicação com o aplicativo.'}));
        force.current = false;
        if (!alive) return;
        setBusy(false); setNow(Date.now());
        setEntries(old => ({...old, [id]: result.ok ? {data: result.data} : old[id] && 'data' in old[id]! ? old[id]! : {error: result.error}}));
      }
      if (alive) timer = window.setTimeout(() => void read(), REFRESH_MS);
    };
    void read();
    return () => { alive = false; clearTimeout(timer); setBusy(false); };
  }, [id, live, active, prefs.open, stamp]);
  const entry = id ? entries[id] : undefined;
  const pick = entry && 'data' in entry && entry.data.estado === 'ok' ? entry.data : null;
  const metric = prefs.metric;
  const rec = pick ? recommend(pick.membros, metric) : null;
  const label = METRICS.find(([k]) => k === metric)![2];
  const top = rec?.ordenados[0]?.melhor[metric]?.valor ?? 0;
  const doTipo = pick?.membros.filter(m => m.tipoDoDia && m.equipe).length ?? 0;
  const refresh = () => { force.current = true; setStamp(v => v + 1); };
  if (!active) return null;
  return <section className="tp" aria-label="Quem colocar em campo?">
    {pick?.tipoDoDia && <div className="tp-day" style={{'--t': tipoCor(pick.tipoDoDia)} as CSSProperties} title="Todo dia uma das 18 tipagens fica 2× mais forte nas hunts (ataque, defesa e vida), selvagens também.">
      <span className="tp-type">{tipoNome(pick.tipoDoDia)}</span><b>2× hoje</b>
      <small>{doTipo ? `${doTipo} na equipe` : 'ninguém da equipe'}{tempoAte(pick.tipoFim, now) && ` · troca em ${tempoAte(pick.tipoFim, now)}`}</small>
    </div>}
    <header className="tp-head">
      <button className="tp-toggle" aria-expanded={prefs.open} onClick={() => setPrefs(p => ({...p, open: !p.open}))}><Icon d={icons.swap}/><h3>Quem colocar em campo?</h3><Icon d={prefs.open ? icons.minus : icons.plus}/></button>
      {prefs.open && <button className="icon" aria-label="Analisar a equipe de novo" title="Analisar de novo (leva alguns segundos)" disabled={busy || !live} onClick={refresh}><Icon d={icons.reload}/></button>}
    </header>
    {prefs.open && <div className="tp-body" aria-busy={busy}>
      <div className="seg" role="group" aria-label="Comparar por" style={{'--n': METRICS.length, '--i': METRICS.findIndex(([k]) => k === metric)} as CSSProperties}>{METRICS.map(([k, text]) => <button key={k} aria-pressed={metric === k} onClick={() => setPrefs(p => ({...p, metric: k}))}>{text}</button>)}</div>
      {!live ? <p className="tp-msg">A sessão desta conta precisa estar aberta e logada.</p>
        : !entry ? <p className="tp-msg" role="status"><span className="tp-spin" aria-hidden="true"/>Calculando cada Pokémon da equipe…</p>
        : 'error' in entry ? <p className="tp-msg">{entry.error}</p>
        : entry.data.estado === 'sem-extensao' ? <p className="tp-msg">Precisa da extensão /hunt ativa nesta conta (Gerenciar → Extensões).</p>
        : entry.data.estado !== 'ok' ? <p className="tp-msg">Entre no jogo nesta conta e coloque um Pokémon em campo.</p>
        : rec && <>
          <div className="tp-rec" data-manter={rec.manter || undefined}>
            {rec.manter && rec.emCampo ? <><Icon d={icons.check}/><div><strong>{rec.emCampo.nome} já é o melhor em campo</strong><small>{rec.emCampo.melhor[metric] ? `${short(rec.emCampo.melhor[metric]!.valor)} de ${label}/h em ${rec.emCampo.melhor[metric]!.nome}` : 'sem hunt liberada para comparar'}</small></div></>
              : rec.melhor ? <><Icon d={icons.swap}/><div><strong>Coloque {rec.melhor.nome} Nv {full.format(rec.melhor.nivel)}</strong><small>{rec.ganho !== null && rec.ganho > 0 ? `+${Math.round(rec.ganho * 100)}% de ${label} · ` : ''}{short(rec.melhor.melhor[metric]!.valor)}/h em {rec.melhor.melhor[metric]!.nome}{rec.melhor.tipoDoDia ? ' · 2× hoje' : ''}</small><em>Clique nele na Equipe do jogo para pôr em campo.</em></div></>
              : <div><strong>Nenhuma hunt liberada para comparar</strong></div>}
          </div>
          {rec.colecao && <p className="tp-extra"><Icon d={icons.spark}/><span>Na coleção, <b>{rec.colecao.membro.nome} Nv {full.format(rec.colecao.membro.nivel)}</b> renderia {rec.colecao.ganho > 0 ? `+${Math.round(rec.colecao.ganho * 100)}%` : 'mais'}{rec.colecao.membro.tipoDoDia ? ' (2× hoje)' : ''}. Coloque-o na equipe para poder usar.</span></p>}
          <ol className="tp-list">{rec.ordenados.map((m, i) => { const best = m.melhor[metric]; return <li key={m.chave} data-ativo={m.ativo || undefined} data-colecao={!m.equipe || undefined} style={{'--i': i, '--p': top > 0 && best ? Math.max(.03, best.valor / top) : 0} as CSSProperties}>
            <Sprite sprite={m.sprite} name={m.nome} size={30}/>
            <div className="who"><strong title={m.nome}>{m.nome}</strong><small>Nv {full.format(m.nivel)}{m.potencia ? ` · P${m.potencia}` : ''}{m.tipos.length ? ` · ${m.tipos.map(tipoNome).join('/')}` : ''}</small>
              <span className="tp-tags">{m.ativo && <i data-k="campo">em campo</i>}{!m.equipe && <i data-k="colecao">coleção</i>}{m.tipoDoDia && <i data-k="dia" style={{'--t': tipoCor(pick!.tipoDoDia)} as CSSProperties}>2× hoje</i>}</span></div>
            <div className="val"><b>{best ? short(best.valor) : '—'}</b><small title={best?.nome}>{best ? best.nome : 'sem hunt'}</small></div>
            <i className="meter" aria-hidden="true"/>
          </li>; })}</ol>
          <p className="side-foot">Melhor hunt liberada de cada um, pelo cálculo da /hunt com a tipagem do dia. Equipe e os 3 mais fortes da coleção. {busy ? 'Atualizando…' : `Lido às ${new Date(pick!.lidoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}.`}</p>
        </>}
    </div>}
  </section>;
}
