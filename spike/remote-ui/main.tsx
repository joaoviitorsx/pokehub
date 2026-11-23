// App do celular (PWA): pareamento, Contas, Conta (Onde caçar), Mercado e Saúde; Loja e Alertas chegam nas próximas fases.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { deviceNameFromUA } from '../remote/device-name';
import { ago, compact, get, mb, num, post, STATE_TEXT, Unauthorized, type Account, type Me } from './api';
import { Ball } from '../src/icons';
import { PixelIcon } from './pixel-icons';
import './remote.css';

type Tab = 'contas' | 'conta' | 'loja' | 'mercado' | 'alertas';
const TABS: {id: Tab; label: string; soon?: boolean}[] = [{id: 'contas', label: 'Contas'}, {id: 'conta', label: 'Conta'}, {id: 'loja', label: 'Loja', soon: true}, {id: 'mercado', label: 'Mercado'}, {id: 'alertas', label: 'Alertas', soon: true}];

function Pair({onDone}: {onDone: () => void}) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const full = code.length === 8;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !full) return;
    setBusy(true); setMessage('');
    try {
      const result = await post('/api/pair', {code, deviceName: deviceNameFromUA(navigator.userAgent)});
      if (result.ok) onDone(); else setMessage(result.error ?? 'Não foi possível parear.');
    } catch { setMessage('Sem conexão com o PC. Confira o Wi-Fi e tente de novo.'); } finally { setBusy(false); }
  };
  return <main className="pair"><div className="wood"><form onSubmit={submit}>
    <div className="empty-art" aria-hidden="true"><Ball className="wobble"/><i className="stand"/><i className="shadow"/></div>
    <h1>Poké<em>Hub</em></h1>
    <p>Para ver suas contas aqui, pareie este celular com o PC. No PC: <strong>Gerenciar → Acesso remoto → Parear novo aparelho</strong>.</p>
    <div className="well"><label htmlFor="pair-code">Digite o código que aparece no PC</label>
      <div className="code">{[0, 1, 2, 3].map(i => <span key={i} data-on={i === code.length ? '' : undefined}>{code[i] ?? ''}</span>)}<i aria-hidden="true"/>{[4, 5, 6, 7].map(i => <span key={i} data-on={i === code.length ? '' : undefined}>{code[i] ?? ''}</span>)}
        <input id="pair-code" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '').slice(0, 8))} inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={9} aria-describedby="pair-msg" autoFocus/></div>
      <p className="hint">8 letras e números. O código vale 2 minutos.</p></div>
    <button className="primary" disabled={busy || !full}>{busy ? 'Aguarde…' : 'Parear'}</button>
    <p id="pair-msg" role={message ? 'alert' : 'status'} className="msg">{busy ? 'Agora aceite o pedido na tela do PC.' : message}</p>
  </form></div></main>;
}

const StateTag = ({account}: {account: Account}) => { const state = account.suspended ? 'suspended' : account.state; return <span className="st" data-state={state}><b/><small>{STATE_TEXT[state] ?? 'Iniciando'}</small></span>; };
function Soon({title}: {title: string}) { return <section className="card soon"><h2>{title}</h2><p className="muted">Em breve. Esta parte chega numa próxima versão do acesso remoto.</p></section>; }
function Pick({accounts, value, onChange}: {accounts: Account[]; value: string | null; onChange: (id: string) => void}) {
  return <div className="chips" role="group" aria-label="Conta">{accounts.map(a => <button key={a.id} className="chip" aria-pressed={a.id === value} onClick={() => onChange(a.id)}><i className="gem" style={{background: a.color}}/>{a.label}</button>)}</div>;
}

