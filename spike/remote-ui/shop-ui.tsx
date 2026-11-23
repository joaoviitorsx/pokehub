// Loja e ações no celular (R4): estoque, compra manual e kits, plano de revisão, teclado de PIN, progresso ao vivo, e os botões de Conta/Modo leve.
// O celular NUNCA decide preço, total nem teto: manda só item e quantidade; o PC relê os preços, calcula o plano e devolve uma confirmação de uso único.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Ball } from '../src/icons';
import { MAX_KIT_LINES, MAX_KITS, MAX_QTY, SHOP_CATALOG, SHOP_CATS, loadKits, saveKits, type Kit, type ShopCat } from '../domain/shop';
import type { ActionsState, RemoteShopAccount, ShopConfirmReply, ShopEvent, ShopPlanReply } from '../contracts/remote';
import { get, post, type Account, type Me } from './api';

const full = new Intl.NumberFormat('pt-BR');
export const gold = (n: number | null | undefined) => typeof n === 'number' ? full.format(n) : '—';
const buzz = () => { try { navigator.vibrate?.(10); } catch { /* sem vibração */ } };

// ---------- Estado das ações (PIN lembrado, permissões) ----------
export interface Acts { state: ActionsState | null; elevLeftMs: number; refresh(): Promise<void>; remember(ms: number): void; lost(): void }
const ActsContext = createContext<Acts>({state: null, elevLeftMs: 0, refresh: async () => undefined, remember: () => undefined, lost: () => undefined});
export const useActs = () => useContext(ActsContext);
export const ActsProvider = ActsContext.Provider;
/** O estado vem de /api/me; o PIN lembrado vive SÓ no servidor (aqui só guardamos "até quando" para mostrar a contagem). */
export function useActsState(me: Me, now: number): Acts {
  const [state, setState] = useState<ActionsState | null>(me.actions ?? null), [until, setUntil] = useState(() => me.actions?.elevatedMs ? Date.now() + me.actions.elevatedMs : 0);
  const refresh = useCallback(async () => { try { const m = await get<Me>('/api/me'); setState(m.actions ?? null); setUntil(m.actions?.elevatedMs ? Date.now() + m.actions.elevatedMs : 0); } catch { /* sem conexão: mantém o último estado */ } }, []);
  const remember = useCallback((ms: number) => setUntil(Date.now() + ms), []), lost = useCallback(() => setUntil(0), []);
  return useMemo(() => ({state, elevLeftMs: Math.max(0, until - now), refresh, remember, lost}), [state, until, now, refresh, remember, lost]);
}
/** Por que as ações estão desligadas (texto claro) ou null se podem ser usadas. */
export function blockReason(a: ActionsState | null): string | null {
  if (!a) return 'Ações indisponíveis neste PC.';
  if (a.actionsDisabled) return 'As ações pelo celular foram desligadas no PC (muitos erros de PIN). Religue em Gerenciar → Acesso remoto.';
  if (!a.canAct) return 'Este aparelho só pode ver. No PC, abra Gerenciar → Acesso remoto e ligue “Pode agir” para este celular.';
  if (!a.pinSet) return 'Defina um PIN de 6 dígitos no PC (Gerenciar → Acesso remoto) para agir pelo celular.';
  if (a.lockedMs > 0) return `PIN bloqueado por erros. Tente de novo em ${Math.ceil(a.lockedMs / 60_000)} min.`;
  return null;
}
interface Reply { ok: boolean; status: number; error?: string; data: Record<string, unknown> | null; network?: boolean }
async function api(path: string, body: unknown, key?: string): Promise<Reply> {
  try { const r = await post(path, body, key ? {'Idempotency-Key': key} : undefined); return {ok: r.ok, status: r.status, error: r.error, data: (r.data ?? null) as Record<string, unknown> | null}; }
  catch { return {ok: false, status: 0, error: 'Sem conexão com o PC. Confira o Wi-Fi.', data: null, network: true}; }
}
const newKey = () => `ph-${(crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^\w-]/g, '').slice(0, 36)}`;

