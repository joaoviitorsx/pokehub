// Ações pelo celular (R4): Loja (só ouro, só catálogo), recarregar/suspender/retomar conta e Modo leve. Sem I/O de rede nem Electron: tudo entra por `deps` (testável).
// Compras em DUAS FASES com confirmação emitida pelo SERVIDOR (uso único, 60 s, ligada ao hash do plano), reserva ATÔMICA do teto diário (SQLite) antes de agir,
// preço relido no jogo antes de comprar e chave de idempotência. O celular nunca decide preço, total nem teto. Nenhuma rota, seletor ou URL de compra no
// Mercado da Comunidade (dinheiro real) existe aqui: o hub só leva o usuário até o anúncio e o toque em Comprar é dele.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_QTY, fitPlan, isCatalogItem, isShopCat, parseKits, planRestock, type Kit, type ShopItem, type ShopLineResult, type ShopOrder, type ShopPlanEntry, type ShopProgress, type ShopRead } from '../domain/shop';
import type { ActionsState, RemoteAccountResult, RemoteLineResult, RemotePlan, RemotePlanAccount, RemotePlanLine, RemotePurchase, RemoteShopAccount, RemoteSpend, ShopConfirmReply, ShopEvent, ShopPlanReply } from '../contracts/remote';
import { RateLimiter, localDay, type PinGuard } from './guards';
import type { ConfirmRow, DeviceRow, RemoteStore } from './store';

export type ShopResult<T> = {ok: true; data: T} | {ok: false; error: string};
/** A Loja rápida do hub (createShop): leitura e execução de plano, com as travas por conta e o catálogo. */
export interface ShopPort { read(id: string): Promise<ShopResult<ShopRead>>; run(plan: ShopPlanEntry[], onProgress: (progress: ShopProgress) => void): Promise<ShopResult<ShopLineResult[]>> }
/** Ações de conta e Modo leve do hub (as mesmas funções do IPC do PC). */
export interface AccountPort {
  reload(id: string): Promise<{ok: boolean; error?: string}>; suspend(id: string): Promise<{ok: boolean; error?: string}>; resume(id: string): Promise<{ok: boolean; error?: string}>;
  setLite(on: boolean): {ok: boolean; error?: string}; lite(): boolean;
}
export interface ActionsDeps {
  store: RemoteStore; pin: PinGuard; now: () => number; accounts(): readonly {id: string; label: string; suspended: boolean}[]; shop: ShopPort; account: AccountPort;
  publish(deviceId: string, event: string, data: unknown): void; notifyPc(title: string, body: string): void; pushDevices(label: string, text: string): void;
  audit(deviceId: string | null, action: string, detail: string | null): void;
  /** Dia do teto no fuso local e o nome do fuso (guardado junto com o gasto). */ dayOf?(ms: number): string; tz?: string;
}
export interface ActionReply { status: number; body: Record<string, unknown>; headers?: Record<string, string> }

export const ELEVATION_MS = 10 * 60_000, PLAN_TTL_MS = 60_000, ACT_PER_MIN = 5, SHOP_PER_MIN = 10, MAX_PLAN_LINES = 12, MAX_PLAN_ACCOUNTS = 4, IDEM_RE = /^[\w-]{8,64}$/;
export const DEFAULT_CAP_GOLD = 200_000;
export { localDay };
const localTz = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { return 'local'; } };
const gold = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const MSG = {off: 'As ações pelo celular estão desligadas no PC.', perm: 'Este aparelho não tem permissão para agir. Libere em Gerenciar → Acesso remoto → “Pode agir”.', noPin: 'Defina o PIN no PC (Gerenciar → Acesso remoto) para agir pelo celular.',
  needPin: 'Informe o PIN.', rate: 'Muitas ações em pouco tempo. Aguarde um minuto.', bad: 'Pedido inválido.', unknown: 'Conta não encontrada.', gone: 'Confirmação não encontrada.', expired: 'A confirmação expirou. Revise a compra de novo.',
  used: 'Esta confirmação já foi usada.', hash: 'O plano mudou. Revise a compra de novo.', idem: 'Chave de repetição inválida.', idemOther: 'Esta chave de repetição já foi usada em outra compra.', idemLost: 'A compra anterior foi interrompida. Confira o histórico no PC.',
  nothing: 'Nada para comprar com estes itens, o ouro e o teto diário.'};