interface Diag { accounts: {id: string; cpuPercent: number | null; privateKb: number | null; workingSetKb: number | null}[]; hub: {cpuPercent: number | null; privateKb: number | null}; gpu: {cpuPercent: number | null; privateKb: number | null}; other: {cpuPercent: number | null; privateKb: number | null}; host: {totalKb: number; freeKb: number} }
function Health({accounts}: {accounts: Account[]}) {
  const [diag, setDiag] = useState<Diag | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, timer = 0;
    const tick = async () => { if (!document.hidden) { try { const d = await get<Diag>('/api/diag'); if (alive) { setDiag(d); setError(''); } } catch (e) { if (alive && !(e instanceof Unauthorized)) setError('Não foi possível medir agora.'); } } if (alive) timer = window.setTimeout(() => void tick(), 5000); };
    void tick(); return () => { alive = false; clearTimeout(timer); };
  }, []);
  const used = diag ? diag.host.totalKb - diag.host.freeKb : 0;
  useEffect(() => { if (diag && location.hash === '#saude') document.getElementById('saude')?.scrollIntoView(); }, [diag]);
  return <section className="card" id="saude"><h2>Saúde do PC</h2>{error && <p className="msg" role="alert">{error}</p>}{!diag ? <p className="muted" role="status">Medindo…</p> : <>
    <p>Memória do PC: <span className="big">{Math.round(used / diag.host.totalKb * 100)}%</span> <small className="muted">{mb(used)} de {mb(diag.host.totalKb)}</small></p>
    <div className="bar" data-hot={used / diag.host.totalKb > .85 ? 'alto' : used / diag.host.totalKb > .7 ? 'medio' : undefined} role="meter" aria-valuemin={0} aria-valuemax={diag.host.totalKb} aria-valuenow={used} aria-label="Memória do PC em uso"><i style={{width: `${Math.min(100, used / diag.host.totalKb * 100)}%`}}/></div>
    <ul className="rows health">{diag.accounts.map(item => <li key={item.id}><span>{accounts.find(a => a.id === item.id)?.label ?? 'Conta'}</span><span>CPU {item.cpuPercent === null ? '—' : `${num(item.cpuPercent)}%`}</span><span>{mb(item.privateKb)}</span></li>)}
      <li><span>PokéHub</span><span>CPU {diag.hub.cpuPercent === null ? '—' : `${num(diag.hub.cpuPercent)}%`}</span><span>{mb(diag.hub.privateKb)}</span></li></ul></>}</section>;
}

interface HuntRow { nome: string; regiao: string; nivel: number; xpPorHora: number; ouroPorHora: number; shinyPorHora: number | null; liberada: boolean; umHit: boolean }
type Hunt = {estado: 'sem-extensao' | 'sem-jogo' | 'sem-pokemon'} | {estado: 'ok'; pokemon: {nome: string; nivel: number}; hunts: HuntRow[]; liberadas: number; total: number} | {ok: false; error: string};
const HUNT_MSG: Record<string, string> = {'sem-extensao': 'A extensão /hunt não está ativa nesta conta (no PC).', 'sem-jogo': 'O jogo ainda não terminou de carregar.', 'sem-pokemon': 'Nenhum Pokémon ativo na conta.'};
function HuntView({id}: {id: string}) {
  const [data, setData] = useState<Hunt | null>(null), [sort, setSort] = useState<'xp' | 'ouro' | 'shiny'>('xp'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => { setBusy(true); setError(''); try { setData(await get<Hunt>(`/api/hunt/${encodeURIComponent(id)}`)); } catch (e) { if (!(e instanceof Unauthorized)) setError('Não foi possível ler agora.'); } finally { setBusy(false); } }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga assíncrona via API no mount
    setData(null); void load();
  }, [load]);
  const rows = data && 'hunts' in data ? [...data.hunts].sort((a, b) => sort === 'xp' ? b.xpPorHora - a.xpPorHora : sort === 'ouro' ? b.ouroPorHora - a.ouroPorHora : (b.shinyPorHora ?? 0) - (a.shinyPorHora ?? 0)).slice(0, 20) : [];
  return <section className="card"><h2>Onde caçar</h2>
    <div className="seg" role="group" aria-label="Ordenar por">{(['xp', 'ouro', 'shiny'] as const).map(k => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{k === 'xp' ? 'XP/h' : k === 'ouro' ? 'Ouro/h' : 'Shiny/h'}</button>)}<button onClick={() => void load()} disabled={busy}>{busy ? '…' : 'Atualizar'}</button></div>
    {error && <p className="msg" role="alert">{error}</p>}
    {!data ? <p className="muted" role="status">Lendo…</p> : 'error' in data ? <p className="muted">{data.error}</p> : data.estado !== 'ok' ? <p className="muted">{HUNT_MSG[data.estado]}</p> : <>
      <p>{data.pokemon.nome} · nível {data.pokemon.nivel} · {data.liberadas}/{data.total} hunts liberadas</p>
      <ol className="rows hunts">{rows.map(h => <li key={`${h.nome}${h.regiao}`}><strong>{h.nome}</strong><small>{h.regiao} · nv {h.nivel}{h.umHit ? ' · 1 hit' : ''}</small><span>{compact(h.xpPorHora)} XP/h</span><span>{compact(h.ouroPorHora)} ouro/h</span><span>{h.shinyPorHora === null ? '—' : `${num(h.shinyPorHora)} shiny/h`}</span></li>)}</ol></>}
  </section>;
}

