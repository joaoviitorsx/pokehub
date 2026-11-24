import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { rankDeals, type MarketCurrency, type MarketFocus, type MarketListing, type MarketScan } from '../domain/market';
import { accumulate, accumulated, sessionKey, sessionStats, type MarketAccumulator, type MarketProgress } from '../domain/market-session';
import { huntFetchable } from './hunt-queue';
import { Icon, icons } from './icons';
import { MarketAlerts } from './market-alerts';
import type { Profile } from '../domain/profiles';

export const MARKET_REFRESH_MS = 5000, MARKET_MAX_PAGES = 30;
const READ_TIMEOUT_MS = 12_000;
const unavailable = 'Abra o Mercado nesta conta para analisar os anúncios.';
type Entry = {data: MarketScan} | {error: string};
const FOCUS: [MarketFocus, string][] = [['equilibrado', 'Equilibrado'], ['qualidade', 'Qualidade'], ['desconto', 'Desconto']];
const CURRENCY: [MarketCurrency | 'todas', string][] = [['todas', 'Todas'], ['orb', 'Gemas'], ['gold', 'Coins']];
const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const compact = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
const price = (value: number) => value >= 1e5 ? compact.format(value) : full.format(value);
const dec = (value: number) => value.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const coin = (currency: MarketListing['currency']) => currency === 'orb' ? 'Gemas' : currency === 'gold' ? 'Coins' : '';
const smartText = (smart: NonNullable<MarketListing['smart']>) => smart.pct === null ? smart.label : `${smart.pct > 0 ? '+' : '−'}${Math.abs(smart.pct).toLocaleString('pt-BR', {maximumFractionDigits: 1})}%`;