const err = (status: number, code: string, error: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): ActionReply => ({status, body: {error, code, ...extra}, ...(headers ? {headers} : {})});

// --- Plano canônico ---
interface ExecLine { cat: ShopOrder['cat']; name: string; qty: number; unitPrice: number; total: number }
interface ExecAccount { profileId: string; label: string; lines: ExecLine[] }
interface ExecPlan { accounts: ExecAccount[]; needsPin: boolean }
/** JSON canônico do que será comprado (conta, item, quantidade, preço unitário), em ordem estável: é o que o hash protege. */
export const canonicalPlan = (accounts: readonly ExecAccount[]): string => JSON.stringify([...accounts].sort((a, b) => a.profileId < b.profileId ? -1 : 1).map(a => [a.profileId, a.lines.map(l => [l.cat, l.name, l.qty, l.unitPrice])]));
export const planHashOf = (accounts: readonly ExecAccount[]): string => createHash('sha256').update(canonicalPlan(accounts)).digest('hex');
const sameHex = (a: unknown, b: string) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createActions(deps: ActionsDeps) {
  const now = deps.now, dayOf = deps.dayOf ?? localDay, tz = deps.tz ?? localTz(), store = deps.store;
  const actLimit = new RateLimiter(ACT_PER_MIN, 60_000, now), shopLimit = new RateLimiter(SHOP_PER_MIN, 60_000, now), pinLimit = new RateLimiter(10, 60_000, now);
  const elevations = new Map<string, number>(); // aparelho → até quando (só na memória do servidor; nunca no celular)
  const elevSpent = new Map<string, Map<string, number>>(); // aparelho → conta → ouro (comprado ou reservado) DURANTE a elevação atual: fatiar compras não escapa do PIN
  const confirms = new Map<string, ConfirmRow>(); // espelho em memória das confirmações ativas (o banco é a fonte de verdade do "usada")
  const inflight = new Map<string, Promise<ActionReply>>(); // aparelho|chave de repetição → execução em andamento
  const label = (id: string) => deps.accounts().find(a => a.id === id)?.label ?? 'Conta';
  const known = () => new Set(deps.accounts().map(a => a.id));

  // --- Elevação por PIN (10 min, vinculada ao aparelho, não renova sozinha) ---
  const canAct = (id: string) => store.getDevice(id)?.canAct === true;
  function elevatedMs(id: string): number {
    const until = elevations.get(id) ?? 0, left = until - now();
    if (left <= 0 || !canAct(id) || store.getActionsDisabled() || store.getPinHash() === null) { elevations.delete(id); return 0; }
    return left;
  }
  const clearElevations = (id?: string) => { if (id) { elevations.delete(id); elevSpent.delete(id); } else { elevations.clear(); elevSpent.clear(); } };
  /** PIN exigido quando a compra passa de 50% do teto DIÁRIO ou, somada ao já gasto nesta elevação, passa de 50% (impede fatiar). */
  const needsPinFor = (deviceId: string, profileId: string, total: number, cap: number) => total * 2 > cap || ((elevSpent.get(deviceId)?.get(profileId) ?? 0) + total) * 2 > cap;
  const addElevSpent = (deviceId: string, profileId: string, amount: number) => { if (amount <= 0 || elevatedMs(deviceId) <= 0) return; const m = elevSpent.get(deviceId) ?? new Map<string, number>(); m.set(profileId, (m.get(profileId) ?? 0) + amount); elevSpent.set(deviceId, m); };
  const lockedMs = (id: string) => Math.max(0, (store.pinState(id)?.lockedUntil ?? 0) - now());
  function state(device: Pick<DeviceRow, 'id'>): ActionsState {
    return {canAct: canAct(device.id), pinSet: store.getPinHash() !== null, actionsDisabled: store.getActionsDisabled(), lockedMs: lockedMs(device.id), elevatedMs: elevatedMs(device.id), dailyCapGold: store.getDailyCapGold(), lite: deps.account.lite()};
  }
  /** Travas comuns: ações desligadas por erros de PIN e permissão "Pode agir" do aparelho (lida do banco a cada pedido). */
  function gate(device: DeviceRow): ActionReply | null {
    if (store.getActionsDisabled()) return err(423, 'acoes_desligadas', MSG.off);
    if (!canAct(device.id)) return err(403, 'sem_permissao', MSG.perm);
    return null;
  }
  /** PIN verificado NO SERVIDOR (mesmos bloqueios e escalonamento). Com elevação ativa dispensa o PIN, exceto se `force` (compra grande). */
  async function pinGate(device: DeviceRow, pin: unknown, force = false): Promise<ActionReply | null> {
    if (store.getPinHash() === null) return err(403, 'sem_pin', MSG.noPin);
    if (!force && elevatedMs(device.id) > 0) return null;
    if (pin === undefined || pin === null || pin === '') return err(403, 'pin_necessario', MSG.needPin, {force});
    const result = await deps.pin.check(device.id, pin);
    if (result.ok) return null;
    clearElevations(device.id);
    switch (result.reason) {
      case 'wrong': return err(403, 'pin_errado', `PIN incorreto. Restam ${result.attemptsLeft ?? 0} tentativa(s).`, {attemptsLeft: result.attemptsLeft ?? 0});
      case 'locked': return err(423, 'pin_bloqueado', 'PIN bloqueado por erros. Tente mais tarde.', {retryAfterMs: result.retryAfterMs ?? 0}, {'Retry-After': String(Math.ceil((result.retryAfterMs ?? 0) / 1000))});
      case 'disabled': return err(423, 'acoes_desligadas', MSG.off);
      case 'revoked': return err(401, 'revogado', 'Aparelho revogado.');
      default: return err(403, 'sem_pin', MSG.noPin);
    }
  }
  const audit = (id: string | null, action: string, detail: string | null) => { try { deps.audit(id, action, detail && clip(detail, 200)); } catch { /* auditoria não derruba a ação */ } };
  const notify = (title: string, body: string) => { try { deps.notifyPc(title, clip(body, 240)); } catch { /* sem notificação nativa */ } };

  async function elevate(device: DeviceRow, body: Record<string, unknown>): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    if (!pinLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '60'});
    elevations.delete(device.id); elevSpent.delete(device.id); // pede o PIN sempre: elevar de novo só com o PIN certo (e o gasto da elevação recomeça do zero)
    const refused = await pinGate(device, body.pin); if (refused) return refused;
    elevations.set(device.id, now() + ELEVATION_MS); elevSpent.set(device.id, new Map());
    audit(device.id, 'elevacao_pin', `${device.name}: PIN lembrado por 10 min`);
    return {status: 200, body: {ok: true, elevatedMs: ELEVATION_MS}};
  }

  // --- Loja: leitura e plano ---
  const parseIds = (raw: unknown): string[] | null => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PLAN_ACCOUNTS || !raw.every(x => typeof x === 'string') || new Set(raw).size !== raw.length) return null;
    const ok = known(); return raw.every(x => ok.has(x as string)) ? raw as string[] : null;
  };
  const catalogItems = (read: ShopRead): ShopItem[] => read.items.filter(i => isCatalogItem(i.cat, i.name)); // o que não é do catálogo nunca chega ao celular
  async function readAll(ids: string[]): Promise<{id: string; result: ShopResult<ShopRead>}[]> {
    return Promise.all(ids.map(async id => { try { return {id, result: await deps.shop.read(id)}; } catch { return {id, result: {ok: false as const, error: 'Não foi possível ler a Loja desta conta.'}}; } }));
  }
  async function shopRead(device: DeviceRow, body: Record<string, unknown>): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    const ids = parseIds(body.profileIds); if (!ids) return err(400, 'invalido', MSG.bad);
    if (!shopLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '30'});
    const accounts: RemoteShopAccount[] = (await readAll(ids)).map(({id, result}) => result.ok ? {profileId: id, label: label(id), gold: result.data.gold, items: catalogItems(result.data)} : {profileId: id, label: label(id), gold: null, items: [], error: result.error});
    audit(device.id, 'loja_leitura', `${device.name}: ${ids.map(label).join(', ')}`);
    return {status: 200, body: {accounts}};
  }
  const parseManual = (raw: unknown): {cat: ShopOrder['cat']; name: string; qty: number}[] | null => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PLAN_LINES) return null;
    const out: {cat: ShopOrder['cat']; name: string; qty: number}[] = [];
    for (const l of raw) {
      if (typeof l !== 'object' || l === null) return null;
      const x = l as Record<string, unknown>;
      if (!isShopCat(x.cat) || typeof x.name !== 'string' || !isCatalogItem(x.cat, x.name) || !whole(x.qty, 1, MAX_QTY) || out.some(y => y.cat === x.cat && y.name === x.name)) return null;
      out.push({cat: x.cat, name: x.name, qty: x.qty});
    }
    return out;
  };
  const parseKit = (raw: unknown): Kit | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const k = raw as Record<string, unknown>;
    if (!Array.isArray(k.lines) || k.lines.length < 1 || k.lines.length > MAX_PLAN_LINES) return null;
    const kit = parseKits([{id: 'kit', name: k.name, lines: k.lines}])[0];
    return kit && kit.lines.length === k.lines.length ? kit : null; // linha inválida = kit inválido (nada é descartado em silêncio)
  };
  const remainingCap = (day: string, profileId: string, cap: number) => Math.max(0, cap - store.spentToday(day, profileId));

  async function shopPlan(device: DeviceRow, body: Record<string, unknown>): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    const ids = parseIds(body.profileIds), mode = body.mode;
    if (!ids || (mode !== 'manual' && mode !== 'kit')) return err(400, 'invalido', MSG.bad);
    const manual = mode === 'manual' ? parseManual(body.lines) : null, kit = mode === 'kit' ? parseKit(body.kit) : null;
    if (mode === 'manual' ? !manual : !kit) return err(400, 'invalido', MSG.bad);
    if (!shopLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '30'});
    const day = dayOf(now()), cap = store.getDailyCapGold(), reads = await readAll(ids); // PREÇOS RELIDOS no jogo: nunca vêm do celular
    const planAccounts: RemotePlanAccount[] = [], exec: ExecAccount[] = [];
    let needsPin = false;
    for (const {id, result} of reads) {
      const base = {profileId: id, label: label(id)}, capRemaining = remainingCap(day, id, cap);
      if (!result.ok) { planAccounts.push({...base, goldBefore: null, goldAfter: null, lines: [], total: 0, capRemaining, capAfter: capRemaining, executable: false, error: result.error}); continue; }
      const items = catalogItems(result.data), g = result.data.gold, notes = new Map<string, string>();
      let orders: ShopOrder[];
      if (manual) {
        orders = [];
        for (const l of manual) { const item = items.find(i => i.cat === l.cat && i.name === l.name); if (!item) notes.set(`${l.cat}|${l.name}`, 'Não está à venda nesta conta.'); else orders.push({cat: l.cat, name: l.name, qty: l.qty, unitPrice: item.price, total: l.qty * item.price}); }
      } else orders = planRestock(items, kit!.lines);
      const fit = fitPlan(orders, g), fitting = fit.filter(f => f.fits).map(f => f.order), total = fitting.reduce((s, o) => s + o.total, 0);
      const lines: RemotePlanLine[] = fit.map(f => ({cat: f.order.cat, name: f.order.name, have: items.find(i => i.cat === f.order.cat && i.name === f.order.name)?.have ?? 0, qty: f.order.qty, unitPrice: f.order.unitPrice, total: f.order.total, fits: f.fits, ...(f.fits ? {} : {note: 'Ouro insuficiente.'})}));
      for (const [key, note] of notes) { const [cat, ...n] = key.split('|'); lines.push({cat: cat as ShopOrder['cat'], name: n.join('|'), have: 0, qty: manual?.find(l => l.cat === cat && l.name === n.join('|'))?.qty ?? 0, unitPrice: 0, total: 0, fits: false, note}); }
      let error: string | undefined;
      if (total === 0) error = orders.length === 0 ? (kit ? 'Já está completo para este kit.' : 'Nenhum item à venda.') : 'Ouro insuficiente.';
      else if (total > capRemaining) error = `Passa do teto diário do celular (restam ${gold(capRemaining)} de ouro).`;
      const executable = error === undefined;
      if (executable) { exec.push({...base, lines: fitting.map(o => ({cat: o.cat, name: o.name, qty: o.qty, unitPrice: o.unitPrice, total: o.total}))}); if (needsPinFor(device.id, id, total, cap)) needsPin = true; }
      planAccounts.push({...base, goldBefore: g, goldAfter: g === null ? null : g - (executable ? total : 0), lines, total: executable ? total : 0, capRemaining, capAfter: capRemaining - (executable ? total : 0), executable, ...(error ? {error} : {})});
    }
    const plan: RemotePlan = {accounts: planAccounts, total: exec.reduce((s, a) => s + a.lines.reduce((t, l) => t + l.total, 0), 0), needsPin, dailyCapGold: cap, mode, ...(kit ? {kitName: kit.name} : {})};
    audit(device.id, 'loja_plano', `${device.name}: ${mode === 'kit' ? `kit ${kit!.name}` : 'manual'}, ${exec.length ? `total ${gold(plan.total)} de ouro` : 'nada a comprar'}`);
    if (!exec.length) return err(422, 'nada_a_comprar', MSG.nothing, {plan});
    const confirmId = randomBytes(16).toString('hex'), planHash = planHashOf(exec), at = now();
    const row: ConfirmRow = {id: confirmId, deviceId: device.id, planHash, planJson: JSON.stringify({accounts: exec, needsPin} satisfies ExecPlan), createdAt: at, expiresAt: at + PLAN_TTL_MS, used: false, idemKey: null, resultJson: null};
    store.addConfirm(row);
    for (const old of confirms.values()) if (old.deviceId === device.id) old.used = true; // um plano novo invalida o anterior
    for (const [id, c] of confirms) if (c.expiresAt < at - 60_000) confirms.delete(id);
    confirms.set(confirmId, row);
    return {status: 200, body: {confirmId, planHash, expiresAt: row.expiresAt, plan, elevated: elevatedMs(device.id) > 0} satisfies ShopPlanReply};
  }

  // --- Loja: confirmação e execução ---
  async function shopConfirm(device: DeviceRow, body: Record<string, unknown>, idemKey: unknown): Promise<ActionReply> {
    if (typeof idemKey !== 'string' || !IDEM_RE.test(idemKey)) return err(400, 'idempotencia', MSG.idem);
    const key = `${device.id}|${idemKey}`, running = inflight.get(key);
    if (running) return running; // a mesma chave enquanto a primeira ainda roda: uma só execução
    const work = confirmOnce(device, body, idemKey).finally(() => inflight.delete(key));
    inflight.set(key, work); return work;
  }
  async function confirmOnce(device: DeviceRow, body: Record<string, unknown>, idemKey: string): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    const confirmId = body.confirmId;
    if (typeof confirmId !== 'string' || !/^[0-9a-f]{32}$/.test(confirmId) || typeof body.planHash !== 'string') return err(400, 'invalido', MSG.bad);
    const prior = store.findIdem(device.id, idemKey); // repetição da mesma chave: devolve o resultado guardado, sem comprar de novo
    if (prior) {
      if (prior.id !== confirmId) return err(409, 'idempotencia', MSG.idemOther);
      if (prior.resultJson) { try { const saved = JSON.parse(prior.resultJson) as {status: number; body: Record<string, unknown>}; return {status: saved.status, body: {...saved.body, repetida: true}}; } catch { /* resultado ilegível */ } }
      return err(409, 'interrompida', MSG.idemLost);
    }
    const stored = confirms.get(confirmId) ?? store.getConfirm(confirmId);
    if (!stored || stored.deviceId !== device.id) return err(404, 'nao_encontrada', MSG.gone); // de outro aparelho = igual a inexistente
    if (stored.used || store.getConfirm(confirmId)?.used) return err(409, 'ja_usada', MSG.used);
    if (now() > stored.expiresAt) return err(410, 'expirada', MSG.expired);
    let exec: ExecPlan;
    try { exec = JSON.parse(stored.planJson) as ExecPlan; } catch { return err(409, 'plano_invalido', MSG.hash); }
    if (!sameHex(body.planHash, stored.planHash) || planHashOf(exec.accounts) !== stored.planHash) { store.markConfirmUsed(confirmId, null); stored.used = true; audit(device.id, 'compra_hash_diferente', device.name); return err(409, 'plano_alterado', MSG.hash); }
    // PIN: sempre que a compra passa de 50% do teto DIÁRIO, ou o total da elevação atual + esta compra passa de 50% (mesmo com elevação); senão, elevação dispensa
    const cap0 = store.getDailyCapGold();
    const big = exec.accounts.some(a => needsPinFor(device.id, a.profileId, a.lines.reduce((s, l) => s + l.total, 0), cap0));
    const refused = await pinGate(device, body.pin, big); if (refused) return refused;
    if (!actLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '60'}); // 5 ações/min por aparelho (depois do PIN: erros de PIN têm o próprio bloqueio)
    // seção síncrona (sem await até reservar o teto): reconfere, marca como USADA e só então age
    if (stored.used || now() > stored.expiresAt || !store.markConfirmUsed(confirmId, idemKey)) return err(409, 'ja_usada', MSG.used);
    stored.used = true; stored.idemKey = idemKey;
    return execute(device, stored, exec);
  }

  async function execute(device: DeviceRow, c: ConfirmRow, exec: ExecPlan): Promise<ActionReply> {
    const day = dayOf(now()), cap = store.getDailyCapGold();
    const total = (lines: readonly ExecLine[]) => lines.reduce((s, l) => s + l.total, 0);
    const results = new Map<string, RemoteAccountResult>(), reserved = new Map<string, number>(); // conta → ouro ainda reservado
    const purchases: Omit<Parameters<RemoteStore['addPurchase']>[0], 'at'>[] = [];
    const abort = (a: ExecAccount, why: string, code: string) => {
      const left = reserved.get(a.profileId); if (left !== undefined) { store.releaseSpend(day, a.profileId, left); reserved.delete(a.profileId); }
      results.set(a.profileId, {profileId: a.profileId, label: a.label, status: 'abortada', spent: 0, lines: a.lines.map(l => ({name: l.name, qty: l.qty, status: 'pulada' as const, error: why})), error: why});
      for (const l of a.lines) purchases.push({deviceId: device.id, deviceName: device.name, profileId: a.profileId, confirmId: c.id, planHash: c.planHash, item: l.name, qty: l.qty, unitPrice: l.unitPrice, total: 0, result: `abortada: ${why}`});
      audit(device.id, code, `${a.label}: ${why}`);
    };
    try {
      const live: ExecAccount[] = [];
      for (const a of exec.accounts) { // reserva atômica do teto ANTES de comprar (duas compras simultâneas não estouram o teto)
        const amount = total(a.lines);
        if (store.reserveSpend(day, a.profileId, amount, cap, tz)) { reserved.set(a.profileId, amount); live.push(a); } else abort(a, 'Passa do teto diário do celular.', 'compra_recusada_teto');
      }
      // relê os preços no jogo logo antes de comprar: se subiu, aborta a conta ("preço mudou"); se baixou, compra pelo preço novo
      const fresh = new Map<string, ExecAccount>();
      await Promise.all(live.map(async a => {
        let read: ShopResult<ShopRead>;
        try { read = await deps.shop.read(a.profileId); } catch { read = {ok: false, error: 'Não foi possível ler a Loja desta conta.'}; }
        if (!read.ok) return abort(a, read.error, 'compra_abortada');
        const items = catalogItems(read.data), lines: ExecLine[] = [];
        for (const l of a.lines) {
          const item = items.find(i => i.cat === l.cat && i.name === l.name);
          if (!item) return abort(a, `${l.name} não está mais à venda.`, 'compra_abortada');
          if (item.price > l.unitPrice) return abort(a, `Preço mudou (${l.name}: ${gold(l.unitPrice)} → ${gold(item.price)}).`, 'compra_preco_mudou');
          lines.push({...l, unitPrice: item.price, total: item.price * l.qty});
        }
        if (read.data.gold === null || read.data.gold < total(lines)) return abort(a, 'Ouro insuficiente agora.', 'compra_abortada');
        fresh.set(a.profileId, {...a, lines});
      }));
      const runnable = live.filter(a => fresh.has(a.profileId));
      const emit = (data: ShopEvent) => { try { deps.publish(device.id, 'shop', data); } catch { /* sem fluxo aberto */ } };
      emit({kind: 'start', confirmId: c.id, accounts: exec.accounts.map(a => ({profileId: a.profileId, label: a.label, lines: a.lines.length}))});
      for (const a of exec.accounts) if (results.has(a.profileId)) a.lines.forEach((l, line) => emit({kind: 'line', confirmId: c.id, profileId: a.profileId, label: a.label, line, name: l.name, qty: l.qty, status: 'error', error: results.get(a.profileId)!.error ?? ''}));
      if (runnable.length) {
        const entries: ShopPlanEntry[] = runnable.map(a => ({id: a.profileId, lines: fresh.get(a.profileId)!.lines.map(l => ({cat: l.cat, name: l.name, qty: l.qty, unitPrice: l.unitPrice, total: l.total}))}));
        let run: ShopResult<ShopLineResult[]>;
        try { run = await deps.shop.run(entries, p => { if (p.kind === 'line') emit({kind: 'line', confirmId: c.id, profileId: p.profileId, label: label(p.profileId), line: p.line, name: p.name, qty: p.qty, status: p.status, ...(p.spent !== undefined ? {spent: p.spent} : {}), ...(p.error ? {error: p.error} : {})}); }); }
        catch { run = {ok: false, error: 'Não foi possível concluir a compra. Confira no jogo.'}; }
        if (!run.ok) for (const a of runnable) abort(a, run.error, 'compra_abortada');
        else for (const a of runnable) {
          const mine = run.data.filter(r => r.profileId === a.profileId), lines: RemoteLineResult[] = [];
          let spent = 0, okCount = 0, held = 0;
          for (const r of mine) {
            // gasto AUTORIZADO: preço × quantidade comprada (nunca o delta de ouro, que mistura os ganhos do jogo ocioso)
            const bought = r.ok ? Math.min(r.order.qty, Math.max(0, r.bought ?? r.order.qty)) : 0, s = r.ok ? r.order.unitPrice * bought : 0;
            const unsure = !r.ok && (r.code === 'unconfirmed' || r.code === 'timeout'); // o clique pode ter ocorrido: a reserva FICA (conservador)
            if (unsure) held += r.order.total;
            if (r.ok) { okCount++; spent += s; lines.push({name: r.order.name, qty: r.order.qty, status: 'ok', bought, spent: s}); } else lines.push({name: r.order.name, qty: r.order.qty, status: r.error?.startsWith('Interrompido') ? 'pulada' : 'erro', error: r.error});
            purchases.push({deviceId: device.id, deviceName: device.name, profileId: a.profileId, confirmId: c.id, planHash: c.planHash, item: r.order.name, qty: r.order.qty, unitPrice: r.order.unitPrice, total: unsure ? r.order.total : s, result: r.ok ? 'ok' : unsure ? 'não confirmada (reservado)' : `erro: ${r.error ?? 'falhou'}`});
          }
          store.releaseSpend(day, a.profileId, Math.max(0, (reserved.get(a.profileId) ?? 0) - spent - held)); reserved.delete(a.profileId); // devolve só o que com certeza não saiu
          addElevSpent(device.id, a.profileId, spent + held);
          results.set(a.profileId, {profileId: a.profileId, label: a.label, status: okCount === 0 ? 'abortada' : okCount === lines.length ? 'ok' : 'parcial', spent, lines, ...(okCount === 0 ? {error: lines.find(l => l.error)?.error ?? 'Nada foi comprado.'} : {})});
        }
      }
    } catch {
      for (const a of exec.accounts) if (!results.has(a.profileId)) abort(a, 'Falha inesperada. Confira no jogo.', 'compra_abortada');
    } finally {
      for (const [profileId, left] of reserved) store.releaseSpend(day, profileId, left); // nada fica reservado se algo escapou
    }
    const accounts = exec.accounts.map(a => results.get(a.profileId)!).filter(Boolean), spent = accounts.reduce((s, a) => s + a.spent, 0);
    const reply: ShopConfirmReply = {confirmId: c.id, spent, accounts};
    const at = new Date(now()).toISOString();
    for (const p of purchases) { try { store.addPurchase({...p, at}); } catch { /* histórico não derruba o resultado */ } }
    const bought = accounts.filter(a => a.spent > 0), summary = bought.map(a => `${a.label}: ${a.lines.filter(l => l.status === 'ok').map(l => `${l.qty}× ${l.name}`).join(', ')}`).join(' · ');
    const status = spent > 0 || accounts.some(a => a.status === 'ok') ? 200 : 409, aborted = accounts.filter(a => a.error).map(a => `${a.label}: ${a.error}`).join(' · ');
    audit(device.id, spent > 0 ? 'compra_confirmada' : 'compra_abortada', `${device.name} — ${spent > 0 ? `${summary} (−${gold(spent)} ouro)` : aborted || 'nada comprado'}${spent > 0 && aborted ? ` · ${aborted}` : ''}`);
    const message = spent > 0 ? `${summary} (−${gold(spent)} ouro)` : `Nada foi comprado — ${aborted || 'sem detalhes'}`;
    notify(spent > 0 ? 'Compra feita pelo celular' : 'Compra do celular não concluída', spent > 0 ? `Compra feita pelo celular: ${message} · ${device.name}` : `${message} · ${device.name}`);
    try { deps.pushDevices(spent > 0 ? 'Compra pelo celular' : 'Compra não concluída', clip(message, 110)); } catch { /* push opcional */ }
    const out: ActionReply = status === 200 ? {status, body: {...reply}} : {status, body: {error: aborted || MSG.nothing, code: 'compra_abortada', ...reply}};
    try { store.setConfirmResult(c.id, JSON.stringify({status: out.status, body: out.body})); } catch { /* sem banco */ }
    try { deps.publish(device.id, 'shop', {kind: 'done', confirmId: c.id, result: reply} satisfies ShopEvent); } catch { /* sem fluxo */ }
    return out;
  }

  // --- Ações de conta e Modo leve ---
  const KIND = {reload: {act: 'acao_recarregar', verb: 'Recarregar', done: 'recarregada'}, suspend: {act: 'acao_suspender', verb: 'Suspender', done: 'suspensa'}, resume: {act: 'acao_retomar', verb: 'Retomar', done: 'retomada'}} as const;
  async function account(device: DeviceRow, profileId: string, kind: keyof typeof KIND, body: Record<string, unknown>): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    const acc = deps.accounts().find(a => a.id === profileId); if (!acc) return err(404, 'nao_encontrada', MSG.unknown);
    const refused = await pinGate(device, body.pin); if (refused) return refused;
    const k = KIND[kind];
    if (kind === 'resume' && !acc.suspended) return err(409, 'estado', 'A conta não está suspensa.');
    if (kind !== 'resume' && acc.suspended) return err(409, 'estado', kind === 'suspend' ? 'A conta já está suspensa.' : 'A conta está suspensa: use Retomar.');
    if (!actLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '60'});
    let r: {ok: boolean; error?: string};
    try { r = await deps.account[kind](profileId); } catch { r = {ok: false}; }
    if (!r.ok) { audit(device.id, 'acao_falhou', `${k.verb} ${acc.label}: ${r.error ?? 'falhou'}`); return err(409, 'falhou', r.error ?? `Não foi possível: ${k.verb.toLowerCase()} ${acc.label}.`); }
    audit(device.id, k.act, `${device.name}: ${acc.label}`);
    notify('Ação pelo celular', `${k.verb} ${acc.label} (pedido de “${device.name}”).`);
    return {status: 200, body: {ok: true, accountId: profileId, action: kind}};
  }
  async function lite(device: DeviceRow, body: Record<string, unknown>): Promise<ActionReply> {
    const blocked = gate(device); if (blocked) return blocked;
    if (typeof body.on !== 'boolean') return err(400, 'invalido', MSG.bad);
    const refused = await pinGate(device, body.pin); if (refused) return refused;
    if (!actLimit.hit(device.id)) return err(429, 'limite', MSG.rate, {}, {'Retry-After': '60'});
    const r = deps.account.setLite(body.on);
    if (!r.ok) { audit(device.id, 'acao_falhou', `Modo leve: ${r.error ?? 'falhou'}`); return err(409, 'falhou', r.error ?? 'Não foi possível mudar o Modo leve.'); }
    audit(device.id, 'modo_leve', `${device.name}: ${body.on ? 'ligado' : 'desligado'}`);
    notify('Ação pelo celular', `Modo leve ${body.on ? 'ligado' : 'desligado'} (pedido de “${device.name}”).`);
    return {status: 200, body: {ok: true, lite: body.on}};
  }

  return {
    state, elevate, shopRead, shopPlan, shopConfirm, account, lite, clearElevations, elevatedMs,
    /** Aparelho saiu (revogado, expirado ou logout): perde a elevação e as confirmações abertas. */
    forget(deviceId: string) { elevations.delete(deviceId); for (const c of confirms.values()) if (c.deviceId === deviceId) c.used = true; },
    /** Gasto de hoje por conta e histórico (últimas 50) para o painel do PC. */
    spendToday(): RemoteSpend[] { const day = dayOf(now()), cap = store.getDailyCapGold(), rows = new Map(store.spendOfDay(day).map(r => [r.profileId, r.gold])); return deps.accounts().map(a => ({profileId: a.id, label: a.label, gold: rows.get(a.id) ?? 0, capGold: cap})); },
    purchases(): RemotePurchase[] { return store.listPurchases(50).map(p => ({id: p.id, at: p.at, deviceId: p.deviceId, deviceName: p.deviceName, profileId: p.profileId, label: label(p.profileId), item: p.item, qty: p.qty, unitPrice: p.unitPrice, total: p.total, result: p.result})); },
    /** Só para testes: quantas execuções estão em andamento. */
    pending: () => inflight.size,
  };
}
export type Actions = ReturnType<typeof createActions>;