// ---------- Teclado de PIN (6 dígitos, teclas grandes, vibração curta) ----------
export function PinPad({title, detail, busy, error, lock, elevLeftMs, canRemember, onPin, onRemembered, onCancel}: {
  title: string; detail?: string; busy: boolean; error: string; lock?: boolean; elevLeftMs: number; canRemember: boolean;
  onPin(pin: string, remember: boolean): void; onRemembered?: () => void; onCancel(): void;
}) {
  const [pin, setPin] = useState(''), [remember, setRemember] = useState(false);
  const press = (d: string) => { buzz(); if (busy || lock) return; const next = (pin + d).slice(0, 6); setPin(next); if (next.length === 6) { onPin(next, remember); setPin(''); } };
  const min = Math.ceil(elevLeftMs / 60_000);
  return <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="pin-h"><div className="sheet-box wood">
    <h2 id="pin-h">{title}</h2>{detail && <p className="muted">{detail}</p>}
    {onRemembered && elevLeftMs > 0 && <button className="primary wide" disabled={busy} onClick={() => { buzz(); onRemembered(); }}>PIN lembrado ({min} min): confirmar</button>}
    <p className="pin-dots" role="img" aria-label={`${pin.length} de 6 dígitos`}>{[0, 1, 2, 3, 4, 5].map(i => <i key={i} data-on={i < pin.length ? '' : undefined}/>)}</p>
    <p className="msg" role={error ? 'alert' : 'status'}>{busy ? 'Conferindo…' : error}</p>
    <div className="pad" role="group" aria-label="Teclado do PIN">{['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} type="button" className="key" disabled={busy || lock} onClick={() => press(d)}>{d}</button>)}
      <button type="button" className="key sub" aria-label="Limpar" disabled={busy || pin.length === 0} onClick={() => { buzz(); setPin(''); }}>Limpar</button>
      <button type="button" className="key" disabled={busy || lock} onClick={() => press('0')}>0</button>
      <button type="button" className="key sub" aria-label="Apagar" disabled={busy || pin.length === 0} onClick={() => { buzz(); setPin(p => p.slice(0, -1)); }}>⌫</button></div>
    {canRemember && <label className="toggle rem"><span>Lembrar o PIN por 10 min<small>A memória fica no PC, não neste celular.</small></span><input type="checkbox" role="switch" checked={remember} onChange={e => setRemember(e.target.checked)}/><i/></label>}
    <div className="row-btns"><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button></div>
  </div></div>;
}
const ERR: Record<string, string> = {pin_necessario: 'Informe o PIN.', sem_pin: 'Defina o PIN no PC.', sem_permissao: 'Este aparelho não tem permissão para agir.', acoes_desligadas: 'Ações desligadas no PC.', limite: 'Muitas ações em pouco tempo. Aguarde um minuto.'};
/** Texto de erro de uma resposta de ação (PIN errado/bloqueado, limites, etc.). */
export function actError(r: Reply): string {
  const code = typeof r.data?.code === 'string' ? r.data.code : '';
  if (code === 'pin_errado') return r.error ?? 'PIN incorreto.';
  if (code === 'pin_bloqueado') return `PIN bloqueado. Tente de novo em ${Math.ceil(Number(r.data?.retryAfterMs ?? 0) / 60_000)} min.`;
  return ERR[code] ?? r.error ?? 'Não foi possível concluir.';
}

/** Ação de conta/Modo leve: abre o teclado de PIN (ou usa o PIN lembrado), manda ao PC e mostra o resultado. */
export function useGate() {
  const acts = useActs();
  const [ask, setAsk] = useState<{title: string; detail: string; run: (pin?: string) => Promise<Reply>} | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<{ok: boolean; text: string} | null>(null);
  const finish = useCallback(async (r: Reply) => {
    setBusy(false);
    const code = typeof r.data?.code === 'string' ? r.data.code : '';
    if (r.ok) { setAsk(null); setError(''); setResult({ok: true, text: 'Feito.'}); }
    else if (code === 'pin_errado' || code === 'pin_necessario') { if (code === 'pin_necessario') acts.lost(); setError(actError(r)); } // o teclado continua aberto para tentar de novo
    else { setAsk(null); setError(''); setResult({ok: false, text: actError(r)}); }
    await acts.refresh();
  }, [acts]);
  const submit = useCallback(async (pin: string | undefined, remember: boolean) => {
    if (!ask || busy) return; setBusy(true); setError('');
    if (pin && remember) { const e = await api('/api/elevate', {pin}); if (e.ok) acts.remember(Number(e.data?.elevatedMs ?? 600_000)); else { await finish(e); return; } }
    await finish(await ask.run(pin));
  }, [ask, busy, acts, finish]);
  const pad = ask ? <PinPad title={ask.title} detail={ask.detail} busy={busy} error={error} elevLeftMs={acts.elevLeftMs} canRemember onPin={(pin, remember) => void submit(pin, remember)} onRemembered={() => void submit(undefined, false)} onCancel={() => { setAsk(null); setError(''); }}/> : null;
  return {pad, result, clear: () => setResult(null), request: (title: string, detail: string, run: (pin?: string) => Promise<Reply>) => { setResult(null); setError(''); setAsk({title, detail, run}); }};
}

/** Recarregar / Suspender / Retomar a conta aberta (aba Conta). */
export function AccountActions({account}: {account: Account}) {
  const {state} = useActs(), gate = useGate(), why = blockReason(state);
  const go = (kind: 'reload' | 'suspend' | 'resume', verb: string) => gate.request(`${verb} ${account.label}`, `Informe o PIN para ${verb.toLowerCase()} esta conta.`, pin => api(`/api/account/${encodeURIComponent(account.id)}/${kind}`, pin ? {pin} : {}));
  return <section className="card" aria-labelledby="acc-act"><h2 id="acc-act">Ações da conta</h2>
    <div className="row-btns"><button disabled={why !== null || account.suspended} onClick={() => go('reload', 'Recarregar')}>Recarregar</button>
      <button disabled={why !== null || account.suspended} onClick={() => go('suspend', 'Suspender')}>Suspender</button>
      <button disabled={why !== null || !account.suspended} onClick={() => go('resume', 'Retomar')}>Retomar</button></div>
    {why ? <p className="hint left" role="status">{why}</p> : <p className="hint left">{account.suspended ? 'Conta suspensa: só dá para retomar.' : 'Pede o PIN (ou o PIN lembrado). Cada ação fica no registro do PC e avisa lá.'}</p>}
    {gate.result && <p className={gate.result.ok ? 'ok' : 'msg'} role="status">{gate.result.ok ? 'Pedido enviado ao PC.' : gate.result.text}</p>}
    {gate.pad}</section>;
}
/** Modo leve global (aba Contas). */
export function LiteToggle() {
  const {state} = useActs(), gate = useGate(), why = blockReason(state), on = state?.lite === true;
  return <section className="card" aria-labelledby="lite-h"><h2 id="lite-h">Modo leve</h2>
    <label className="toggle lite"><span>Modo leve do PC<small>{why ?? (on ? 'Ligado: contas em segundo plano gastam menos.' : 'Desligado.')}</small></span>
      <input type="checkbox" role="switch" checked={on} disabled={why !== null} onChange={e => { const next = e.target.checked; gate.request(`${next ? 'Ligar' : 'Desligar'} o Modo leve`, 'Informe o PIN para mudar o Modo leve no PC.', pin => api('/api/lite', {on: next, ...(pin ? {pin} : {})})); }}/><i/></label>
    {gate.result && !gate.result.ok && <p className="msg" role="status">{gate.result.text}</p>}{gate.pad}</section>;
}

// ---------- Loja ----------
const keyOf = (cat: ShopCat, name: string) => `${cat}|${name}`;
const splitKey = (key: string): [ShopCat, string] | null => { const [cat, ...rest] = key.split('|'); const name = rest.join('|'); return SHOP_CATS.includes(cat as ShopCat) && SHOP_CATALOG[cat as ShopCat].includes(name) ? [cat as ShopCat, name] : null; };
const clampQty = (n: number) => Math.min(MAX_QTY, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
const ITEM_OPTIONS = SHOP_CATS.map(cat => <optgroup key={cat} label={cat}>{SHOP_CATALOG[cat].map(name => <option key={name} value={keyOf(cat, name)}>{name}</option>)}</optgroup>);
const newId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
type Stage = {k: 'pick'} | {k: 'review'; plan: ShopPlanReply; label: string; ids: string[]} | {k: 'run'; plan: ShopPlanReply; reply?: ShopConfirmReply; error?: string; retryKey?: string} ;

export function ShopView({accounts, log}: {accounts: Account[]; log: ShopEvent[]}) {
  const acts = useActs(), why = blockReason(acts.state);
  const [sel, setSel] = useState<string[]>([]), [stock, setStock] = useState<RemoteShopAccount[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [item, setItem] = useState(keyOf('Pokebolas', 'Ultra Ball')), [qty, setQty] = useState(10), [kits, setKits] = useState<Kit[]>(() => loadKits()), [draft, setDraft] = useState<Kit | null>(null);
  const [stage, setStage] = useState<Stage>({k: 'pick'}), [now, setNow] = useState(() => Date.now()), [padError, setPadError] = useState(''), [padBusy, setPadBusy] = useState(false), [asking, setAsking] = useState(false);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const live = accounts.filter(a => !a.suspended && a.state === 'ready');
  const ids = sel.filter(id => accounts.some(a => a.id === id));
  const persist = (next: Kit[]) => { setKits(next); saveKits(next); };
  const pick = (id: string) => setSel(old => old.includes(id) ? old.filter(x => x !== id) : old.length >= 4 ? old : [...old, id]);

  const readNow = async () => {
    if (busy || !ids.length) return; setBusy(true); setMsg('');
    const r = await api('/api/shop/read', {profileIds: ids});
    if (r.ok && Array.isArray(r.data?.accounts)) setStock(r.data.accounts as RemoteShopAccount[]); else setMsg(actError(r));
    setBusy(false); void acts.refresh();
  };
  const review = async (body: Record<string, unknown>, name: string) => {
    if (busy || !ids.length) return; setBusy(true); setMsg('');
    const r = await api('/api/shop/plan', {profileIds: ids, ...body});
    if (r.ok && typeof r.data?.confirmId === 'string') setStage({k: 'review', plan: r.data as unknown as ShopPlanReply, label: name, ids});
    else { const p = r.data?.plan as ShopPlanReply['plan'] | undefined; setMsg(p ? `${r.error ?? 'Nada a comprar.'} ${p.accounts.filter(a => a.error).map(a => `${a.label}: ${a.error}`).join(' ')}` : actError(r)); }
    setBusy(false); void acts.refresh();
  };
  const buyManual = () => { const p = splitKey(item); if (p) void review({mode: 'manual', lines: [{cat: p[0], name: p[1], qty: clampQty(qty)}]}, `${clampQty(qty)}× ${p[1]}`); };
  const restock = (kit: Kit) => void review({mode: 'kit', kit: {name: kit.name, lines: kit.lines.map(l => ({cat: l.cat, name: l.name, target: l.target}))}}, `Kit ${kit.name}`);
  const saveDraft = () => { if (!draft) return; const name = draft.name.trim().slice(0, 32), lines = draft.lines.filter(l => l.target >= 1); if (!name || !lines.length) return; const kit = {...draft, name, lines}; persist(kits.some(k => k.id === kit.id) ? kits.map(k => k.id === kit.id ? kit : k) : [...kits, kit].slice(0, MAX_KITS)); setDraft(null); };
  const setLine = (i: number, patch: Partial<Kit['lines'][number]>) => setDraft(d => d && {...d, lines: d.lines.map((l, n) => n === i ? {...l, ...patch} : l)});

  /** Confirma no servidor: a chave de repetição fica a mesma se a rede cair no meio (o PC devolve o resultado em vez de comprar de novo). */
  const confirm = async (plan: ShopPlanReply, pin: string | undefined, remember: boolean, key = newKey()) => {
    setPadBusy(true); setPadError('');
    if (pin && remember) { const e = await api('/api/elevate', {pin}); if (e.ok) acts.remember(Number(e.data?.elevatedMs ?? 600_000)); }
    const r = await api('/api/shop/confirm', {confirmId: plan.confirmId, planHash: plan.planHash, ...(pin ? {pin} : {})}, key);
    setPadBusy(false);
    if (r.network) { setAsking(false); setStage({k: 'run', plan, error: r.error, retryKey: key}); return; }
    const code = typeof r.data?.code === 'string' ? r.data.code : '';
    if (code === 'pin_errado' || code === 'pin_necessario') { if (code === 'pin_necessario') acts.lost(); setPadError(actError(r)); void acts.refresh(); return; }
    setAsking(false); void acts.refresh();
    if (r.data && Array.isArray(r.data.accounts)) { setStage({k: 'run', plan, reply: r.data as unknown as ShopConfirmReply}); return; }
    if (code === 'expirada' || code === 'ja_usada' || code === 'plano_alterado' || code === 'nao_encontrada') { setStage({k: 'pick'}); setMsg(`${actError(r)} Revise a compra de novo.`); return; }
    setStage({k: 'run', plan, error: actError(r)});
  };
  const done = stage.k === 'run' ? log.find((e): e is Extract<ShopEvent, {kind: 'done'}> => e.kind === 'done' && e.confirmId === stage.plan.confirmId)?.result : undefined; // a conclusão também chega por SSE se a resposta se perder
  const reply = stage.k === 'run' ? stage.reply ?? done : undefined;
  const again = () => { setStage({k: 'pick'}); setStock([]); setMsg(''); };

  if (stage.k === 'review') {
    const {plan} = stage, left = Math.max(0, Math.ceil((plan.expiresAt - now) / 1000)), p = plan.plan, needsPin = p.needsPin || acts.elevLeftMs <= 0;
    const executable = p.accounts.filter(a => a.executable);
    return <>
      <section className="card plan" aria-labelledby="plan-h"><h2 id="plan-h">Revisar compra</h2>
        <p className="muted">{stage.label} · {executable.length} conta{executable.length === 1 ? '' : 's'} · <b data-low={left <= 10 ? '' : undefined}>{left > 0 ? `válido por ${left} s` : 'expirou'}</b></p>
        {p.accounts.map(a => <div key={a.profileId} className="plan-acc" data-bad={a.executable ? undefined : ''}>
          <h3>{a.label}</h3>
          {a.error && <p className="msg" role="alert">{a.error}</p>}
          {a.lines.length > 0 && <table className="stock"><thead><tr><th>Item</th><th>Qtd</th><th>Unid.</th><th>Total</th></tr></thead><tbody>{a.lines.map(l => <tr key={`${l.cat}${l.name}`} data-off={l.fits ? undefined : ''}><td>{l.name}{l.note && <em> · {l.note}</em>}</td><td>{gold(l.qty)}</td><td>{gold(l.unitPrice)}</td><td>{gold(l.total)}</td></tr>)}</tbody></table>}
          {a.executable && <>
            <p className="plan-line"><span>Ouro</span><b>{gold(a.goldBefore)} → {gold(a.goldAfter)}</b></p>
            <p className="plan-line"><span>Total</span><b className="gold-t">{gold(a.total)}</b></p>
            <div className="bar" role="meter" aria-label="Teto diário do celular" aria-valuemin={0} aria-valuemax={p.dailyCapGold} aria-valuenow={p.dailyCapGold - a.capAfter} data-hot={a.capAfter < p.dailyCapGold * .25 ? 'alto' : a.capAfter < p.dailyCapGold * .5 ? 'medio' : undefined}><i style={{width: `${Math.min(100, (p.dailyCapGold - a.capAfter) / Math.max(1, p.dailyCapGold) * 100)}%`}}/></div>
            <p className="hint left">Teto do dia: restam {gold(a.capAfter)} de {gold(p.dailyCapGold)} depois desta compra.</p></>}
        </div>)}
        <p className="plan-line total"><span>Total geral</span><b className="gold-t">{gold(p.total)} ouro</b></p>
        {p.needsPin && <p className="hint left">Compra grande (mais da metade do teto restante): o PIN é pedido mesmo com o PIN lembrado.</p>}
        <div className="row-btns"><button onClick={() => setStage({k: 'pick'})}>Voltar</button><button className="primary" disabled={left === 0 || busy || padBusy} onClick={() => { buzz(); setPadError(''); setAsking(true); }}>{needsPin ? 'Confirmar com PIN' : `Confirmar (PIN lembrado ${Math.ceil(acts.elevLeftMs / 60_000)} min)`}</button></div>
        {left === 0 && <p className="msg" role="alert">A confirmação expirou. Volte e revise de novo.</p>}
      </section>
      {asking && <PinPad title="Confirmar compra" detail={`Total ${gold(p.total)} de ouro. O preço será conferido de novo no jogo antes de comprar.`} busy={padBusy} error={padError} elevLeftMs={p.needsPin ? 0 : acts.elevLeftMs} canRemember={!p.needsPin} onPin={(pin, remember) => void confirm(stage.plan, pin, remember)} onRemembered={() => void confirm(stage.plan, undefined, false)} onCancel={() => setAsking(false)}/>}
    </>;
  }
  if (stage.k === 'run') {
    const events = log.filter(e => e.kind === 'line' && e.confirmId === stage.plan.confirmId) as Extract<ShopEvent, {kind: 'line'}>[], plan = stage.plan.plan.accounts.filter(a => a.executable);
    const statusOf = (pid: string, i: number) => reply ? undefined : events.filter(e => e.profileId === pid && e.line === i).at(-1);
    return <section className="card plan" aria-labelledby="run-h" aria-live="polite"><h2 id="run-h">{reply ? (reply.spent > 0 ? 'Compra concluída' : 'Nada foi comprado') : stage.error ? 'Sem resposta do PC' : 'Comprando…'}</h2>
      {stage.error && !reply && <><p className="msg" role="alert">{stage.error}</p><p className="hint left">A compra pode ter sido feita. Tente de novo: o PC reconhece o pedido e devolve o resultado sem comprar duas vezes.</p><div className="row-btns"><button className="primary" disabled={padBusy} onClick={() => void confirm(stage.plan, undefined, false, stage.retryKey)}>Tentar de novo</button><button onClick={again}>Fechar</button></div></>}
      {reply ? <>{reply.accounts.map(a => <div key={a.profileId} className="plan-acc" data-bad={a.status === 'abortada' ? '' : undefined}><h3>{a.label} <small>{a.status === 'ok' ? '✓ ok' : a.status === 'parcial' ? 'parcial' : '✗ abortada'}</small></h3>
          {a.error && <p className="msg" role="alert">{a.error}</p>}<ul className="runl">{a.lines.map((l, i) => <li key={i} data-s={l.status}><b aria-hidden="true">{l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : '·'}</b><span>{gold(l.qty)}× {l.name}</span><em>{l.status === 'ok' ? `−${gold(l.spent ?? 0)}` : l.error ?? 'pulada'}</em></li>)}</ul></div>)}
        <p className="plan-line total"><span>Gasto</span><b className="gold-t">{gold(reply.spent)} ouro</b></p><button className="primary wide" onClick={again}>Nova compra</button></>
        : !stage.error && plan.map(a => <div key={a.profileId} className="plan-acc"><h3>{a.label}</h3><ul className="runl">{a.lines.filter(l => l.fits).map((l, i) => { const e = statusOf(a.profileId, i), s = e?.status ?? 'wait'; return <li key={i} data-s={s}><b aria-hidden="true">{s === 'ok' ? '✓' : s === 'error' ? '✗' : s === 'buying' ? '●' : '·'}</b><span>{gold(l.qty)}× {l.name}</span><em>{s === 'ok' ? 'comprado' : s === 'error' ? e?.error ?? 'erro' : s === 'buying' ? 'comprando…' : 'na fila'}</em></li>; })}</ul></div>)}
      {!reply && !stage.error && <p className="hint left"><Ball className="wobble"/> Acompanhe aqui. O PC confere o preço de novo e compra uma linha por vez.</p>}
    </section>;
  }

  return <>
    <section className="card" aria-labelledby="shop-h"><h2 id="shop-h">Contas</h2>
      <div className="chips" role="group" aria-label="Contas da Loja">{accounts.map(a => { const off = a.suspended || a.state !== 'ready'; return <button key={a.id} className="chip" aria-pressed={ids.includes(a.id)} disabled={off} title={off ? 'A conta precisa estar pronta' : undefined} onClick={() => pick(a.id)}><i className="gem" style={{background: a.color}}/>{a.label}</button>; })}</div>
      {live.length === 0 && <p className="hint left">Nenhuma conta pronta agora.</p>}
      <div className="row-btns"><button className="primary" disabled={why !== null || busy || !ids.length} onClick={() => void readNow()}>{busy ? 'Lendo o Market…' : 'Ler estoque'}</button></div>
      {why ? <p className="hint left" role="status">{why}</p> : <p className="hint left">Abre e fecha o Market no jogo. Só ouro; nunca o Mercado da Comunidade. Até 4 contas.</p>}
      {msg && <p className="msg" role="alert">{msg}</p>}
    </section>
    {stock.map(a => <section key={a.profileId} className="card" aria-label={a.label}><h2>{a.label}{a.gold !== null && <b className="gold-h">{gold(a.gold)} ouro</b>}</h2>
      {a.error ? <p className="msg" role="alert">{a.error}</p> : <table className="stock"><thead><tr><th>Item</th><th>Tem</th><th>Preço</th></tr></thead><tbody>{a.items.map(i => <tr key={keyOf(i.cat, i.name)}><td>{i.name}</td><td>{gold(i.have)}</td><td>{gold(i.price)}</td></tr>)}</tbody></table>}</section>)}
    <section className="card" aria-labelledby="buy-h"><h2 id="buy-h">Comprar</h2>
      <div className="buy-form"><select aria-label="Item" value={item} onChange={e => setItem(e.target.value)}>{ITEM_OPTIONS}</select>
        <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} aria-label="Quantidade" onChange={e => setQty(Number(e.target.value))} onBlur={() => setQty(clampQty(qty))}/></div>
      <div className="row-btns"><button onClick={() => setQty(10)}>×10</button><button onClick={() => setQty(100)}>×100</button><button className="primary" disabled={why !== null || busy || !ids.length} onClick={buyManual}>Revisar compra</button></div>
      <p className="hint left">O preço vem do jogo, não do celular. Você vê tudo na revisão antes de confirmar.</p></section>
    <section className="card" aria-labelledby="kit-h"><h2 id="kit-h">Kits de reposição</h2>
      {kits.length === 0 && !draft && <p className="hint left">Um kit é uma lista de metas, como “Ultra Ball → 200, Revive → 50”. Repor compra só o que falta. Os kits ficam neste celular.</p>}
      <ul className="kits">{kits.map(kit => <li key={kit.id}><div><strong>{kit.name}</strong><small>{kit.lines.map(l => `${l.name} → ${full.format(l.target)}`).join(' · ')}</small></div>
        <button disabled={why !== null || busy || !ids.length} onClick={() => restock(kit)}>Repor</button><button aria-label={`Editar ${kit.name}`} onClick={() => setDraft({...kit, lines: kit.lines.map(l => ({...l}))})}>Editar</button><button className="danger" aria-label={`Excluir ${kit.name}`} onClick={() => persist(kits.filter(k => k.id !== kit.id))}>×</button></li>)}</ul>
      {draft ? <div className="kit-edit"><input value={draft.name} maxLength={32} placeholder="Nome do kit (ex.: Farm padrão)" aria-label="Nome do kit" onChange={e => setDraft({...draft, name: e.target.value})}/>
        {draft.lines.map((l, i) => <div key={i} className="buy-form"><select aria-label="Item do kit" value={keyOf(l.cat, l.name)} onChange={e => { const p = splitKey(e.target.value); if (p) setLine(i, {cat: p[0], name: p[1]}); }}>{ITEM_OPTIONS}</select>
          <input type="number" inputMode="numeric" min={1} value={l.target} aria-label="Meta" onChange={e => setLine(i, {target: Math.max(0, Math.floor(Number(e.target.value)) || 0)})}/><button aria-label="Remover item" onClick={() => setDraft({...draft, lines: draft.lines.filter((_, n) => n !== i)})}>×</button></div>)}
        <div className="row-btns"><button disabled={draft.lines.length >= MAX_KIT_LINES} onClick={() => setDraft({...draft, lines: [...draft.lines, {cat: 'Pokebolas', name: 'Ultra Ball', target: 100}]})}>Adicionar item</button><button className="primary" disabled={!draft.name.trim() || !draft.lines.some(l => l.target >= 1)} onClick={saveDraft}>Salvar kit</button><button onClick={() => setDraft(null)}>Cancelar</button></div></div>
        : <button disabled={kits.length >= MAX_KITS} onClick={() => setDraft({id: newId(), name: '', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', target: 200}]})}>Novo kit</button>}
    </section>
  </>;
}
