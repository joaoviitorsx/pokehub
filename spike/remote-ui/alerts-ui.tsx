// Aba Alertas: histórico, notificações neste celular (Web Push) e preferências de quais alertas receber.
import { useCallback, useEffect, useState } from 'react';
import { ago, get, post, Unauthorized } from './api';
import { PixelIcon } from './pixel-icons';
import { DEFAULT_PREFS, KIND_TEXT, NOTA_DEFAULT, normalizePrefs, pushState, stepNota, type PushState } from './push-helpers';
import { disablePush, enablePush, readPushEnv, sendTest } from './push-client';
import type { AlertKind, AlertPrefs, RemoteAlert } from './r3-types';

type Filter = 'todos' | 'shiny' | 'p5' | 'recorde' | 'nota' | 'conta';
const FILTERS: {id: Filter; label: string}[] = [{id: 'todos', label: 'Todos'}, {id: 'shiny', label: '✨ Shiny'}, {id: 'p5', label: 'P5'}, {id: 'recorde', label: 'Recorde'}, {id: 'nota', label: 'Nota'}, {id: 'conta', label: 'Conta'}];
const matches = (f: Filter, k: AlertKind) => f === 'todos' || (f === 'conta' ? k === 'conta_caiu' || k === 'conta_voltou' : f === k);

export function KindIcon({kind}: {kind: AlertKind}) { return <span className="ak" data-k={kind} role="img" aria-label={KIND_TEXT[kind]}><PixelIcon name={kind} size={22} className="px"/></span>; }

function AlertRow({a, now, color}: {a: RemoteAlert; now: number; color: string | undefined}) {
  return <li className="alert-row" data-kind={a.kind}><KindIcon kind={a.kind}/>
    <div><strong>{KIND_TEXT[a.kind]}</strong><span className="who"><i className="gem" style={{background: color ?? 'var(--pi-vao-dim)'}}/>{a.label}</span><small>{a.text}</small></div>
    <time dateTime={a.at} title={new Date(a.at).toLocaleString('pt-BR')}>{ago(Date.parse(a.at), now)}</time></li>;
}

const STATE_COPY: Record<PushState, {tag: string; text: string}> = {
  'install-ios': {tag: 'Instale o app', text: 'No iPhone, as notificações só funcionam com o PokéHub na Tela de Início.'},
  insecure: {tag: 'Sem HTTPS confiável', text: 'Notificações exigem o certificado do PokéHub instalado e confiável neste celular (HTTPS confiável), com o app ativado.'},
  unsupported: {tag: 'Não suportado', text: 'Este navegador não oferece notificações push para apps da web.'},
  denied: {tag: 'Bloqueado', text: 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone de cadeado, Permissões) e volte aqui.'},
  off: {tag: 'Desligado', text: 'Ligue para receber Shiny, P5, recordes e quedas de conta mesmo com o app fechado.'},
  on: {tag: 'Ligado', text: 'Este celular recebe os alertas escolhidos abaixo.'},
};
export function PushSection({initial = null}: {initial?: PushState | null}) {
  const [state, setState] = useState<PushState | null>(initial), [busy, setBusy] = useState(false), [note, setNote] = useState<{error: boolean; text: string} | null>(null);
  const refresh = useCallback(async () => setState(pushState(await readPushEnv())), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o estado do navegador ao abrir
    if (!initial) void refresh();
  }, [refresh, initial]);
  const run = async (job: () => Promise<{ok: true; sent?: number} | {ok: false; error: string}>, done: (sent?: number) => string) => {
    setBusy(true); setNote(null); const r = await job(); setNote(r.ok ? {error: false, text: done(r.sent)} : {error: true, text: r.error}); await refresh(); setBusy(false);
  };
  const copy = state ? STATE_COPY[state] : null;
  return <section className="card push" aria-labelledby="push-h"><h2 id="push-h">Notificações neste celular</h2>
    {!copy ? <p className="muted" role="status">Verificando…</p> : <>
      <p className="push-state"><span className="st push-tag" data-on={state === 'on' || undefined} data-bad={state === 'denied' || state === 'insecure' || state === 'unsupported' || undefined}><b/><small>{copy.tag}</small></span></p>
      <p>{copy.text}</p>
      {state === 'install-ios' && <ol className="guide"><li>Toque em <strong>Compartilhar</strong> (quadrado com seta) no Safari.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Abra o PokéHub pelo novo ícone e volte a esta aba.</li></ol>}
      {state === 'insecure' && <p className="hint left">Sem o certificado confiável o navegador não registra o service worker, então não há como receber push. Instale o certificado pelo guia do PC (Gerenciar → Acesso remoto) e abra o endereço de novo.</p>}
      <div className="row-btns">
        {state === 'off' && <button className="primary" disabled={busy} onClick={() => void run(enablePush, () => 'Notificações ativadas neste celular.')}>{busy ? 'Aguarde…' : 'Ativar notificações'}</button>}
        {state === 'on' && <><button disabled={busy} onClick={() => void run(sendTest, sent => sent ? `Teste enviado (${sent}).` : 'O PC não encontrou este celular. Desative e ative de novo.')}>Enviar teste</button><button className="danger" disabled={busy} onClick={() => void run(disablePush, () => 'Notificações desativadas.')}>Desativar</button></>}
        {state === 'denied' && <button disabled={busy} onClick={() => void refresh()}>Já liberei</button>}
      </div></>}
    <p role={note?.error ? 'alert' : 'status'} className={note?.error ? 'msg' : 'muted'}>{note?.text ?? ''}</p>
  </section>;
}

