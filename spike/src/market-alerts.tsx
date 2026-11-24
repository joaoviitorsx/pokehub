import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Profile } from '../domain/profiles';
import { alertLabel, MAX_ALERTS, type MarketAlert, type MarketAlertHit, type MarketAlertInput } from '../domain/market-alerts';
import { Icon, icons } from './icons';
import { loadSoundPrefs, playAlertSound, saveSoundPrefs, TONES, type Tone } from './alert-sound';

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
  const [sound, setSound] = useState(loadSoundPrefs);
  useEffect(() => saveSoundPrefs(sound), [sound]);
  const test = () => { if (sound.on) playAlertSound(sound, true); void window.pokehub.market.testToast().catch(() => undefined); };
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
  return <section className="ma" data-hits={hits.length > 0 || undefined} aria-label="Alertas do RMT">
    <button className="ma-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="ma-medal" aria-hidden="true"><Icon d={icons.bell}/>{hits.length > 0 && <i className="ma-badge">{hits.length > 9 ? '9+' : hits.length}</i>}</span>
      <span className="ma-titles"><strong>Alertas do RMT</strong><small>{active ? `${active} regra${active > 1 ? 's' : ''} vigiando a vitrine` : alerts.length ? 'todas pausadas' : 'nenhuma regra ainda'}</small></span>
      <span className="ma-chevron" data-open={open || undefined} aria-hidden="true"><Icon d={icons.plus}/></span>
    </button>
    {open && <div className="ma-body">
      <div className="ma-sound" role="group" aria-label="Som do alerta">
        <label className="switch ma-switch" title={sound.on ? 'Desligar o som do alerta' : 'Ligar o som do alerta'}><span className="sr">Som do alerta</span><input type="checkbox" role="switch" checked={sound.on} onChange={event => setSound(old => ({...old, on: event.target.checked}))}/></label>
        <span className="ma-sound-lbl"><Icon d={sound.on ? icons.sound : icons.mute}/>Som</span>
        <select value={sound.tone} disabled={!sound.on} aria-label="Tom do alerta" title="Tom do alerta" onChange={event => { const tone = event.target.value as Tone; setSound(old => ({...old, tone})); playAlertSound({...sound, tone}, true); }}>{TONES.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
        <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={!sound.on} aria-label="Volume do alerta" onChange={event => setSound(old => ({...old, volume: Number(event.target.value)}))}/>
        <button className="opt" onClick={test} title="Toca o som e mostra o aviso de exemplo"><Icon d={icons.bell}/>Testar</button>
      </div>
      <p className="ma-tip">Avisa quando aparecer um anúncio que você quer, com o RMT aberto em qualquer conta (mesmo com o PokéHub na bandeja). O card ganha um selo de sino.</p>
      {alerts.length > 0 && <ul className="ma-rules">{alerts.map(alert => <li key={alert.id} data-off={!alert.ativo || undefined} title={alertLabel(alert)}>
        <div className="ma-rule-main">
          <strong>{alert.nome ? alert.nome.replace(/(^|\s)\p{L}/gu, c => c.toUpperCase()) : 'Qualquer Pokémon'}</strong>
          <span className="ma-chips">
            {alert.soShiny && <i className="ma-chip" data-k="shiny">✨ Shiny</i>}
            {alert.potenciaMin !== null && <i className="ma-chip" data-k="pot" data-p={alert.potenciaMin}>P{alert.potenciaMin}+</i>}
            {alert.notaMin !== null && <i className="ma-chip" data-k="nota">Nota ≥ {alert.notaMin.toLocaleString('pt-BR')}</i>}
            {alert.precoMax !== null ? <i className="ma-chip" data-k="preco" data-m={alert.moeda ?? undefined}>até {full.format(alert.precoMax)} {coin(alert.moeda)}</i> : alert.moeda && <i className="ma-chip" data-k="preco" data-m={alert.moeda}>em {coin(alert.moeda)}</i>}
          </span>
        </div>
        <label className="switch ma-switch" title={alert.ativo ? 'Pausar este alerta' : 'Reativar este alerta'}><span className="sr">{alert.ativo ? 'Ativo' : 'Pausado'}</span><input type="checkbox" role="switch" checked={alert.ativo} disabled={busy} onChange={() => toggle(alert)}/></label>
        <button className="icon" disabled={busy} aria-label={`Remover alerta ${alertLabel(alert)}`} title="Remover" onClick={() => remove(alert)}><Icon d={icons.trash}/></button>
      </li>)}</ul>}
      {form ? <form className="ma-form" onSubmit={event => void save(event)}>
        <p className="ma-form-tit"><Icon d={icons.bell}/>Novo alerta</p>
        <label className="wide">Pokémon <input value={form.nome} maxLength={40} placeholder="ex.: Venusaur (vazio = qualquer)" onChange={event => setForm({...form, nome: event.target.value})}/></label>
        <label>Moeda <select value={form.moeda} onChange={event => setForm({...form, moeda: event.target.value as typeof form.moeda, precoMax: event.target.value ? form.precoMax : ''})}><option value="">Qualquer</option><option value="orb">Gemas</option><option value="gold">Coins</option></select></label>
        <label>Preço máx. <input inputMode="numeric" value={form.precoMax} disabled={!form.moeda} placeholder={form.moeda ? 'ex.: 15000' : 'escolha a moeda'} onChange={event => setForm({...form, precoMax: event.target.value.replace(/[^\d.,]/g, '')})}/></label>
        <label>Nota mín. <select value={form.notaMin} onChange={event => setForm({...form, notaMin: event.target.value})}><option value="">Qualquer</option>{[5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Potência mín. <select value={form.potenciaMin} onChange={event => setForm({...form, potenciaMin: event.target.value})}><option value="">Qualquer</option>{[2, 3, 4, 5].map(n => <option key={n} value={n}>P{n}</option>)}</select></label>
        <label className="ma-check"><input type="checkbox" checked={form.soShiny} onChange={event => setForm({...form, soShiny: event.target.checked})}/>✨ Só shiny</label>
        <div className="ma-btns"><button type="button" onClick={() => { setForm(null); setError(''); }}>Cancelar</button><button className="primary" type="submit" disabled={busy}><Icon d={icons.check}/>Salvar alerta</button></div>
      </form>
      : <button className="ma-add" disabled={busy || alerts.length >= MAX_ALERTS} title={alerts.length >= MAX_ALERTS ? `Limite de ${MAX_ALERTS} alertas` : undefined} onClick={() => setForm({...blank})}><Icon d={icons.plus}/>Novo alerta</button>}
      {error && <p className="mkt-warn" role="alert">{error}</p>}
      {hits.length > 0 && <div className="ma-hits"><h3>Avisos recentes</h3><ol>{hits.slice(0, 8).map((hit, i) => { const p = byId.get(hit.profileId); const l = hit.listing; return <li key={`${hit.alertId}-${l.id ?? l.name}-${hit.em}`} data-shiny={l.shiny || undefined} style={{'--c': p?.colorToken ?? 'var(--pi-rx)', '--i': i} as CSSProperties}>
        <div className="ma-hit-top"><strong>{l.shiny && <span aria-label="Shiny">✨ </span>}{l.name}</strong><b className="ma-price" data-m={l.currency ?? undefined}>{full.format(l.price)}<small> {coin(l.currency)}</small></b></div>
        <div className="ma-hit-sub">
          <span className="ma-chips">{l.level !== null && <i className="ma-chip">Nv {full.format(l.level)}</i>}{l.potencia !== null && <i className="ma-chip" data-k="pot" data-p={l.potencia}>P{l.potencia}</i>}{l.nota !== null && <i className="ma-chip" data-k="nota">N {l.nota.toLocaleString('pt-BR')}</i>}</span>
          <span className="ma-who"><i aria-hidden="true"/>{p?.label ?? 'Conta'} · <time dateTime={hit.em}>{ago(hit.em)}</time></span>
        </div>
      </li>; })}</ol></div>}
    </div>}
  </section>;
}
