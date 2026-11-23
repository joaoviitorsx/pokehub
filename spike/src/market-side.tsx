import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { rankDeals, type MarketCurrency, type MarketFocus, type MarketListing, type MarketScan } from '../domain/market';
import { huntFetchable } from './hunt-queue';

export const MARKET_REFRESH_MS = 5000;
const READ_TIMEOUT_MS = 12_000;
const unavailable = 'Abra o Mercado nesta conta para analisar os anúncios.';
type Entry = {data: MarketScan} | {error: string};
const FOCUS: [MarketFocus, string][] = [['equilibrado', 'Equilibrado'], ['qualidade', 'Melhor qualidade'], ['desconto', 'Maior desconto']];
const CURRENCY: [MarketCurrency | 'todas', string][] = [['todas', 'Todas'], ['orb', 'Gemas'], ['gold', 'Coins']];
const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const compact = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
const price = (value: number) => value >= 1e5 ? compact.format(value) : full.format(value);
const dec = (value: number) => value.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const coin = (currency: MarketListing['currency']) => currency === 'orb' ? 'Gemas' : currency === 'gold' ? 'Coins' : '';
const smartText = (smart: NonNullable<MarketListing['smart']>) => smart.pct === null ? smart.label : `${smart.pct > 0 ? '+' : '−'}${Math.abs(smart.pct).toLocaleString('pt-BR', {maximumFractionDigits: 1})}%`;

export function MarketPanel({id, state}: {id: string | undefined; state: string}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [stamp, setStamp] = useState(0);
  const [focus, setFocus] = useState<MarketFocus>('equilibrado');
  const [currency, setCurrency] = useState<MarketCurrency | 'todas'>('todas');
  const [minNota, setMinNota] = useState(0);
  const [minPotencia, setMinPotencia] = useState(0);
  const [shinyOnly, setShinyOnly] = useState(false);
  const live = huntFetchable(state);
  // Só lê enquanto a aba está montada (visível) e a janela não está oculta; uma leitura por vez.
  useEffect(() => {
    if (!id || !live) return;
    let alive = true, timer = 0;
    const cycle = async () => {
      if (!document.hidden) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([window.pokehub.market.scan(id), new Promise<never>((_resolve, reject) => { timeout = setTimeout(reject, READ_TIMEOUT_MS); })])
          .catch(() => ({ok: false as const, error: unavailable})).finally(() => clearTimeout(timeout));
        if (!alive) return;
        setEntries(old => ({...old, [id]: result.ok ? {data: result.data} : {error: result.error}}));
      }
      if (alive) timer = window.setTimeout(() => void cycle(), MARKET_REFRESH_MS);
    };
    void cycle();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, live, stamp]);
  const entry = id && live ? entries[id] : undefined;
  const data = entry && 'data' in entry ? entry.data : null;
  const deals = useMemo(() => data ? rankDeals(data.listings, {focus, currency: currency === 'todas' ? null : currency, minNota, minPotencia, shinyOnly}) : [], [data, focus, currency, minNota, minPotencia, shinyOnly]);
  const message = (title: string, body: string) => <div className="side-msg" role="status"><strong>{title}</strong><p>{body}</p></div>;
  return <div className="side-body mkt" aria-busy={live && !entry}>
    {!live ? message('Sessão indisponível', 'Aguarde a sessão desta conta terminar de abrir (ou entre no jogo) para analisar o Mercado.')
      : !entry ? message('Lendo o Mercado…', 'A análise lê só o que está na tela desta conta.')
      : 'error' in entry ? <>{message('Mercado fechado', `${entry.error} — a análise lê só o que está na tela. Abra o Mercado no jogo desta conta.`)}<button onClick={() => setStamp(value => value + 1)}>Tentar de novo</button></>
      : !data!.open ? message('Mercado fechado', 'Abra o Mercado no jogo desta conta — a análise lê só o que está na tela.')
      : <>
        <div className="mkt-filters">
          <div className="seg" role="group" aria-label="Foco" style={{'--n': FOCUS.length, '--i': FOCUS.findIndex(([key]) => key === focus)} as CSSProperties}>{FOCUS.map(([key, label]) => <button key={key} aria-pressed={focus === key} onClick={() => setFocus(key)}>{label}</button>)}</div>
          <div className="mkt-row">
            <label>Moeda <select value={currency} onChange={event => setCurrency(event.target.value as typeof currency)}>{CURRENCY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Nota mín. <select value={minNota} onChange={event => setMinNota(Number(event.target.value))}>{[0, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n || 'Qualquer'}</option>)}</select></label>
            <label>Potência mín. <select value={minPotencia} onChange={event => setMinPotencia(Number(event.target.value))}>{[0, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n ? `P${n}` : 'Qualquer'}</option>)}</select></label>
            <button className="opt" aria-pressed={shinyOnly} onClick={() => setShinyOnly(value => !value)}>Só shiny</button>
          </div>
        </div>
        {data!.listings.length === 0 ? message('Nenhum anúncio na tela', 'O Mercado está aberto, mas não encontrei cards de Pokémon. Se a vitrine já tem anúncios, o layout do jogo pode ter mudado.')
          : deals.length === 0 ? message('Nada com estes filtros', 'Afrouxe os filtros para ver os anúncios da tela.')
          : <ol className="mkt-list">{deals.map(({listing: l, score, reasons}, index) => <li key={`${l.id ?? l.name}-${index}`} className="mkt-card" style={{'--p': score / 100} as CSSProperties}>
            <div className="mkt-top"><span className="pos">{index + 1}</span><strong title={l.name}>{l.shiny && '✨ '}{l.name}</strong><b className="mkt-price">{price(l.price)}{coin(l.currency) && <small> {coin(l.currency)}</small>}</b></div>
            <p className="mkt-meta">{[l.level !== null && `Nv ${full.format(l.level)}`, l.potencia !== null && `P${l.potencia}`, l.nota !== null && `Nota ${dec(l.nota)}`].filter(Boolean).join(' · ') || 'Sem detalhes na tela'}{l.smart && <span className="mkt-smart" data-label={l.smart.label} title={l.smart.market !== null ? `Mercado: ${price(l.smart.market)}` : 'Selo da Smart Market'}>{smartText(l.smart)}</span>}</p>
            <div className="mkt-bar" role="img" aria-label={`Pontuação ${Math.round(score)} de 100`}><i/><span>{Math.round(score)}</span></div>
            <ul className="mkt-why">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          </li>)}</ol>}
        {!data!.smart && data!.listings.length > 0 && <p className="side-foot">Instale/ative a Smart Market em Gerenciar → Extensões para comparar com o preço de mercado.</p>}
        <p className="side-foot">A pontuação é uma estimativa a partir do que está na tela, não uma garantia. Atualiza a cada 5 s. Somente leitura: o PokéHub não compra nem clica por você.</p>
      </>}
  </div>;
}