export function PrefsEditor() {
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void get<unknown>('/api/alerts/prefs').then(r => { if (alive) setPrefs(normalizePrefs(r)); }).catch(e => { if (alive) { if (!(e instanceof Unauthorized)) setError('Não foi possível ler as preferências.'); setPrefs(DEFAULT_PREFS); } });
    return () => { alive = false; };
  }, []);
  const save = async (next: AlertPrefs) => {
    const before = prefs; setPrefs(next); setError(''); setSaved(false);
    try { const r = await post('/api/alerts/prefs', next); if (!r.ok) throw new Error(r.error); setSaved(true); } catch { setPrefs(before); setError('Não foi possível salvar. Tente de novo.'); }
  };
  if (!prefs) return <section className="card"><h2>Quais alertas receber</h2><p className="muted" role="status">Lendo…</p></section>;
  const flag = (key: 'shiny' | 'p5' | 'recorde' | 'contaCaiu', label: string, kind: AlertKind) => <label className="toggle"><KindIcon kind={kind}/><span>{label}</span><input type="checkbox" role="switch" checked={prefs[key]} onChange={e => void save({...prefs, [key]: e.target.checked})}/><i aria-hidden="true"/></label>;
  return <section className="card"><h2>Quais alertas receber</h2>
    {flag('shiny', 'Shiny capturado', 'shiny')}{flag('p5', 'P5 capturado', 'p5')}{flag('recorde', 'Recorde', 'recorde')}{flag('contaCaiu', 'Conta caiu ou voltou', 'conta_caiu')}
    <div className="toggle nota"><KindIcon kind="nota"/><span>Nota mínima<small>{prefs.notaMin === null ? 'Desligado' : `Avisar a partir de ${prefs.notaMin.toLocaleString('pt-BR')}`}</small></span>
      <div className="stepper" role="group" aria-label="Nota mínima">
        <button aria-label="Diminuir nota mínima" disabled={prefs.notaMin === null || prefs.notaMin <= 0} onClick={() => void save({...prefs, notaMin: stepNota(prefs.notaMin, -1)})}>−</button>
        <output>{prefs.notaMin === null ? '—' : prefs.notaMin.toLocaleString('pt-BR')}</output>
        <button aria-label="Aumentar nota mínima" disabled={prefs.notaMin === null} onClick={() => void save({...prefs, notaMin: stepNota(prefs.notaMin, 1)})}>+</button>
        <button aria-pressed={prefs.notaMin !== null} onClick={() => void save({...prefs, notaMin: prefs.notaMin === null ? NOTA_DEFAULT : null})}>{prefs.notaMin === null ? 'Ligar' : 'Desligar'}</button></div></div>
    <p role={error ? 'alert' : 'status'} className={error ? 'msg' : 'muted'}>{error || (saved ? 'Salvo no PC.' : '')}</p>
  </section>;
}

export function AlertsView({alerts, colors, now, onRefresh}: {alerts: readonly RemoteAlert[]; colors: ReadonlyMap<string, string>; now: number; onRefresh: () => Promise<void>}) {
  const [filter, setFilter] = useState<Filter>('todos'), [busy, setBusy] = useState(false);
  const shown = alerts.filter(a => matches(filter, a.kind));
  const refresh = async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } };
  return <>
    <section className="card"><h2>Histórico de alertas</h2>
      <div className="seg" role="group" aria-label="Filtrar alertas">{FILTERS.map(f => <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}<button onClick={() => void refresh()} disabled={busy}>{busy ? '…' : 'Atualizar'}</button></div>
      {shown.length === 0 ? <p className="muted" role="status">{alerts.length ? 'Nenhum alerta deste tipo.' : 'Nenhum alerta ainda. Shiny, P5, recordes e quedas de conta aparecem aqui.'}</p>
        : <ol className="alert-list" aria-label="Alertas recentes" aria-live="polite">{shown.map(a => <AlertRow key={a.id} a={a} now={now} color={colors.get(a.profileId)}/>)}</ol>}</section>
    <PushSection/><PrefsEditor/>
  </>;
}