// Faixa da barra de pontuação (verde/amarelo/vermelho, como a barra de vida do jogo) e raridade da potência.
const tier = (score: number) => score >= 66 ? 'alto' : score >= 33 ? 'medio' : 'baixo';
const progressOf = (progress: MarketProgress | null) => progress && progress.page != null && progress.pages ? Math.min(1, Math.max(0, progress.page / progress.pages)) : 0;
const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export function MarketPanel({id, state, profiles}: {id: string | undefined; state: string; profiles: Profile[]}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [stamp, setStamp] = useState(0);
  const [focus, setFocus] = useState<MarketFocus>('equilibrado');
  const [currency, setCurrency] = useState<MarketCurrency | 'todas'>('todas');
  const [minNota, setMinNota] = useState(0);
  const [minPotencia, setMinPotencia] = useState(0);
  const [shinyOnly, setShinyOnly] = useState(false);
  const [now, setNow] = useState(0); // relógio do acúmulo: só avança quando chega leitura nova (Date.now() não pode ser chamado no render)
  const [accs, setAccs] = useState<Record<string, MarketAccumulator>>({});
  const [runs, setRuns] = useState<Record<string, MarketProgress | {starting: true}>>({});
  const [startError, setStartError] = useState<Record<string, string>>({});
  const running = useRef(new Set<string>());
  const lastScan = useRef<Record<string, {sig: string; at: number}>>({}); // retrato igual ao anterior não gera setState (o acúmulo só é renovado a cada 60 s)
  const live = huntFetchable(state);
  // Selos nos cards do RMT (processo principal, todas as contas): preferência salva no app.
  const [badges, setBadges] = useState<boolean | null>(null);
  useEffect(() => { let alive = true; void window.pokehub.market.badges().then(result => { if (alive && result.ok) setBadges(result.data); }).catch(() => undefined); return () => { alive = false; }; }, []);
  const toggleBadges = () => { if (badges === null) return; const next = !badges; setBadges(next); void window.pokehub.market.setBadges(next).then(result => { if (!result.ok) setBadges(!next); }).catch(() => setBadges(!next)); };
  const add = useCallback((profileId: string, scan: MarketScan) => { if (!scan.open) return; const at = Date.now(); setNow(at); setAccs(old => ({...old, [profileId]: accumulate(old[profileId] ?? null, sessionKey(profileId, scan.query), scan, at)})); }, []);
  // Progresso da leitura assistida (processo principal): cada página lida entra no acúmulo; ao sair da aba a leitura é interrompida.
  useEffect(() => {
    const off = window.pokehub.market.onProgress(progress => {
      if (progress.scan) add(progress.profileId, progress.scan);
      if (progress.done) running.current.delete(progress.profileId); else running.current.add(progress.profileId);
      setRuns(old => ({...old, [progress.profileId]: progress}));
    });
    const active = running.current;
    return () => { off(); for (const profileId of active) void window.pokehub.market.stop(profileId); };
  }, [add]);
  // Só lê enquanto a aba está montada (visível) e a janela não está oculta; uma leitura por vez.
  useEffect(() => {
    if (!id || !live) return;
    let alive = true, timer = 0;
    delete lastScan.current[id]; // reinício do ciclo (Limpar, Tentar de novo): a próxima leitura sempre entra
    const cycle = async () => {
      if (!document.hidden && !running.current.has(id)) { // durante a leitura de páginas o próprio laço lê; sem leituras concorrentes
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([window.pokehub.market.scan(id), new Promise<never>((_resolve, reject) => { timeout = setTimeout(reject, READ_TIMEOUT_MS); })])
          .catch(() => ({ok: false as const, error: unavailable})).finally(() => clearTimeout(timeout));
        if (!alive) return;
        const sig = JSON.stringify(result), prev = lastScan.current[id], at = Date.now();
        if (prev && prev.sig === sig && at - prev.at < 60_000) { if (alive) timer = window.setTimeout(() => void cycle(), MARKET_REFRESH_MS); return; }
        lastScan.current[id] = {sig, at};
        setEntries(old => ({...old, [id]: result.ok ? {data: result.data} : {error: result.error}}));
        if (result.ok) add(id, result.data);
      }
      if (alive) timer = window.setTimeout(() => void cycle(), MARKET_REFRESH_MS);
    };
    void cycle();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, live, stamp, add]);
  const entry = id && live ? entries[id] : undefined;
  const data = entry && 'data' in entry ? entry.data : null;
  const acc = id ? accs[id] ?? null : null, run = id ? runs[id] : undefined, progress = run && 'page' in run ? run : null, reading = Boolean(run && (!progress || !progress.done));
  const {pool, stats} = useMemo(() => { return {pool: accumulated(acc, now), stats: sessionStats(acc, now, data?.pages ?? null)}; }, [acc, now, data?.pages]);
  const deals = useMemo(() => data ? rankDeals(pool, {focus, currency: currency === 'todas' ? null : currency, minNota, minPotencia, shinyOnly}) : [], [data, pool, focus, currency, minNota, minPotencia, shinyOnly]);
  const readAll = async () => {
    if (!id) return;
    setStartError(old => ({...old, [id]: ''})); setRuns(old => ({...old, [id]: {starting: true}})); running.current.add(id);
    const result = await window.pokehub.market.readAll(id).catch(() => ({ok: false as const, error: unavailable}));
    if (!result.ok) { running.current.delete(id); setRuns(old => without(old, id)); setStartError(old => ({...old, [id]: result.error})); }
  };
  const stop = () => { if (id) void window.pokehub.market.stop(id); };
  const clear = () => { if (!id || !data) return; setAccs(old => without(old, id)); setRuns(old => without(old, id)); setStamp(value => value + 1); };
  const query = data?.query ?? '', tooMany = data?.pages != null && data.pages > MARKET_MAX_PAGES;
  const hint = !query ? 'Busque uma espécie no Mercado antes (ex.: Venusaur) — o Mercado inteiro tem centenas de páginas.' : tooMany ? `Esta busca tem ${data!.pages} páginas; o limite é ${MARKET_MAX_PAGES}. Refine a busca para ler tudo.` : '';
  const finished = progress?.done ? progress : null;
  const message = (title: string, body: string) => <div className="side-msg" role="status"><strong>{title}</strong><p>{body}</p></div>;
  return <div className="side-body mkt" aria-busy={live && !entry}>
    <div className="mkt-badges">
      <span className="mkt-badges-demo" aria-hidden="true"><Icon d={icons.tag}/><b>87</b></span>
      <p><strong>Selos no RMT</strong><small>{badges === false ? 'Análise só aqui na lateral.' : 'Nota em cada card do jogo.'}</small></p>
      <button className="opt" aria-pressed={badges === true} disabled={badges === null} title={badges ? 'Tirar os selos dos cards do RMT' : 'Mostrar a nota de custo-benefício em cada card do RMT (compacta se a Smart Market estiver ativa)'} onClick={toggleBadges}><Icon d={badges ? icons.check : icons.minus}/>{badges ? 'Ligados' : 'Desligados'}</button>
    </div>
    <MarketAlerts profiles={profiles}/>
    {!live ? message('Sessão indisponível', 'Aguarde a sessão desta conta terminar de abrir (ou entre no jogo) para analisar o Mercado.')
      : !entry ? message('Lendo o Mercado…', 'A análise lê só o que está na tela desta conta.')
      : 'error' in entry ? <>{message('Mercado fechado', `${entry.error} — a análise lê só o que está na tela. Abra o Mercado no jogo desta conta.`)}<button onClick={() => setStamp(value => value + 1)}>Tentar de novo</button></>
      : !data!.open ? message('Mercado fechado', 'Abra o Mercado no jogo desta conta — a análise lê só o que está na tela.')
      : <>
        <div className="mkt-filters">
          <div className="seg" role="group" aria-label="Foco" style={{'--n': FOCUS.length, '--i': FOCUS.findIndex(([key]) => key === focus)} as CSSProperties}>{FOCUS.map(([key, label]) => <button key={key} aria-pressed={focus === key} title={key === 'qualidade' ? 'Foco: melhor qualidade' : key === 'desconto' ? 'Foco: maior desconto' : undefined} onClick={() => setFocus(key)}>{label}</button>)}</div>
          <div className="mkt-row">
            <label>Moeda <select value={currency} onChange={event => setCurrency(event.target.value as typeof currency)}>{CURRENCY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Nota mín. <select value={minNota} onChange={event => setMinNota(Number(event.target.value))}>{[0, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n || 'Qualquer'}</option>)}</select></label>
            <label>Potência mín. <select value={minPotencia} onChange={event => setMinPotencia(Number(event.target.value))}>{[0, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n ? `P${n}` : 'Qualquer'}</option>)}</select></label>
            <button className="opt" aria-pressed={shinyOnly} onClick={() => setShinyOnly(value => !value)}>Só shiny</button>
          </div>
        </div>
        <div className="mkt-session">
          <p className="mkt-count" role="status">{pool.length ? `Analisando ${full.format(pool.length)} anúncios de ${stats.pagesSeen || 1} ${(stats.pagesSeen || 1) === 1 ? 'página vista' : 'páginas vistas'}${stats.pages ? ` (de ${full.format(stats.pages)})` : ''}` : 'Nenhum anúncio acumulado ainda'}{pool.length > 0 && <button className="opt" onClick={clear} disabled={reading}>Limpar</button>}</p>
          {reading ? <><div className="mkt-run"><span role="status">{progress ? `Lendo página ${progress.page ?? '?'} de ${progress.pages ?? '?'}…` : 'Preparando a leitura…'}</span><button onClick={stop}>Parar</button></div><div className="mkt-prog" role="progressbar" aria-label="Páginas lidas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressOf(progress) * 100)} style={{'--p': progressOf(progress)} as CSSProperties}><i/></div></>
            : <button className="mkt-readall" onClick={() => void readAll()} disabled={Boolean(hint)} title={hint || undefined}>Ler todas as páginas desta busca</button>}
          {!reading && hint && <p className="side-foot">{hint}</p>}
          {!reading && id && startError[id] && <p className="mkt-warn" role="alert">{startError[id]}</p>}
          {finished && <p className={finished.error ? 'side-foot' : 'side-foot ok'} role="status">{!finished.error && <i className="burst" aria-hidden="true"/>}{finished.error ?? `Leitura concluída: ${full.format(finished.collected)} anúncios lidos.`}</p>}
          <p className="side-foot">O PokéHub só aperta “próxima página” no ritmo de uma pessoa. Não compra, não anuncia, não abre anúncios.</p>
        </div>
        {pool.length === 0 ? message('Nenhum anúncio na tela', 'O Mercado está aberto, mas não encontrei cards de Pokémon. Se a vitrine já tem anúncios, o layout do jogo pode ter mudado.')
          : deals.length === 0 ? message('Nada com estes filtros', 'Afrouxe os filtros para ver os anúncios analisados.')
          : <ol className="mkt-list">{deals.map(({listing: l, score, reasons}, index) => <li key={`${l.id ?? l.name}-${index}`} className="mkt-card" data-shiny={l.shiny || undefined} style={{'--p': score / 100} as CSSProperties}>
            <div className="mkt-top"><span className="pos">{index + 1}</span><strong title={l.name}>{l.shiny && <span className="mkt-shiny"><Icon d={icons.spark}/>Shiny</span>}{l.name}</strong><b className="mkt-price">{price(l.price)}{coin(l.currency) && <small> {coin(l.currency)}</small>}</b></div>
            <p className="mkt-meta">{[l.level !== null && `Nv ${full.format(l.level)}`, l.nota !== null && `Nota ${dec(l.nota)}`].filter(Boolean).join(' · ') || (l.potencia === null ? 'Sem detalhes na tela' : '')}{l.potencia !== null && <span className="mkt-pot" data-p={Math.min(5, Math.max(1, Math.round(l.potencia)))} title={`Potência ${l.potencia}`}>P{l.potencia}</span>}{l.smart && <span className="mkt-smart" data-label={l.smart.label} title={l.smart.market !== null ? `Mercado: ${price(l.smart.market)}` : 'Selo da Smart Market'}>{smartText(l.smart)}</span>}</p>
            <div className="mkt-bar" data-tier={tier(score)} role="img" aria-label={`Pontuação ${Math.round(score)} de 100`}><i/><span>{Math.round(score)}</span></div>
            <ul className="mkt-why">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          </li>)}</ol>}
        {!data!.smart && pool.length > 0 && <p className="side-foot">Instale/ative a Smart Market em Gerenciar → Extensões para comparar com o preço de mercado.</p>}
        <p className="side-foot">A pontuação é uma estimativa a partir do que está na tela, não uma garantia. Atualiza a cada 5 s. Somente leitura: o PokéHub não compra nem clica por você.</p>
      </>}
  </div>;
}
