import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '../domain/profiles';
import { MAX_QTY, SHOP_CATALOG, isCatalogItem, SHOP_CATS, fitPlan, loadKits, orderTotal, planRestock, planTotal, saveKits, isShopCat, MAX_KITS, MAX_KIT_LINES, type Kit, type ShopCat, type ShopItem, type ShopLine, type ShopLineResult, type ShopOrder, type ShopProgress, type ShopRead } from '../domain/shop';
import { huntFetchable } from './hunt-queue';
import { Ball, Icon, icons } from './icons';
import { catLabel, DEFAULT_STOCK_RULES, STOCK_CATS, type StockRules } from '../domain/stock';
import type { StockEntry } from '../electron/stock-watch';
import type { CSSProperties } from 'react';

const full = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const fail = 'Falha de comunicação com o aplicativo.';
type Read = {data: ShopRead} | {error: string};
interface Entry { id: string; label: string; gold: number | null; lines: ShopLine[]; note?: string }
interface Confirm { title: string; entries: Entry[] }
type LineProgress = Extract<ShopProgress, {kind: 'line'}>;
interface Run { entries: Entry[]; st: Record<string, LineProgress>; done: boolean; stopped: boolean; results?: ShopLineResult[]; error?: string }
const keyOf = (cat: ShopCat, name: string) => `${cat}|${name}`;
const splitKey = (key: string): [ShopCat, string] | null => { const i = key.indexOf('|'), cat = key.slice(0, i); return isShopCat(cat) ? [cat, key.slice(i + 1)] : null; };
const newId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clampQty = (value: number) => Math.min(MAX_QTY, Math.max(1, Math.floor(Number.isFinite(value) ? value : 1)));

/** Itens oferecidos nos seletores: só o catálogo fixo (itens novos do jogo aparecem na tabela como "não suportado", mas não são comprados). */
function catalogOf(): Record<ShopCat, string[]> {
  const out = {Pokebolas: [...SHOP_CATALOG.Pokebolas], Poções: [...SHOP_CATALOG.Poções], Revives: [...SHOP_CATALOG.Revives]} as Record<ShopCat, string[]>;
  return out;
}
function ItemSelect({value, onChange, catalog, label}: {value: string; onChange: (key: string) => void; catalog: Record<ShopCat, string[]>; label: string}) {
  return <select value={value} aria-label={label} onChange={event => onChange(event.target.value)}>{SHOP_CATS.map(cat => <optgroup key={cat} label={cat}>{catalog[cat].map(name => <option key={name} value={keyOf(cat, name)}>{name}</option>)}</optgroup>)}</select>;
}