interface Deal { listing: {name: string; level: number | null; potencia: number | null; nota: number | null; shiny: boolean; price: number; currency: 'gold' | 'orb' | null}; score: number; reasons: string[] }
type Market = {estado: 'indisponivel'; erro: string} | {estado: 'ok'; fonte: string; query: string; anuncios: number; paginasLidas: number; paginas: number | null; ofertas: Deal[]};
function MarketView({accounts, id, onPick}: {accounts: Account[]; id: string | null; onPick: (id: string) => void}) {
  const [data, setData] = useState<Market | null>(null), [foco, setFoco] = useState<'equilibrado' | 'qualidade' | 'desconto'>('equilibrado'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => { if (!id) return; setBusy(true); setError(''); try { setData(await get<Market>(`/api/market/${encodeURIComponent(id)}?foco=${foco}`)); } catch (e) { if (!(e instanceof Unauthorized)) setError('Não foi possível ler agora.'); } finally { setBusy(false); } }, [id, foco]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga assíncrona via API no mount
    setData(null); void load();
  }, [load]);
  return <><Pick accounts={accounts} value={id} onChange={onPick}/><section className="card"><h2>Mercado</h2>
    <div className="seg" role="group" aria-label="Foco">{(['equilibrado', 'qualidade', 'desconto'] as const).map(k => <button key={k} aria-pressed={foco === k} onClick={() => setFoco(k)}>{k === 'equilibrado' ? 'Equilibrado' : k === 'qualidade' ? 'Qualidade' : 'Desconto'}</button>)}<button onClick={() => void load()} disabled={busy}>{busy ? '…' : 'Atualizar'}</button></div>
    {error && <p className="msg" role="alert">{error}</p>}
    {!data ? <p className="muted" role="status">Lendo…</p> : data.estado !== 'ok' ? <p className="muted">{data.erro}</p> : <>
      <p className="muted">Busca “{data.query || '—'}” · {data.anuncios} anúncios ({data.paginasLidas} página{data.paginasLidas === 1 ? '' : 's'}{data.paginas ? ` de ${data.paginas}` : ''}) · fonte: {data.fonte}</p>
      <ol className="rows deals">{data.ofertas.map((d, i) => <li key={i}><strong>{d.listing.shiny ? '✨ ' : ''}{d.listing.name}</strong><small>{d.listing.level ? `nv ${d.listing.level}` : ''}{d.listing.potencia ? ` · P${d.listing.potencia}` : ''}{d.listing.nota !== null ? ` · nota ${num(d.listing.nota)}` : ''}</small><span>{compact(d.listing.price)} {d.listing.currency === 'orb' ? 'gemas' : d.listing.currency === 'gold' ? 'ouro' : ''}</span><small>{d.reasons.slice(0, 2).join(' · ')}</small></li>)}</ol></>}
  </section></>;
}

