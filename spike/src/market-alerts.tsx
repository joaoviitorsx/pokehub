import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Profile } from '../domain/profiles';
import { alertLabel, MAX_ALERTS, type MarketAlert, type MarketAlertHit, type MarketAlertInput } from '../domain/market-alerts';
import { Icon, icons } from './icons';

type Info = {alerts: MarketAlert[]; hits: MarketAlertHit[]};
const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const blank = {nome: '', moeda: '' as '' | 'orb' | 'gold', precoMax: '', notaMin: '', potenciaMin: '', soShiny: false};
const ago = (iso: string) => { const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`; };
const coin = (currency: string | null) => currency === 'orb' ? 'Gemas' : currency === 'gold' ? 'Coins' : '';

/** Alertas de anúncio no RMT: regras salvas no app; o processo principal confere a vitrine aberta em qualquer conta. */
export function MarketAlerts({profiles}: {profiles: Profile[]}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.pokehub.market.alerts().then(result => { if (alive && result.ok) { setInfo(result.data); if (result.data.alerts.length) setOpen(true); } }).catch(() => undefined);
    const off = window.pokehub.market.onAlertHit(hits => setInfo(old => old ? {...old, hits: [...hits, ...old.hits].slice(0, 30)} : old));
    return () => { alive = false; off(); };
  }, []);
  const act = async (action: () => Promise<{ok: true; data: Info} | {ok: false; error: string}>) => {
    setBusy(true); setError('');
    try { const result = await action(); if (result.ok) { setInfo(result.data); return true; } setError(result.error); return false; }
    catch { setError('Falha de comunicação com o aplicativo.'); return false; }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const input: MarketAlertInput = {nome: form.nome, moeda: form.moeda || null, precoMax: form.precoMax ? Number(form.precoMax.replace(/\./g, '').replace(',', '.')) : null, notaMin: form.notaMin ? Number(form.notaMin) : null, potenciaMin: form.potenciaMin ? Number(form.potenciaMin) : null, soShiny: form.soShiny};
    if (await act(() => window.pokehub.market.saveAlert(null, input))) setForm(null);
  };
  const toggle = (alert: MarketAlert) => void act(() => window.pokehub.market.saveAlert(alert.id, {...alert, ativo: !alert.ativo}));
  const remove = (alert: MarketAlert) => void act(() => window.pokehub.market.removeAlert(alert.id));
  const alerts = info?.alerts ?? [], hits = info?.hits ?? [];
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const active = alerts.filter(alert => alert.ativo).length;
  return <section className="mkt-alerts" aria-label="Alertas do RMT">
    <button className="mkt-alerts-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon d={icons.bell}/><strong>Alertas do RMT</strong>
      <span className="pill" data-state={active ? 'ready' : ''}>{active ? `${active} ativo${active > 1 ? 's' : ''}` : 'nenhum'}</span>
      {hits.length > 0 && <span className="mkt-alerts-new">{hits.length}</span>}
      <span className="grow"/><Icon d={open ? icons.minus : icons.plus}/>
    </button>
    {open && <div className="mkt-alerts-body">
      <p className="mkt-alerts-tip">Avisa quando aparecer um anúncio que você quer, com o RMT aberto em qualquer conta (mesmo com o PokéHub na bandeja). O card ganha um selo de sino.</p>
      {alerts.length > 0 && <ul className="mkt-alerts-list">{alerts.map(alert => <li key={alert.id} data-off={!alert.ativo || undefined}>
        <span title={alertLabel(alert)}>{alertLabel(alert)}</span>
        <button className="opt" aria-pressed={alert.ativo} disabled={busy} title={alert.ativo ? 'Pausar este alerta' : 'Reativar este alerta'} onClick={() => toggle(alert)}>{alert.ativo ? 'Ativo' : 'Pausado'}</button>
        <button className="icon" disabled={busy} aria-label={`Remover alerta ${alertLabel(alert)}`} title="Remover" onClick={() => remove(alert)}><Icon d={icons.trash}/></button>
      </li>)}</ul>}
      {form ? <form className="mkt-alerts-form" onSubmit={event => void save(event)}>
        <label className="wide">Pokémon <input value={form.nome} maxLength={40} placeholder="ex.: Venusaur (vazio = qualquer)" onChange={event => setForm({...form, nome: event.target.value})}/></label>
        <label>Moeda <select value={form.moeda} onChange={event => setForm({...form, moeda: event.target.value as typeof form.moeda, precoMax: event.target.value ? form.precoMax : ''})}><option value="">Qualquer</option><option value="orb">Gemas</option><option value="gold">Coins</option></select></label>
        <label>Preço máx. <input inputMode="numeric" value={form.precoMax} disabled={!form.moeda} placeholder={form.moeda ? 'ex.: 15000' : 'escolha a moeda'} onChange={event => setForm({...form, precoMax: event.target.value.replace(/[^\d.,]/g, '')})}/></label>
        <label>Nota mín. <select value={form.notaMin} onChange={event => setForm({...form, notaMin: event.target.value})}><option value="">Qualquer</option>{[5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Potência mín. <select value={form.potenciaMin} onChange={event => setForm({...form, potenciaMin: event.target.value})}><option value="">Qualquer</option>{[2, 3, 4, 5].map(n => <option key={n} value={n}>P{n}</option>)}</select></label>
        <label className="mkt-alerts-check"><input type="checkbox" checked={form.soShiny} onChange={event => setForm({...form, soShiny: event.target.checked})}/>Só shiny</label>
        <div className="mkt-alerts-btns"><button type="button" onClick={() => { setForm(null); setError(''); }}>Cancelar</button><button className="primary" type="submit" disabled={busy}><Icon d={icons.check}/>Salvar alerta</button></div>
      </form>
      : <button className="mkt-alerts-add" disabled={busy || alerts.length >= MAX_ALERTS} title={alerts.length >= MAX_ALERTS ? `Limite de ${MAX_ALERTS} alertas` : undefined} onClick={() => setForm({...blank})}><Icon d={icons.plus}/>Novo alerta</button>}
      {error && <p className="mkt-warn" role="alert">{error}</p>}
      {hits.length > 0 && <div className="mkt-alerts-hits"><h3>Avisos recentes</h3><ol>{hits.slice(0, 8).map(hit => { const p = byId.get(hit.profileId); const l = hit.listing; return <li key={`${hit.alertId}-${l.id ?? l.name}-${hit.em}`} style={{'--c': p?.colorToken ?? 'var(--pi-rx)'} as CSSProperties}>
        <span className="who">{p?.label ?? 'Conta'}</span>
        <strong>{l.shiny && '✨ '}{l.name}</strong>
        <small>{[l.level !== null && `Nv ${full.format(l.level)}`, l.potencia !== null && `P${l.potencia}`, l.nota !== null && `nota ${l.nota.toLocaleString('pt-BR')}`].filter(Boolean).join(' · ')}</small>
        <b>{full.format(l.price)} {coin(l.currency)}</b><time dateTime={hit.em}>{ago(hit.em)}</time>
      </li>; })}</ol></div>}
    </div>}
  </section>;
}
