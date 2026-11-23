// Capturas no celular: linha igual à do desktop (nome, Nv, P por raridade, IV/Q/N, hora, shiny dourado, RECORDE) e o feed por conta.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { get, num, Unauthorized } from './api';
import { captureKey, isRemoteCapture, mergeCaptures } from './push-helpers';
import type { RemoteCapture } from './r3-types';

const day = (iso: string) => { const d = new Date(iso), n = new Date(); return d.toDateString() === n.toDateString() ? '' : d.toDateString() === new Date(n.getTime() - 86_400_000).toDateString() ? 'ontem ' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} `; };

export function CaptureRow({c, showAccount = false, fresh = false}: {c: RemoteCapture; showAccount?: boolean; fresh?: boolean}) {
  return <li className="cap-row" data-shiny={c.shiny || undefined} data-record={c.record || undefined} data-new={fresh || undefined} style={{'--c': c.color} as CSSProperties}>
    <div className="cap-main"><strong title={c.name}>{c.shiny && <span className="cap-star" role="img" aria-label="Shiny">✨</span>}{c.name}</strong>{c.level !== null && <small>Nv {num(c.level)}</small>}{c.potencia !== null && <span className="cap-pot" data-p={c.potencia} title={`Potência ${c.potencia}`}>P{c.potencia}</span>}{c.record && <span className="cap-badge">RECORDE</span>}<time dateTime={c.at} title={new Date(c.at).toLocaleString('pt-BR')}>{day(c.at)}{c.time}</time></div>
    <div className="cap-chips">{showAccount && <span className="cap-acc"><i className="gem" style={{background: c.color}}/>{c.label}</span>}{c.iv !== null && <span className="cap-chip" title="IV">IV <b>{num(c.iv)}</b></span>}{c.quality !== null && <span className="cap-chip" title="Qualidade">Q <b>{num(c.quality)}</b></span>}{c.nota !== null && <span className="cap-chip" title="Nota">N <b>{num(c.nota)}</b></span>}</div>
  </li>;
}
/** Linha curta da última captura (cartão da conta). */
export function LastCapture({c}: {c: RemoteCapture}) {
  return <span className="last-cap" data-shiny={c.shiny || undefined}>{c.shiny ? '✨ ' : ''}{c.name}{c.level !== null ? ` · Nv ${num(c.level)}` : ''}{c.potencia !== null ? ` · P${c.potencia}` : ''} · {day(c.at)}{c.time}</span>;
}

type Filters = {shiny: boolean; p5: boolean; record: boolean};
export function CapturesView({id, live}: {id: string; live: readonly RemoteCapture[]}) {
  const [base, setBase] = useState<RemoteCapture[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [filters, setFilters] = useState<Filters>({shiny: false, p5: false, record: false});
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const r = await get<{captures: unknown[]}>(`/api/captures?profileId=${encodeURIComponent(id)}&limit=100`); setBase(Array.isArray(r.captures) ? r.captures.filter(isRemoteCapture) : []); }
    catch (e) { if (!(e instanceof Unauthorized)) setError('Não foi possível ler agora.'); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga assíncrona via API ao abrir/trocar de conta
    setBase(null); void load();
  }, [load]);
  const items = useMemo(() => mergeCaptures(live.filter(c => c.profileId === id), (base ?? []).filter(c => c.profileId === id)), [live, base, id]);
  const shown = items.filter(c => (!filters.shiny || c.shiny) && (!filters.p5 || c.potencia === 5) && (!filters.record || c.record));
  const toggle = (k: keyof Filters) => setFilters(old => ({...old, [k]: !old[k]}));
  const filtered = filters.shiny || filters.p5 || filters.record;
  const freshKeys = new Set(live.filter(c => c.profileId === id).map(captureKey)); // chegou ao vivo nesta sessão: pisca ao entrar
  return <section className="card caps" aria-busy={busy}><h2>Capturas</h2>
    <div className="seg" role="group" aria-label="Filtros de capturas">
      <button aria-pressed={filters.shiny} onClick={() => toggle('shiny')}>✨ Shiny</button><button aria-pressed={filters.p5} onClick={() => toggle('p5')}>P5</button><button aria-pressed={filters.record} onClick={() => toggle('record')}>Recorde</button>
      <button onClick={() => void load()} disabled={busy}>{busy ? '…' : 'Atualizar'}</button></div>
    {error && <p className="msg" role="alert">{error}</p>}
    {base === null && !error ? <p className="muted" role="status">Lendo…</p> : shown.length === 0 ? <p className="muted" role="status">{filtered && items.length ? 'Nada com esses filtros.' : 'Nenhuma captura ainda. Elas aparecem aqui quando o jogo registrar.'}</p>
      : <ol className="cap-list" aria-label="Capturas recentes">{shown.map(c => <CaptureRow key={captureKey(c)} c={c} fresh={freshKeys.has(captureKey(c))}/>)}</ol>}
  </section>;
}
