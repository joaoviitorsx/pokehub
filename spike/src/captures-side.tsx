import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Profile } from '../domain/profiles';
import { alertText, alertsOf, captureKey, type AlertKind, type Capture } from '../domain/captures';
import { Ball, El } from './icons';

const MAX_SHOWN = 200, TOAST_MS = 7000, MAX_TOASTS = 3;
const PREFS_KEY = 'pokehub.captures';
interface Prefs { notify: boolean; notaMin: number | null }
export function loadCapturePrefs(): Prefs {
  try { const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>; return {notify: v.notify === true, notaMin: typeof v.notaMin === 'number' && v.notaMin >= 0 ? v.notaMin : null}; } catch { return {notify: false, notaMin: null}; }
}
const savePrefs = (prefs: Prefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
const num = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 3});
const day = (iso: string) => { const d = new Date(iso), n = new Date(); return d.toDateString() === n.toDateString() ? '' : d.toDateString() === new Date(n.getTime() - 86_400_000).toDateString() ? 'ontem ' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} `; };
interface Toast { id: number; capture: Capture; kinds: AlertKind[] }
type Filters = {account: string; shiny: boolean; p5: boolean; record: boolean};

export function CapturesPanel({profiles, active}: {profiles: Profile[]; active: boolean}) {
  const [items, setItems] = useState<Capture[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filters, setFilters] = useState<Filters>({account: '', shiny: false, p5: false, record: false});
  const [prefs, setPrefs] = useState<Prefs>(loadCapturePrefs);
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs), seq = useRef(0), timers = useRef(new Set<number>());
  useEffect(() => { prefsRef.current = prefs; savePrefs(prefs); void window.pokehub.captures.watch(true, prefs.notify, prefs.notaMin).catch(() => {}); }, [prefs]);
  useEffect(() => {
    let alive = true;
    void window.pokehub.captures.list({limit: MAX_SHOWN}).then(r => { if (alive) { if (r.ok) setItems(r.data); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    const off = window.pokehub.captures.onNew(batch => {
      if (!Array.isArray(batch) || !batch.length) return;
      setItems(old => { const seen = new Set(old.map(captureKey)); return [...batch.filter(c => !seen.has(captureKey(c))), ...old].slice(0, MAX_SHOWN); });
      setFresh(new Set(batch.map(captureKey)));
      const alerts = batch.flatMap(capture => { const kinds = alertsOf(capture, prefsRef.current); return kinds.length ? [{id: ++seq.current, capture, kinds}] : []; });
      if (!alerts.length) return;
      setToasts(old => [...alerts, ...old].slice(0, MAX_TOASTS));
      const ids = alerts.map(a => a.id), timer = window.setTimeout(() => { timers.current.delete(timer); setToasts(old => old.filter(t => !ids.includes(t.id))); }, TOAST_MS);
      timers.current.add(timer);
    });
    const pending = timers.current;
    return () => { alive = false; off(); pending.forEach(clearTimeout); pending.clear(); void window.pokehub.captures.watch(false).catch(() => {}); };
  }, []);
  const byId = new Map(profiles.map(p => [p.id, p]));
  const shown = items.filter(c => byId.has(c.profileId) && (!filters.account || c.profileId === filters.account) && (!filters.shiny || c.shiny) && (!filters.p5 || c.potencia === 5) && (!filters.record || c.record));
  const filtered = filters.account || filters.shiny || filters.p5 || filters.record;
  const toggle = (key: 'shiny' | 'p5' | 'record') => setFilters(old => ({...old, [key]: !old[key]}));
  const clear = () => { if (!window.confirm('Apagar o histórico de capturas guardado neste computador? A ação não pode ser desfeita.')) return; void window.pokehub.captures.clear().then(r => { if (r.ok) { setItems([]); setFresh(new Set()); } }).catch(() => {}); };
  const dismiss = (id: number) => setToasts(old => old.filter(t => t.id !== id));
  return <>
    <div className="cap-toasts" role="status" aria-live="polite">
      {toasts.map(t => { const p = byId.get(t.capture.profileId); return <div key={t.id} className="cap-toast" data-kind={t.kinds[0]} style={{'--c': p?.colorToken ?? 'var(--pi-ouro)'} as CSSProperties}><b className="cap-toast-ic" aria-hidden="true">{t.kinds[0] === 'shiny' ? '✨' : t.kinds[0] === 'p5' ? '★' : '▲'}</b><span><strong>{p?.label ?? 'Conta'}</strong><small>{alertText(t.capture, t.kinds)}</small></span><button className="icon" aria-label="Dispensar aviso" onClick={() => dismiss(t.id)}>×</button></div>; })}
    </div>
    <div className="side-body caps" hidden={!active} aria-busy={!loaded}>
      <div className="cap-filters" role="group" aria-label="Filtros de capturas">
        <select aria-label="Conta" value={filters.account} onChange={e => setFilters(old => ({...old, account: e.target.value}))}><option value="">Todas as contas</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <button className="opt" aria-pressed={filters.shiny} onClick={() => toggle('shiny')}>✨ Shiny</button>
        <button className="opt" aria-pressed={filters.p5} onClick={() => toggle('p5')}>P5</button>
        <button className="opt" aria-pressed={filters.record} onClick={() => toggle('record')}>Recorde</button>
      </div>
      {!loaded ? <p className="cap-hint">Carregando…</p> : shown.length === 0 ? <div className="side-msg" role="status"><Ball className="cap-ball"/><strong>{filtered && items.length ? 'Nada com esses filtros' : 'Nenhuma captura ainda'}</strong><p>{filtered && items.length ? 'Ajuste ou limpe os filtros para ver as outras capturas.' : 'As capturas da sessão aparecem aqui assim que o jogo registrar. O painel Capturas do jogo precisa estar presente na conta.'}</p></div>
      : <ol className="cap-list" aria-label="Capturas recentes">{shown.map(c => { const p = byId.get(c.profileId)!; const key = captureKey(c); return <li key={key} className="cap-row" data-shiny={c.shiny || undefined} data-record={c.record || undefined} data-new={fresh.has(key) || undefined} style={{'--c': p.colorToken} as CSSProperties}>
        <div className="cap-acc"><El color={p.colorToken}/><span title={p.label}>{p.label}</span><time dateTime={c.at} title={new Date(c.at).toLocaleString('pt-BR')}>{day(c.at)}{c.time}</time></div>
        <div className="cap-main"><strong title={c.name}>{c.shiny && <span className="cap-star" aria-label="Shiny">✨</span>}{c.name}</strong>{c.level !== null && <small>Nv {num.format(c.level)}</small>}{c.potencia !== null && <span className="cap-pot" data-p={c.potencia} title={`Potência ${c.potencia}`}>P{c.potencia}</span>}{c.record && <span className="cap-badge">RECORDE</span>}</div>
        <div className="cap-chips">{c.iv !== null && <span className="cap-chip" title="IV">IV <b>{num.format(c.iv)}</b></span>}{c.quality !== null && <span className="cap-chip" title="Qualidade">Q <b>{num.format(c.quality)}</b></span>}{c.nota !== null && <span className="cap-chip" title="Nota">N <b>{num.format(c.nota)}</b></span>}</div>
      </li>; })}</ol>}
      <div className="cap-foot">
        <label className="cap-check"><input type="checkbox" checked={prefs.notify} onChange={e => setPrefs(old => ({...old, notify: e.target.checked}))}/>Avisar no sistema (Shiny, P5, recorde)</label>
        <p className="side-foot">Lido a cada 30 s só com o Assistente aberto. Guardado neste computador por 7 dias.</p>
        <button disabled={items.length === 0} onClick={clear}>Limpar histórico</button>
      </div>
    </div>
  </>;
}