/** Link direto (#conta, #mercado, #saude…): abre a aba certa; as notificações das próximas fases vão usar isto. */
const tabFromHash = (): Tab => { const h = location.hash.slice(1); return h === 'saude' ? 'contas' : TABS.some(t => t.id === h && !t.soon) ? h as Tab : 'contas'; };
function Shell({me, onLogout}: {me: Me; onLogout: () => void}) {
  const [tab, setTab] = useState<Tab>(tabFromHash), [accounts, setAccounts] = useState<Account[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null), [online, setOnline] = useState(true), [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const events = new EventSource('/api/events');
    const apply = (event: MessageEvent<string>) => { try { const data = JSON.parse(event.data) as {accounts: Account[]}; setAccounts(data.accounts); setUpdated(Date.now()); setOnline(true); } catch { /* quadro inválido: ignora */ } };
    events.addEventListener('state', apply as EventListener);
    events.onopen = () => setOnline(true);
    events.onerror = () => { setOnline(false); void get('/api/me').catch(e => { if (e instanceof Unauthorized) onLogout(); }); };
    const clock = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => { events.close(); clearInterval(clock); };
  }, [onLogout]);
  const current = selected && accounts.some(a => a.id === selected) ? selected : accounts[0]?.id ?? null;
  const open = (id: string) => { setSelected(id); setTab('conta'); };
  return <>
    <header className="top"><Ball/><strong>PokéHub</strong><span className={online ? 'stamp' : 'stamp off'} role="status">{online ? `Atualizado ${ago(updated, now)}` : `Sem conexão com o PC · atualizado ${ago(updated, now)}`}</span></header>
    <main>
      {tab === 'contas' && <>{accounts.length === 0 ? <section className="card"><p className="muted" role="status">{online ? 'Nenhuma conta ainda.' : 'Aguardando o PC…'}</p></section> : <ul className="accounts">{accounts.map(a => <li key={a.id}><button className="acc" onClick={() => open(a.id)}><i className="gem" style={{background: a.color}}/><strong>{a.label}</strong><StateTag account={a}/></button></li>)}</ul>}
        <Health accounts={accounts}/>
        <section className="card"><p className="muted">Pareado como {me.name}.</p><button onClick={() => { if (confirm('Sair deste aparelho? Para voltar, será preciso parear de novo.')) void post('/api/logout', {}).then(onLogout); }}>Sair deste aparelho</button></section></>}
      {tab === 'conta' && (current ? <><Pick accounts={accounts} value={current} onChange={setSelected}/>
        <div className="seg subtabs" role="group" aria-label="Seções da conta"><button aria-pressed>Onde caçar</button><button disabled>Jogo <small>em breve</small></button><button disabled>Capturas <small>em breve</small></button><button disabled>Equipe <small>em breve</small></button></div>
        <HuntView id={current}/></> : <section className="card"><p className="muted">Nenhuma conta.</p></section>)}
      {tab === 'loja' && <Soon title="Loja"/>}
      {tab === 'mercado' && <MarketView accounts={accounts} id={current} onPick={setSelected}/>}
      {tab === 'alertas' && <Soon title="Alertas"/>}
    </main>
    <nav className="tabs" aria-label="Seções">{TABS.map(t => <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} disabled={t.soon} onClick={() => setTab(t.id)}><PixelIcon name={t.id}/>{t.label}{t.soon && <small>em breve</small>}</button>)}</nav>
  </>;
}

function App() {
  const [phase, setPhase] = useState<'loading' | 'pair' | 'app'>('loading'), [me, setMe] = useState<Me | null>(null);
  const check = useCallback(async () => { try { setMe(await get<Me>('/api/me')); setPhase('app'); } catch (e) { if (e instanceof Unauthorized) setPhase('pair'); else setPhase('pair'); } }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga assíncrona via API no mount
    void check();
  }, [check]);
  useEffect(() => { try { void navigator.serviceWorker?.register('/sw.js').catch(() => undefined); } catch { /* certificado ainda não confiável: sem service worker */ } }, []);
  const logout = useCallback(() => { setMe(null); setPhase('pair'); }, []);
  if (phase === 'loading') return <main className="loading" role="status"><Ball className="wobble"/><p className="muted">Carregando…</p></main>;
  return phase === 'app' && me ? <Shell me={me} onLogout={logout}/> : <Pair onDone={() => void check()}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