export function ShopPanel({profiles, states, id, active, restockRequest = null}: {profiles: Profile[]; states: Record<string, string>; id: string | undefined; active: boolean; restockRequest?: {profileId: string; n: number} | null}) {
  const [sel, setSel] = useState<string[]>(() => id ? [id] : []);
  const [seen, setSeen] = useState(id);
  if (seen !== id) { setSeen(id); if (id) setSel([id]); }
  const [reads, setReads] = useState<Record<string, Read>>({});
  const [work, setWork] = useState<'read' | 'prepare' | null>(null);
  const [msg, setMsg] = useState('');
  const [item, setItem] = useState(keyOf('Pokebolas', 'Ultra Ball'));
  const [qty, setQty] = useState(10);
  const [kits, setKits] = useState<Kit[]>(() => loadKits());
  const [draft, setDraft] = useState<Kit | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const opened = useRef(false);
  const idleRef = useRef(true);
  const running = Boolean(run && !run.done);
  const liveIds = useMemo(() => profiles.filter(p => sel.includes(p.id) && huntFetchable(states[p.id])).map(p => p.id), [profiles, sel, states]);
  const label = (pid: string) => profiles.find(p => p.id === pid)?.label ?? 'Conta';
  const catalog = useMemo(() => catalogOf(), []);

  useEffect(() => window.pokehub.shop.onProgress(p => setRun(old => old && (p.kind === 'line' ? {...old, st: {...old.st, [`${p.profileId}|${p.line}`]: p}} : {...old, done: true, stopped: p.stopped}))), []);

  async function readAccounts(ids: string[]): Promise<Record<string, Read>> {
    const fresh: Record<string, Read> = {};
    for (const pid of ids) {
      const r = await window.pokehub.shop.read(pid).catch(() => ({ok: false as const, error: fail}));
      fresh[pid] = r.ok ? {data: r.data} : {error: r.error};
      setReads(old => ({...old, [pid]: fresh[pid]!}));
    }
    return fresh;
  }
  const readNow = async () => { setWork('read'); setMsg(''); await readAccounts(liveIds); setWork(null); };
  // Uma leitura ao abrir a aba pela primeira vez (sem leitura periódica: cada leitura abre e fecha o Market no jogo).
  useEffect(() => {
    if (!active || opened.current) return;
    opened.current = true;
    if (liveIds.length) setTimeout(() => void readNow(), 0); // fora do corpo do efeito
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Leitura nova + plano por conta + confirmação. Nada é comprado antes do "Confirmar compra".
  async function prepare(title: string, build: (read: ShopRead) => {orders: ShopOrder[]; note?: string}, only?: string[]) {
    const ids = only ? only.filter(pid => profiles.some(p => p.id === pid && huntFetchable(states[p.id]))) : liveIds;
    if (!ids.length) { setMsg(only ? 'A sessão desta conta precisa estar aberta e logada para repor.' : 'Selecione ao menos uma conta com a sessão aberta.'); return; }
    setWork('prepare'); setMsg('');
    const fresh = await readAccounts(ids);
    const entries = ids.map((pid): Entry => {
      const r = fresh[pid];
      if (!r || 'error' in r) return {id: pid, label: label(pid), gold: null, lines: [], note: r ? r.error : 'Sem leitura.'};
      const b = build(r.data);
      return {id: pid, label: label(pid), gold: r.data.gold, lines: fitPlan(b.orders, r.data.gold), note: b.note};
    });
    setWork(null);
    if (entries.every(e => e.lines.length === 0)) setMsg(entries.map(e => `${e.label}: ${e.note ?? 'nada a comprar'}`).join(' · '));
    else setConfirm({title, entries});
  }
  const buyManual = () => {
    const parts = splitKey(item); if (!parts) return;
    const [cat, name] = parts, q = clampQty(qty);
    void prepare(`${q}× ${name}`, read => {
      const it = read.items.find(i => i.cat === cat && i.name === name);
      if (it && !isCatalogItem(cat, name)) return {orders: [], note: 'item não suportado'};
      return it ? {orders: [{cat, name, qty: q, unitPrice: it.price, total: orderTotal(q, it.price)}]} : {orders: [], note: 'item não aparece no Market'};
    });
  };
  const restock = (kit: Kit, only?: string[]) => void prepare(`Repor: ${kit.name}`, read => { const orders = planRestock(read.items, kit.lines); return {orders, note: orders.length ? undefined : 'já está completo'}; }, only);
  // ---- Reposição assistida: estoque vigiado pelo processo principal (sem abrir o Market); "Repor" usa o kit escolhido e a confirmação de sempre
  const [stock, setStock] = useState<Record<string, StockEntry>>({});
  const [rules, setRules] = useState<StockRules>(DEFAULT_STOCK_RULES);
  const [stockKit, setStockKit] = useState<string>(() => { try { return localStorage.getItem('pokehub.stockKit') ?? ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('pokehub.stockKit', stockKit); } catch { /* só não persiste */ } }, [stockKit]);
  useEffect(() => {
    let alive = true;
    void window.pokehub.stock.get().then(r => { if (alive && r.ok) { setStock(r.data.all); setRules(r.data.rules); } }).catch(() => undefined);
    const off = window.pokehub.stock.onChanged(all => setStock(all));
    return () => { alive = false; off(); };
  }, []);
  const kitForStock = kits.find(k => k.id === stockKit) ?? kits[0];
  const saveRules = (next: StockRules) => { setRules(next); void window.pokehub.stock.setRules(next).then(r => { if (r.ok) setRules(r.data); }).catch(() => undefined); };
  const restockAccount = (pid: string) => { if (!kitForStock) { setMsg('Crie um kit de reposição (abaixo) para o PokéHub saber quanto comprar.'); return; } restock(kitForStock, [pid]); };
  // aviso do sistema "Estoque baixo" clicado: prepara a reposição da conta (a compra ainda espera o "Confirmar compra")
  const [seenReq, setSeenReq] = useState(restockRequest?.n ?? 0);
  useEffect(() => {
    if (!restockRequest || restockRequest.n === seenReq || !idleRef.current) return;
    setSeenReq(restockRequest.n);
    restockAccount(restockRequest.profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restockRequest]);

  async function start(c: Confirm) {
    const entries = c.entries.map(e => ({...e, lines: e.lines.filter(l => l.fits)})).filter(e => e.lines.length);
    if (!entries.length) return;
    setConfirm(null); setRun({entries, st: {}, done: false, stopped: false});
    const r = await window.pokehub.shop.run(entries.map(e => ({id: e.id, lines: e.lines.map(l => l.order)}))).catch(() => ({ok: false as const, error: fail}));
    if (!r.ok) { setRun(old => old && {...old, done: true, error: r.error}); return; }
    setReads(old => { // mantém a tabela em dia sem reler o jogo: estoque e ouro conforme o resultado
      const next = {...old};
      for (const res of r.data) {
        const cur = next[res.profileId];
        if (!res.ok || !cur || !('data' in cur)) continue;
        next[res.profileId] = {data: {gold: cur.data.gold === null ? null : Math.max(0, cur.data.gold - (res.spent ?? res.order.total)), items: cur.data.items.map(i => i.cat === res.order.cat && i.name === res.order.name ? {...i, have: i.have + (res.bought ?? 0)} : i)}};
      }
      return next;
    });
    setRun(old => old && {...old, done: true, results: r.data});
  }
  const stop = () => void window.pokehub.shop.stop();
  useEffect(() => {
    if (!confirm) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirm(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const persist = (next: Kit[]) => { setKits(next); saveKits(next); };
  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim().slice(0, 32), lines = draft.lines.filter(l => l.target >= 1);
    if (!name || !lines.length) return;
    const kit = {...draft, name, lines};
    persist(kits.some(k => k.id === kit.id) ? kits.map(k => k.id === kit.id ? kit : k) : [...kits, kit].slice(0, MAX_KITS));
    setDraft(null);
  };
  const setLine = (index: number, patch: Partial<Kit['lines'][number]>) => setDraft(d => d && {...d, lines: d.lines.map((l, i) => i === index ? {...l, ...patch} : l)});
  const idle = work === null && !running;
  useEffect(() => { idleRef.current = idle; });
  const selRead = liveIds.flatMap(pid => { const r = reads[pid]; return r && 'data' in r ? [[pid, r.data] as const] : []; });
  const unit = (data: ShopRead): ShopItem | undefined => { const p = splitKey(item); return p ? data.items.find(i => i.cat === p[0] && i.name === p[1]) : undefined; };

  return <>
    <div className="side-body shop" hidden={!active} aria-busy={work !== null || running}>
      <section className="shop-box stk" aria-label="Reposição assistida">
        <h3><span><Icon d={icons.bell}/> Reposição assistida</span><label className="switch ma-switch" title={rules.on ? 'Desligar os avisos de estoque baixo' : 'Ligar os avisos de estoque baixo'}><span className="sr">Avisos de estoque</span><input type="checkbox" role="switch" checked={rules.on} onChange={event => saveRules({...rules, on: event.target.checked})}/></label></h3>
        <p className="side-foot">Vigia o estoque que a automação do jogo usa (sem abrir o Market) e avisa quando ficar abaixo do mínimo. Repor monta a compra pelo kit e só compra depois do seu “Confirmar compra”.</p>
        <div className="stk-mins">{STOCK_CATS.map(cat => <label key={cat}>{catLabel[cat]} mín.<input type="number" min={0} max={1000000} value={rules.min[cat]} disabled={!rules.on} onChange={event => setRules({...rules, min: {...rules.min, [cat]: Math.max(0, Math.min(1_000_000, Math.floor(Number(event.target.value)) || 0))}})} onBlur={() => saveRules(rules)}/></label>)}</div>
        {kits.length > 0 && <label className="stk-kit">Kit da reposição<select value={kitForStock?.id ?? ''} onChange={event => setStockKit(event.target.value)}>{kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>}
        <ul className="stk-list">{profiles.map(p => { const e = stock[p.id]; return <li key={p.id} data-low={e && e.low.length ? '' : undefined} style={{'--c': p.colorToken} as CSSProperties}>
          <span className="stk-who"><i/>{p.label}</span>
          {e ? <span className="stk-cats">{STOCK_CATS.map(cat => <i key={cat} className="stk-chip" data-low={e.low.includes(cat) || undefined} title={cat === 'Pokebolas' && e.stock.cats.Pokebolas.itens.length ? e.stock.cats.Pokebolas.itens.map(b => `${b.nome}: ${full.format(b.qtd)}`).join(' · ') : `${catLabel[cat]} em uso pela automação`}>{catLabel[cat]} <b>{full.format(e.stock.cats[cat].total)}</b></i>)}</span>
            : <small className="stk-none">{huntFetchable(states[p.id]) ? 'precisa da extensão /hunt' : 'sessão fechada'}</small>}
          {e && e.low.length > 0 && <button className="primary" disabled={!idle || !huntFetchable(states[p.id])} title={kitForStock ? `Repor com o kit “${kitForStock.name}” (você confirma)` : 'Crie um kit abaixo'} onClick={() => restockAccount(p.id)}>Repor</button>}
        </li>; })}</ul>
      </section>
      <fieldset className="shop-accs"><legend>Contas</legend>
        {profiles.map(p => <label key={p.id} className="shop-acc-pick" data-off={!huntFetchable(states[p.id]) || undefined}><input type="checkbox" checked={sel.includes(p.id)} disabled={!idle} onChange={event => setSel(old => event.target.checked ? [...old, p.id] : old.filter(x => x !== p.id))}/><span title={p.label}>{p.label}</span></label>)}
      </fieldset>
      <div className="shop-row"><button className="primary" onClick={() => void readNow()} disabled={!idle || !liveIds.length}>{work === 'read' ? 'Lendo o Market…' : 'Ler estoque'}</button><span className="shop-hint">Abre e fecha o Market no jogo. Só lê quando você pede.</span></div>
      {selRead.length === 0 && work === null && <p className="side-foot">Clique em “Ler estoque” para ver ouro, o que você tem e os preços do Market de cada conta marcada.</p>}
      {liveIds.map(pid => { const r = reads[pid]; return r && <section key={pid} className="shop-acc" aria-label={label(pid)}>
        <h3><span title={label(pid)}>{label(pid)}</span>{'data' in r && r.data.gold !== null && <b className="shop-gold" title="Ouro (Coins)">{full.format(r.data.gold)}<small>ouro</small></b>}</h3>
        {'error' in r ? <p className="shop-warn" role="alert">{r.error}</p> : <table className="shop-table"><thead><tr><th>Item</th><th>Tem</th><th>Preço</th></tr></thead><tbody>
          {SHOP_CATS.flatMap(cat => r.data.items.filter(i => i.cat === cat).map((i, n) => <tr key={keyOf(cat, i.name)} data-first={n === 0 || undefined}><td title={cat}>{i.name}{!isCatalogItem(cat, i.name) && <em> · não suportado</em>}</td><td>{full.format(i.have)}</td><td>{full.format(i.price)}</td></tr>))}
        </tbody></table>}
      </section>; })}

      <section className="shop-box" aria-label="Compra manual"><h3>Comprar</h3>
        <div className="shop-form">
          <ItemSelect value={item} onChange={setItem} catalog={catalog} label="Item"/>
          <input type="number" min={1} max={MAX_QTY} value={qty} aria-label="Quantidade" onChange={event => setQty(Number(event.target.value))} onBlur={() => setQty(clampQty(qty))}/>
          <span className="shop-chips"><button className="opt" onClick={() => setQty(10)}>×10</button><button className="opt" onClick={() => setQty(100)}>×100</button></span>
        </div>
        {selRead.length > 0 && <ul className="shop-quote">{selRead.map(([pid, data]) => { const u = unit(data), q = clampQty(qty); return <li key={pid}><span>{label(pid)}</span>{u ? <b>{full.format(u.price)}/un. · {full.format(orderTotal(q, u.price))}</b> : <em>indisponível</em>}</li>; })}</ul>}
        <button className="primary" onClick={buyManual} disabled={!idle || !liveIds.length}>Comprar…</button>
      </section>

      <section className="shop-box" aria-label="Kits de reposição"><h3>Kits de reposição</h3>
        {kits.length === 0 && !draft && <p className="side-foot">Um kit é uma lista de metas, como “Ultra Ball → 200, Revive → 50”. Repor compra só o que falta.</p>}
        <ul className="shop-kits">{kits.map(kit => <li key={kit.id}><div><strong title={kit.name}>{kit.name}</strong><small>{kit.lines.map(l => `${l.name} → ${full.format(l.target)}`).join(' · ')}</small></div>
          <button onClick={() => restock(kit)} disabled={!idle || !liveIds.length}>Repor</button>
          <button className="icon" aria-label={`Editar ${kit.name}`} title="Editar" disabled={!idle} onClick={() => setDraft({...kit, lines: kit.lines.map(l => ({...l}))})}><Icon d={icons.rows}/></button>
          <button className="icon" aria-label={`Excluir ${kit.name}`} title="Excluir" disabled={!idle} onClick={() => persist(kits.filter(k => k.id !== kit.id))}><Icon d={icons.close}/></button></li>)}</ul>
        {draft ? <div className="shop-edit">
          <input value={draft.name} maxLength={32} placeholder="Nome do kit (ex.: Farm padrão)" aria-label="Nome do kit" onChange={event => setDraft({...draft, name: event.target.value})}/>
          {draft.lines.map((l, index) => <div key={index} className="shop-form"><ItemSelect value={keyOf(l.cat, l.name)} catalog={catalog} label="Item do kit" onChange={key => { const p = splitKey(key); if (p) setLine(index, {cat: p[0], name: p[1]}); }}/><input type="number" min={1} max={1000000} value={l.target} aria-label="Meta" onChange={event => setLine(index, {target: Math.max(0, Math.floor(Number(event.target.value)) || 0)})}/><button className="icon" aria-label="Remover linha" onClick={() => setDraft({...draft, lines: draft.lines.filter((_, i) => i !== index)})}><Icon d={icons.close}/></button></div>)}
          <div className="shop-row"><button onClick={() => setDraft({...draft, lines: [...draft.lines, {cat: 'Pokebolas', name: 'Ultra Ball', target: 100}]})} disabled={draft.lines.length >= MAX_KIT_LINES}>Adicionar item</button><button className="primary" onClick={saveDraft} disabled={!draft.name.trim() || !draft.lines.some(l => l.target >= 1)}>Salvar kit</button><button onClick={() => setDraft(null)}>Cancelar</button></div>
        </div> : <button onClick={() => setDraft({id: newId(), name: '', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}]})} disabled={!idle || kits.length >= MAX_KITS}>Novo kit</button>}
      </section>

      {msg && <p className="shop-warn" role="status">{msg}</p>}
      {run && <section className="shop-run" aria-label="Compra em andamento" aria-live="polite">
        <h3>{run.done ? (run.stopped ? 'Compra interrompida' : 'Compra concluída') : 'Comprando…'}</h3>
        {run.error && <p className="shop-warn" role="alert">{run.error}</p>}
        {run.entries.map(e => <div key={e.id} className="shop-run-acc"><strong>{e.label}</strong><ul>{e.lines.map((l, index) => { const p = run.st[`${e.id}|${index}`], s = p?.status ?? 'wait'; return <li key={index} data-s={s}>
          <span className="shop-mark" aria-hidden="true">{s === 'ok' ? <Icon d={icons.check}/> : s === 'error' ? <Icon d={icons.warn}/> : s === 'buying' ? <Ball className="wobble"/> : '·'}</span>
          <span>{full.format(l.order.qty)}× {l.order.name}</span><em>{s === 'ok' ? `✓ comprado${p?.bought !== undefined && p.bought !== l.order.qty ? ` (${full.format(p.bought)})` : ''}` : s === 'error' ? `✗ ${p?.error ?? 'erro'}` : s === 'skipped' ? 'pulado' : s === 'buying' ? 'comprando…' : 'na fila'}</em></li>; })}</ul></div>)}
        {run.done && run.results && (() => { const ok = run.results.filter(r => r.ok), spent = ok.reduce((sum, r) => sum + (r.spent ?? r.order.total), 0); return <p className="shop-sum" role="status">{ok.length} de {run.results.length} compras feitas · {full.format(spent)} de ouro gasto.</p>; })()}
        {running ? <button onClick={stop}>Parar</button> : <button onClick={() => setRun(null)}>Fechar resumo</button>}
      </section>}
      <p className="side-foot shop-foot">O PokéHub só compra quando você confirma. Só compra itens do catálogo e só quando o preço é em ouro (Coins) do Market: cards em gemas são ignorados. Nunca usa dinheiro real.</p>
    </div>
    {confirm && active && <div className="shop-dialog" role="dialog" aria-modal="true" aria-labelledby="shop-dlg-title">
      <div className="shop-dlg-body">
        <h2 id="shop-dlg-title">Confirmar compra</h2><p className="shop-dlg-sub">{confirm.title}</p>
        {confirm.entries.map(e => { const total = planTotal(e.lines.filter(l => l.fits).map(l => l.order)), off = e.lines.some(l => !l.fits); return <section key={e.id} className="shop-dlg-acc">
          <h3><span title={e.label}>{e.label}</span><small>{e.gold === null ? 'ouro ilegível' : `${full.format(e.gold)} ouro`}</small></h3>
          {e.lines.length === 0 ? <p className="side-foot">{e.note ?? 'Nada a comprar.'}</p> : <ul>{e.lines.map((l, index) => <li key={index} data-off={!l.fits || undefined}><span>{l.order.name}</span><span>{full.format(l.order.qty)} × {full.format(l.order.unitPrice)}</span><b>{full.format(l.order.total)}</b>{!l.fits && <em>sem ouro</em>}</li>)}</ul>}
          {e.lines.length > 0 && <p className="shop-dlg-tot"><span>Total {full.format(total)}</span><span>Ouro depois: {e.gold === null ? '—' : full.format(e.gold - total)}</span></p>}
          {off && <p className="shop-warn" role="alert">Ouro insuficiente: as linhas marcadas não serão compradas.</p>}
        </section>; })}
        <div className="shop-dlg-btns"><button onClick={() => setConfirm(null)} autoFocus>Cancelar</button><button className="primary" disabled={!confirm.entries.some(e => e.lines.some(l => l.fits))} onClick={() => void start(confirm)}>Confirmar compra</button></div>
        <p className="side-foot">Compra só com ouro (Coins) do Market do jogo. O preço é conferido de novo no jogo; se mudou, a linha é cancelada.</p>
      </div>
    </div>}
  </>;
}
