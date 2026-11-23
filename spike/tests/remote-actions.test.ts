import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteHub, type RemoteHub } from '../remote/hub';
import { COOKIE } from '../remote/server';
import { ELEVATION_MS, PLAN_TTL_MS, canonicalPlan, localDay, planHashOf, type AccountPort, type ShopPort } from '../remote/actions';
import { createAlertEngine } from '../remote/alerts';
import { RemoteStore } from '../remote/store';
import type { Push, PushSub } from '../remote/push';
import type { NetSelection } from '../remote/ip';
import type { ShopCat } from '../domain/shop';
import type { ActionsState, ShopConfirmReply, ShopPlanReply } from '../contracts/remote';

const root = mkdtempSync(join(tmpdir(), 'pokehub-r4-'));
afterAll(() => { try { rmSync(root, {recursive: true, force: true}); } catch { /* Windows: arquivo aberto */ } });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PIN = '482913';
interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
const json = <T = Record<string, unknown>>(r: Res) => JSON.parse(r.body) as T;

// ---------- Mundo falso do jogo (Loja, contas, Modo leve, avisos no PC) ----------
const CAT: Record<string, ShopCat> = {'Poke Ball': 'Pokebolas', 'Great Ball': 'Pokebolas', Revive: 'Revives', 'Small Potion': 'Poções', 'Master Ball': 'Pokebolas'};
let accts: {id: string; label: string; color: string; state: string; suspended: boolean}[] = [];
let gold: Record<string, number> = {}, have: Record<string, Record<string, number>> = {}, price: Record<string, number> = {};
let reads: string[] = [], runs: {id: string; lines: {name: string; qty: number; unitPrice: number; total: number}[]}[][] = [], calls: string[] = [], notices: {title: string; body: string}[] = [];
let runOverride: ((order: {name: string; qty: number; unitPrice: number; total: number}) => Record<string, unknown> | null) | null = null;
let hike: {name: string; to: number; after: number; id?: string} | null = null, runGate: Promise<void> | null = null, failRead = false, lite = false, failRun = false;
const readCount: Record<string, number> = {};
const stock = (id: string) => ({gold: gold[id] ?? 0, items: Object.keys(price).map(name => ({cat: CAT[name]!, name, have: have[id]?.[name] ?? 0, price: price[name]!}))});
const shop: ShopPort = {
  async read(id) {
    reads.push(id); readCount[id] = (readCount[id] ?? 0) + 1;
    if (failRead) return {ok: false, error: 'Não foi possível acessar o Market desta conta.'};
    const data = stock(id); if (hike && (!hike.id || hike.id === id) && readCount[id]! > hike.after) data.items.find(i => i.name === hike!.name)!.price = hike.to; // o preço subiu só para quem lê depois do plano
    return {ok: true, data};
  },
  async run(plan, on) {
    runs.push(JSON.parse(JSON.stringify(plan)) as typeof runs[number]);
    if (runGate) await runGate;
    if (failRun) return {ok: false, error: 'Já existe uma operação da Loja em andamento.'};
    const results = [];
    for (const entry of plan) for (const [line, order] of entry.lines.entries()) {
      on({kind: 'line', profileId: entry.id, line, name: order.name, qty: order.qty, status: 'buying'});
      const forced = runOverride?.(order); if (forced) { results.push({profileId: entry.id, order, ...forced} as never); continue; }
      gold[entry.id] = (gold[entry.id] ?? 0) - order.total; have[entry.id] = {...have[entry.id], [order.name]: (have[entry.id]?.[order.name] ?? 0) + order.qty};
      on({kind: 'line', profileId: entry.id, line, name: order.name, qty: order.qty, status: 'ok', bought: order.qty, spent: order.total});
      results.push({profileId: entry.id, order, ok: true, bought: order.qty, spent: order.total});
    }
    on({kind: 'done', stopped: false});
    return {ok: true, data: results};
  },
};
const account: AccountPort = {
  reload: async id => { calls.push(`reload:${id}`); return {ok: true}; },
  suspend: async id => { calls.push(`suspend:${id}`); accts.find(a => a.id === id)!.suspended = true; return {ok: true}; },
  resume: async id => { calls.push(`resume:${id}`); accts.find(a => a.id === id)!.suspended = false; return {ok: true}; },
  setLite: on => { calls.push(`lite:${on}`); lite = on; return {ok: true}; }, lite: () => lite,
};

// ---------- Harness HTTPS (hub real, rede falsa) ----------
let curDir = '', hub: RemoteHub, port = 0, clock = Date.now(), dbPath = '', native: string[] = [], nativeAnswer = true, n = 0, k = 0;
const sel: NetSelection = {binds: [], subnets: [], pin: 'pin-casa', label: 'Casa', source: 'subnet'};
async function setup(o: {pin?: boolean} = {}) {
  const dir = join(root, `t${++n}`); mkdirSync(join(dir, 'ui'), {recursive: true}); writeFileSync(join(dir, 'ui', 'remote.html'), '<!doctype html>');
  dbPath = join(dir, 'p.sqlite'); clock = new Date(2026, 10, 23, 10, 0, 0).getTime(); native = []; nativeAnswer = true;
  accts = [{id: 'acc-1', label: 'Principal', color: '#d4a65f', state: 'ready', suspended: false}, {id: 'acc-2', label: 'Farm', color: '#5fa8d4', state: 'ready', suspended: false}, {id: 'acc-3', label: 'Dorme', color: '#aaaaaa', state: 'suspended', suspended: true}];
  gold = {'acc-1': 10_000_000, 'acc-2': 10_000_000, 'acc-3': 5}; have = {'acc-1': {'Poke Ball': 10, Revive: 0}, 'acc-2': {}}; price = {'Poke Ball': 100, 'Great Ball': 1000, Revive: 500, 'Small Potion': 50, 'Master Ball': 9_999_999};
  reads = []; runs = []; calls = []; notices = []; hike = null; runGate = null; failRead = false; lite = false; failRun = false; runOverride = null; for (const key of Object.keys(readCount)) delete readCount[key];
  curDir = dir; hub = build();
  await hub.setEnabled(true); port = hub.status().port;
  if (o.pin !== false) await hub.setPin(PIN);
}
/** Reinicia o hub no mesmo banco (a memória some; o que vale vem do banco). */
async function reopen() { await hub.close(); hub = build(); await hub.setEnabled(true); port = hub.status().port; }
function build(): RemoteHub {
  const dir = curDir;
  return createRemoteHub({
    dbPath, dir: join(dir, 'remote'), uiDir: join(dir, 'ui'), iconPath: join(process.cwd(), 'build', 'icon.png'), net: async () => sel, portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000, now: () => clock, approveDelayMs: 0,
    api: {accounts: () => accts, hunt: async () => ({}), market: async () => ({}), diag: () => ({})}, running: () => 1, blocker: {start: () => 1, stop: () => undefined},
    nativeConfirm: async options => { native.push(options.title); return nativeAnswer; },
    actions: {shop, account, notify: (title, body) => { notices.push({title, body}); }},
  });
}
const teardown = async () => { await hub?.close(); };
function makeDevice(name = 'Pixel', canAct = true) {
  const id = randomUUID(), secret = randomBytes(32).toString('base64url');
  hub.store.addDevice({id, name, tokenHash: sha(secret), now: new Date(clock).toISOString(), nowMs: clock});
  if (canAct) hub.store.setCanAct(id, true);
  return {id, cookie: `${COOKIE}=${id}.${secret}`};
}
function call(path: string, o: {method?: string; cookie?: string; body?: unknown; headers?: Record<string, string>} = {}): Promise<Res> {
  const method = o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers: Record<string, string> = {Host: `127.0.0.1:${port}`, ...o.headers};
  if (o.cookie) headers.Cookie = o.cookie;
  if (method === 'GET') headers['X-PH'] = '1';
  if (method === 'POST') { headers.Origin = `https://127.0.0.1:${port}`; headers['Content-Type'] = 'application/json'; }
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path, method, headers, rejectUnauthorized: false}, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')})); });
    req.on('error', reject); req.end(o.body === undefined ? undefined : JSON.stringify(o.body));
  });
}
function sse(cookie: string) {
  return new Promise<{text: () => string; close: () => void; until: (needle: string) => Promise<void>}>((resolve, reject) => {
    let text = '';
    const req = request({host: '127.0.0.1', port, path: '/api/events', headers: {Host: `127.0.0.1:${port}`, Cookie: cookie}, rejectUnauthorized: false}, res => {
      res.on('data', c => { text += String(c); }); res.on('error', () => undefined);
      const until = async (needle: string) => { for (let i = 0; i < 100; i++) { if (text.includes(needle)) return; await new Promise(r => setTimeout(r, 20)); } throw new Error(`SSE sem "${needle}": ${text}`); };
      void until('event: state').then(() => resolve({text: () => text, close: () => req.destroy(), until}), reject);
    });
    req.on('error', reject); req.end();
  });
}
const rows = (sql: string, ...args: (string | number)[]) => { const db = new DatabaseSync(dbPath); try { return db.prepare(sql).all(...args) as Record<string, unknown>[]; } finally { db.close(); } };
const key = () => `chave-${++k}-${randomBytes(4).toString('hex')}`;
const manual = (cookie: string, lines: {cat: string; name: string; qty: number}[], profileIds = ['acc-1']) => call('/api/shop/plan', {cookie, body: {profileIds, mode: 'manual', lines}});
const BALLS = (qty: number) => [{cat: 'Pokebolas', name: 'Poke Ball', qty}];
const confirm = (cookie: string, p: {confirmId: string; planHash: string}, extra: {pin?: string; key?: string; planHash?: string} = {}) => call('/api/shop/confirm', {cookie, headers: {'Idempotency-Key': extra.key ?? key()}, body: {confirmId: p.confirmId, planHash: extra.planHash ?? p.planHash, ...(extra.pin !== undefined ? {pin: extra.pin} : {})}});
async function planned(cookie: string, qty = 10, profileIds = ['acc-1']) { const r = await manual(cookie, BALLS(qty), profileIds); expect(r.status, r.body).toBe(200); return json<ShopPlanReply>(r); }
const spentToday = (id = 'acc-1') => hub.store.spentToday(localDay(clock), id);
const auditActions = () => hub.audit().map(a => a.action);

describe('R4: migração v14', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('cria remote_confirms, remote_purchases e a coluna tz de remote_spend, sem destruir nada', () => {
    const db = new DatabaseSync(dbPath);
    try {
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 15});
      const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as {name: string}[]).map(c => c.name);
      expect(cols('remote_spend')).toEqual(['day', 'profile_id', 'gold', 'tz']);
      expect(cols('remote_confirms')).toEqual(['id', 'device_id', 'plan_hash', 'plan_json', 'created_at', 'expires_at', 'used', 'idem_key', 'result_json']);
      expect(cols('remote_purchases')).toEqual(['id', 'at', 'device_id', 'device_name', 'profile_id', 'confirm_id', 'plan_hash', 'item', 'qty', 'unit_price', 'total', 'result']);
      expect(cols('remote_devices')).toContain('can_act'); expect(cols('remote_push')).toContain('endpoint');
    } finally { db.close(); }
  });
});

describe('R4: permissões e travas comuns', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('sem autenticação: 401 em todas as rotas novas', async () => {
    for (const p of ['/api/shop/read', '/api/shop/plan', '/api/shop/confirm', '/api/elevate', '/api/lite', '/api/account/acc-1/reload']) expect((await call(p, {body: {}})).status, p).toBe(401);
  });
  it('sem can_act: 403 em Loja, elevação, conta e Modo leve (nada chega ao jogo)', async () => {
    const {cookie} = makeDevice('Sem permissão', false);
    for (const [p, body] of [['/api/shop/read', {profileIds: ['acc-1']}], ['/api/shop/plan', {profileIds: ['acc-1'], mode: 'manual', lines: BALLS(1)}], ['/api/elevate', {pin: PIN}], ['/api/lite', {on: true, pin: PIN}], ['/api/account/acc-1/reload', {pin: PIN}], ['/api/shop/confirm', {confirmId: 'a'.repeat(32), planHash: 'x'}]] as const) {
      const r = await call(p, {cookie, body, headers: {'Idempotency-Key': key()}}); expect(r.status, p).toBe(403); expect(json(r).code).toBe('sem_permissao');
    }
    expect(reads).toEqual([]); expect(runs).toEqual([]); expect(calls).toEqual([]);
  });
  it('tirar o "Pode agir" no PC derruba a elevação na hora', async () => {
    const {id, cookie} = makeDevice(); expect((await call('/api/elevate', {cookie, body: {pin: PIN}})).status).toBe(200);
    expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(200);
    await hub.setCanAct(id, false); expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(403);
    await hub.setCanAct(id, true); expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(403); expect(json((await call('/api/account/acc-1/reload', {cookie, body: {}}))).code).toBe('pin_necessario'); // religar não ressuscita a elevação
  });
  it('sem PIN definido no PC: as ações pedem para definir (403 sem_pin)', async () => {
    await teardown(); await setup({pin: false}); const {cookie} = makeDevice();
    const r = await call('/api/account/acc-1/reload', {cookie, body: {pin: PIN}}); expect(r.status).toBe(403); expect(json(r).code).toBe('sem_pin');
  });
  it('/api/me traz o estado das ações do aparelho (sem segredos)', async () => {
    const {cookie} = makeDevice(); const me = json<{actions: ActionsState; canAct: boolean}>(await call('/api/me', {cookie}));
    expect(me.actions).toEqual({canAct: true, pinSet: true, actionsDisabled: false, lockedMs: 0, elevatedMs: 0, dailyCapGold: 200_000, lite: false});
    await call('/api/elevate', {cookie, body: {pin: PIN}}); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions.elevatedMs).toBeGreaterThan(0);
  });
  it('POST: Origin errado → 403; sem JSON → 400; corpo grande → 413', async () => {
    const {cookie} = makeDevice();
    const raw = (o: {origin?: string; json?: boolean; body?: string}) => new Promise<number>((resolve, reject) => { const req = request({host: '127.0.0.1', port, path: '/api/elevate', method: 'POST', headers: {Host: `127.0.0.1:${port}`, Cookie: cookie, ...(o.origin ? {Origin: o.origin} : {}), ...(o.json === false ? {} : {'Content-Type': 'application/json'})}, rejectUnauthorized: false}, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); }); req.on('error', reject); req.end(o.body ?? '{}'); });
    expect(await raw({origin: 'https://evil.com'})).toBe(403); expect(await raw({})).toBe(403); expect(await raw({origin: `https://127.0.0.1:${port}`, json: false})).toBe(400); expect(await raw({origin: `https://127.0.0.1:${port}`, body: JSON.stringify({x: 'a'.repeat(9000)})})).toBe(413);
  });
});

describe('R4: Loja, leitura e plano (preços sempre do jogo)', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('read devolve só itens do catálogo, por conta, com rótulo (nunca e-mail)', async () => {
    const {cookie} = makeDevice(); const r = await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1', 'acc-2']}}); expect(r.status).toBe(200);
    const data = json<{accounts: {profileId: string; label: string; gold: number; items: {name: string}[]}[]}>(r);
    expect(data.accounts.map(a => [a.profileId, a.label])).toEqual([['acc-1', 'Principal'], ['acc-2', 'Farm']]); expect(data.accounts[0]!.items.map(i => i.name)).toEqual(['Poke Ball', 'Great Ball', 'Revive', 'Small Potion']); // Master Ball (fora do catálogo) não passa
    expect(r.body).not.toMatch(/email/i); expect(reads).toEqual(['acc-1', 'acc-2']);
  });
  it('read: conta que não lê volta com erro, sem derrubar as outras; conta desconhecida/duplicada/ids demais → 400', async () => {
    const {cookie} = makeDevice(); failRead = true;
    const r = json<{accounts: {error?: string; items: unknown[]}[]}>(await call('/api/shop/read', {cookie, body: {profileIds: ['acc-3']}})); expect(r.accounts[0]!.error).toContain('Market'); expect(r.accounts[0]!.items).toEqual([]);
    for (const ids of [['nope'], ['acc-1', 'acc-1'], [], 'acc-1', ['acc-1', 'acc-2', 'acc-3', 'x', 'y']]) expect((await call('/api/shop/read', {cookie, body: {profileIds: ids}})).status, JSON.stringify(ids)).toBe(400);
  });
  it('plan manual: relê os preços no jogo, calcula totais, ouro depois, teto e devolve confirmId de 128 bits + hash', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 100);
    expect(p.confirmId).toMatch(/^[0-9a-f]{32}$/); expect(p.planHash).toMatch(/^[0-9a-f]{64}$/); expect(p.expiresAt).toBe(clock + PLAN_TTL_MS); expect(reads).toEqual(['acc-1']);
    expect(p.plan.accounts[0]).toMatchObject({profileId: 'acc-1', label: 'Principal', goldBefore: 10_000_000, goldAfter: 9_990_000, total: 10_000, capRemaining: 200_000, capAfter: 190_000, executable: true});
    expect(p.plan.accounts[0]!.lines[0]).toMatchObject({name: 'Poke Ball', have: 10, qty: 100, unitPrice: 100, total: 10_000, fits: true}); expect(p.plan).toMatchObject({total: 10_000, needsPin: false, dailyCapGold: 200_000, mode: 'manual'});
    expect(p.planHash).toBe(planHashOf([{profileId: 'acc-1', label: 'x', lines: [{cat: 'Pokebolas', name: 'Poke Ball', qty: 100, unitPrice: 100, total: 10_000}]}]));
    const stored = rows('SELECT * FROM remote_confirms')[0]!; expect(stored).toMatchObject({id: p.confirmId, plan_hash: p.planHash, used: 0}); expect(JSON.stringify(stored)).not.toMatch(/email/i);
    expect(runs).toEqual([]); // plano não compra nada
  });
  it('o celular não consegue mandar preço nem total: campos extras são ignorados e o preço é o do jogo', async () => {
    const {cookie} = makeDevice(); const r = await call('/api/shop/plan', {cookie, body: {profileIds: ['acc-1'], mode: 'manual', lines: [{cat: 'Pokebolas', name: 'Poke Ball', qty: 10, unitPrice: 1, total: 10, price: 1}], total: 10}});
    expect(json<ShopPlanReply>(r).plan.accounts[0]!.lines[0]).toMatchObject({unitPrice: 100, total: 1000});
  });
  it('valida contra o catálogo: item fora dele (Master Ball), categoria errada, quantidade, repetido, modo e contas → 400', async () => {
    const {cookie} = makeDevice();
    for (const lines of [[{cat: 'Pokebolas', name: 'Master Ball', qty: 1}], [{cat: 'Revives', name: 'Poke Ball', qty: 1}], [{cat: 'Gemas', name: 'Gem', qty: 1}], BALLS(0), BALLS(10_000), BALLS(1.5), [...BALLS(1), ...BALLS(2)], [], 'x', Array.from({length: 13}, () => BALLS(1)[0])]) expect((await call('/api/shop/plan', {cookie, body: {profileIds: ['acc-1'], mode: 'manual', lines}})).status, JSON.stringify(lines)).toBe(400);
    for (const body of [{profileIds: ['acc-1'], mode: 'x', lines: BALLS(1)}, {profileIds: ['acc-9'], mode: 'manual', lines: BALLS(1)}, {mode: 'manual', lines: BALLS(1)}, {profileIds: ['acc-1'], mode: 'kit'}, {profileIds: ['acc-1'], mode: 'kit', kit: {name: 'K', lines: [{cat: 'Pokebolas', name: 'Poke Ball', target: 0}]}}]) expect((await call('/api/shop/plan', {cookie, body})).status, JSON.stringify(body)).toBe(400);
    expect(reads).toEqual([]);
  });
  it('kit: só repõe o que falta até a meta (usa o estoque lido no jogo)', async () => {
    const {cookie} = makeDevice(); const r = await call('/api/shop/plan', {cookie, body: {profileIds: ['acc-1', 'acc-2'], mode: 'kit', kit: {name: 'Farm', lines: [{cat: 'Pokebolas', name: 'Poke Ball', target: 50}, {cat: 'Revives', name: 'Revive', target: 5}]}}});
    const p = json<ShopPlanReply>(r); expect(r.status).toBe(200); expect(p.plan.kitName).toBe('Farm');
    expect(p.plan.accounts[0]!.lines.map(l => [l.name, l.qty])).toEqual([['Poke Ball', 40], ['Revive', 5]]); expect(p.plan.accounts[1]!.lines.map(l => [l.name, l.qty])).toEqual([['Poke Ball', 50], ['Revive', 5]]);
    expect(p.plan.total).toBe(40 * 100 + 5 * 500 + 50 * 100 + 5 * 500);
  });
  it('ouro insuficiente: a linha não "cabe" e a conta não é executável; sem nada executável → 422 sem confirmId', async () => {
    const {cookie} = makeDevice(); gold['acc-1'] = 1000;
    const r = await manual(cookie, BALLS(10)); expect(r.status).toBe(200); expect(json<ShopPlanReply>(r).plan.accounts[0]!.lines[0]!.fits).toBe(true);
    const bad = await manual(cookie, [{cat: 'Revives', name: 'Revive', qty: 10}]); expect(bad.status).toBe(422); expect(json(bad)).toMatchObject({code: 'nada_a_comprar'}); expect(json(bad).confirmId).toBeUndefined();
    expect(json<{plan: ShopPlanReply['plan']}>(bad).plan.accounts[0]).toMatchObject({executable: false, error: 'Ouro insuficiente.'});
  });
  it('teto diário: passar do que resta no dia (por conta) bloqueia a conta; as outras seguem', async () => {
    const {cookie} = makeDevice(); hub.store.reserveSpend(localDay(clock), 'acc-1', 190_000, 200_000, 'x');
    const r = await manual(cookie, BALLS(200), ['acc-1', 'acc-2']); const p = json<ShopPlanReply>(r); expect(r.status).toBe(200);
    expect(p.plan.accounts[0]).toMatchObject({profileId: 'acc-1', executable: false, capRemaining: 10_000}); expect(p.plan.accounts[0]!.error).toContain('teto diário'); expect(p.plan.accounts[1]).toMatchObject({executable: true});
  });
  it('um plano novo invalida o anterior do mesmo aparelho', async () => {
    const {cookie} = makeDevice(); const a = await planned(cookie, 10), b = await planned(cookie, 20);
    expect(json(await confirm(cookie, a, {pin: PIN})).code).toBe('ja_usada'); expect((await confirm(cookie, b, {pin: PIN})).status).toBe(200);
  });
  it('limite de leituras/planos: 10 por minuto por aparelho', async () => {
    const {cookie} = makeDevice(); for (let i = 0; i < 10; i++) expect((await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1']}})).status).toBe(200);
    expect((await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1']}})).status).toBe(429); clock += 61_000; expect((await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1']}})).status).toBe(200);
  });
});

describe('R4: confirmação (uso único, hash, validade, aparelho)', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('compra feliz: executa pelo shop.run com o preço do jogo, guarda histórico, audita e avisa o PC', async () => {
    const {id, cookie} = makeDevice('Pixel 8'); const p = await planned(cookie, 100); const r = await confirm(cookie, p, {pin: PIN}); expect(r.status, r.body).toBe(200);
    const out = json<ShopConfirmReply>(r); expect(out).toMatchObject({confirmId: p.confirmId, spent: 10_000}); expect(out.accounts[0]).toMatchObject({profileId: 'acc-1', status: 'ok', spent: 10_000});
    expect(runs).toHaveLength(1); expect(runs[0]![0]).toMatchObject({id: 'acc-1', lines: [{name: 'Poke Ball', qty: 100, unitPrice: 100, total: 10_000}]}); expect(spentToday()).toBe(10_000);
    expect(rows('SELECT * FROM remote_purchases')).toEqual([expect.objectContaining({device_id: id, device_name: 'Pixel 8', profile_id: 'acc-1', confirm_id: p.confirmId, plan_hash: p.planHash, item: 'Poke Ball', qty: 100, unit_price: 100, total: 10_000, result: 'ok'})]);
    expect(rows('SELECT used, idem_key FROM remote_confirms')[0]).toMatchObject({used: 1}); expect(auditActions()).toContain('compra_confirmada');
    expect(hub.audit().find(a => a.action === 'compra_confirmada')!.detail).toContain('100× Poke Ball'); expect(hub.purchases()[0]).toMatchObject({item: 'Poke Ball', total: 10_000, label: 'Principal', result: 'ok'});
    expect(notices).toHaveLength(1); expect(notices[0]!.body).toMatch(/^Compra feita pelo celular: Principal: 100× Poke Ball \(−10\.000 ouro\)/); expect(notices[0]!.body).not.toMatch(/email/i);
    expect(hub.spendToday().find(s => s.profileId === 'acc-1')).toMatchObject({gold: 10_000, capGold: 200_000});
  });
  it('confirmId reutilizado (replay) é rejeitado e não compra de novo', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie); expect((await confirm(cookie, p, {pin: PIN})).status).toBe(200);
    const again = await confirm(cookie, p, {pin: PIN}); expect(again.status).toBe(409); expect(json(again).code).toBe('ja_usada'); expect(runs).toHaveLength(1); expect(spentToday()).toBe(1000);
  });
  it('planHash diferente é rejeitado (e a confirmação é queimada)', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie);
    const r = await confirm(cookie, p, {pin: PIN, planHash: '0'.repeat(64)}); expect(r.status).toBe(409); expect(json(r).code).toBe('plano_alterado');
    expect(json(await confirm(cookie, p, {pin: PIN})).code).toBe('ja_usada'); expect(runs).toEqual([]); expect(spentToday()).toBe(0); expect(auditActions()).toContain('compra_hash_diferente');
    expect((await confirm(cookie, {confirmId: p.confirmId, planHash: 123 as unknown as string}, {pin: PIN})).status).toBe(400);
  });
  it('plano alterado direto no banco (adulterado) também é recusado: o servidor refaz o hash', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie);
    const db = new DatabaseSync(dbPath); const row = db.prepare('SELECT plan_json FROM remote_confirms WHERE id=?').get(p.confirmId) as {plan_json: string};
    db.prepare('UPDATE remote_confirms SET plan_json=? WHERE id=?').run(row.plan_json.replace('"qty":10,', '"qty":9999,'), p.confirmId); db.close();
    await reopen(); // sem o espelho em memória: força a leitura do banco adulterado
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(409); expect(json(r).code).toBe('plano_alterado'); expect(runs).toEqual([]); expect(spentToday()).toBe(0);
  });
  it('expirada (60 s) → 410 e nada acontece', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie); clock += PLAN_TTL_MS + 1;
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(410); expect(json(r).code).toBe('expirada'); expect(runs).toEqual([]);
  });
  it('de outro aparelho → 404 (igual a inexistente); o dono ainda consegue', async () => {
    const a = makeDevice('A'), b = makeDevice('B'); const p = await planned(a.cookie);
    expect((await confirm(b.cookie, p, {pin: PIN})).status).toBe(404); expect((await confirm(b.cookie, {confirmId: 'f'.repeat(32), planHash: p.planHash}, {pin: PIN})).status).toBe(404);
    expect((await confirm(a.cookie, p, {pin: PIN})).status).toBe(200); expect(runs).toHaveLength(1);
  });
  it('duas confirmações simultâneas do mesmo id: só UMA executa', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); runGate = new Promise(resolve => setTimeout(resolve, 80));
    const results = await Promise.all([confirm(cookie, p, {pin: PIN}), confirm(cookie, p, {pin: PIN}), confirm(cookie, p, {pin: PIN})]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409, 409]); expect(runs).toHaveLength(1); expect(spentToday()).toBe(1000); expect(rows('SELECT * FROM remote_purchases')).toHaveLength(1);
  });
  it('dois planos diferentes simultâneos que estourariam o teto: um é recusado (reserva atômica)', async () => {
    await hub.setDailyCap(100_000); const a = makeDevice('A'), b = makeDevice('B');
    const pa = await planned(a.cookie, 700), pb = await planned(b.cookie, 700); // cada um = 70.000 (cabe sozinho); 140.000 juntos
    runGate = new Promise(resolve => setTimeout(resolve, 80));
    const [ra, rb] = await Promise.all([confirm(a.cookie, pa, {pin: PIN}), confirm(b.cookie, pb, {pin: PIN})]);
    const statuses = [ra.status, rb.status].sort(); expect(statuses).toEqual([200, 409]); expect(runs).toHaveLength(1); expect(spentToday()).toBe(70_000);
    const loser = json<{error: string; accounts: {error?: string}[]}>(ra.status === 409 ? ra : rb); expect(loser.accounts[0]!.error).toContain('teto diário'); expect(auditActions()).toContain('compra_recusada_teto');
  });
  it('preço subiu entre o plano e a confirmação: aborta a conta ("preço mudou"), nada é comprado e a reserva do teto é devolvida', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 100); hike = {name: 'Poke Ball', to: 150, after: 1};
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(409); const out = json<{code: string; error: string; accounts: {status: string; error: string}[]}>(r);
    expect(out.code).toBe('compra_abortada'); expect(out.accounts[0]).toMatchObject({status: 'abortada'}); expect(out.accounts[0]!.error).toContain('Preço mudou'); expect(out.error).toContain('Preço mudou');
    expect(runs).toEqual([]); expect(spentToday()).toBe(0); expect(auditActions()).toContain('compra_preco_mudou');
    expect(rows('SELECT result, total FROM remote_purchases')).toEqual([{result: expect.stringContaining('abortada: Preço mudou'), total: 0}]); expect(notices[0]!.body).toContain('Nada foi comprado');
  });
  it('preço caiu: compra pelo preço novo (nunca acima do plano); a sobra da reserva volta', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 100); price['Poke Ball'] = 80;
    expect((await confirm(cookie, p, {pin: PIN})).status).toBe(200); expect(runs[0]![0]!.lines[0]).toMatchObject({unitPrice: 80, total: 8000}); expect(spentToday()).toBe(8000);
  });
  it('só uma das contas sobe de preço: a outra compra normalmente', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10, ['acc-1', 'acc-2']); hike = {name: 'Poke Ball', to: 200, after: 1, id: 'acc-1'};
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(200); const out = json<ShopConfirmReply>(r);
    expect(out.accounts.map(a => [a.profileId, a.status])).toEqual([['acc-1', 'abortada'], ['acc-2', 'ok']]); expect(runs[0]!.map(e => e.id)).toEqual(['acc-2']); expect(spentToday('acc-1')).toBe(0); expect(spentToday('acc-2')).toBe(1000);
  });
  it('a execução falhou (loja ocupada): tudo abortado e o teto devolvido', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); failRun = true;
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(409); expect(runs).toHaveLength(1); expect(spentToday()).toBe(0); expect(json<{accounts: {status: string}[]}>(r).accounts[0]!.status).toBe('abortada');
  });
  it('chave de repetição (Idempotency-Key): repetir devolve o mesmo resultado sem comprar de novo; reaproveitar em outra compra → 409; sem chave → 400', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10), k1 = key();
    const first = await confirm(cookie, p, {pin: PIN, key: k1}); expect(first.status).toBe(200);
    const replay = await confirm(cookie, p, {pin: PIN, key: k1}); expect(replay.status).toBe(200); expect(json(replay)).toMatchObject({...json(first), repetida: true}); expect(runs).toHaveLength(1); expect(spentToday()).toBe(1000);
    const q = await planned(cookie, 10); expect((await confirm(cookie, q, {pin: PIN, key: k1})).status).toBe(409); expect(runs).toHaveLength(1);
    expect((await call('/api/shop/confirm', {cookie, body: {confirmId: q.confirmId, planHash: q.planHash, pin: PIN}})).status).toBe(400);
    expect((await call('/api/shop/confirm', {cookie, headers: {'Idempotency-Key': 'curta'}, body: {confirmId: q.confirmId, planHash: q.planHash, pin: PIN}})).status).toBe(400);
  });
  it('a mesma chave simultânea (duas requisições juntas) executa uma só vez e as duas recebem o resultado', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10), k1 = key(); runGate = new Promise(resolve => setTimeout(resolve, 60));
    const [a, b] = await Promise.all([confirm(cookie, p, {pin: PIN, key: k1}), confirm(cookie, p, {pin: PIN, key: k1})]); expect([a.status, b.status]).toEqual([200, 200]); expect(runs).toHaveLength(1); expect(a.body).toBe(b.body);
  });
  it('a repetição vale mesmo depois de reiniciar o hub (resultado no banco)', async () => {
    const {id, cookie} = makeDevice(); const p = await planned(cookie, 10), k1 = key(); const first = json(await confirm(cookie, p, {pin: PIN, key: k1}));
    const store = new RemoteStore(dbPath); const prior = store.findIdem(id, k1); expect(prior).toMatchObject({id: p.confirmId, used: true}); expect(JSON.parse(prior!.resultJson!).body).toMatchObject({confirmId: first.confirmId, spent: 1000}); store.close();
  });
  it('progresso ao vivo por SSE (evento shop) só para o aparelho que confirmou', async () => {
    const a = makeDevice('A'), b = makeDevice('B'); const sa = await sse(a.cookie), sb = await sse(b.cookie);
    const p = await planned(a.cookie, 10); await confirm(a.cookie, p, {pin: PIN}); await sa.until('"kind":"done"');
    expect(sa.text()).toContain('event: shop'); expect(sa.text()).toContain('"kind":"start"'); expect(sa.text()).toContain('"status":"buying"'); expect(sa.text()).toContain('"status":"ok"'); expect(sa.text()).not.toMatch(/email/i);
    await new Promise(r => setTimeout(r, 50)); expect(sb.text()).not.toContain('event: shop'); sa.close(); sb.close();
  });
});

describe('R4: PIN no servidor, bloqueio escalonado e elevação', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('sem PIN e sem elevação: 403 pin_necessario (e a confirmação NÃO é queimada); PIN errado conta tentativa; o certo passa', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie);
    const none = await confirm(cookie, p); expect(none.status).toBe(403); expect(json(none).code).toBe('pin_necessario');
    const wrong = await confirm(cookie, p, {pin: '111111'}); expect(wrong.status).toBe(403); expect(json(wrong)).toMatchObject({code: 'pin_errado', attemptsLeft: 4}); expect(runs).toEqual([]);
    expect((await confirm(cookie, p, {pin: PIN})).status).toBe(200);
  });
  it('5 PINs errados bloqueiam (423 + Retry-After) e nem o certo passa; derruba a elevação; some depois de 15 min', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}}); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions.elevatedMs).toBeGreaterThan(0);
    const p = json<ShopPlanReply>(await manual(cookie, [{cat: 'Pokebolas', name: 'Great Ball', qty: 101}])); // acima de 50% do teto: o PIN é conferido mesmo elevado
    for (let i = 0; i < 4; i++) expect(json(await confirm(cookie, p, {pin: '000000'})).code).toBe('pin_errado');
    const fifth = await confirm(cookie, p, {pin: '000000'}); expect(fifth.status).toBe(423); expect(json(fifth).code).toBe('pin_bloqueado'); expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(800);
    expect((await confirm(cookie, p, {pin: PIN})).status).toBe(423); expect((await call('/api/elevate', {cookie, body: {pin: PIN}})).status).toBe(423); expect((await call('/api/account/acc-1/reload', {cookie, body: {pin: PIN}})).status).toBe(423);
    expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions).toMatchObject({lockedMs: expect.any(Number), elevatedMs: 0}); expect(auditActions()).toContain('pin_bloqueado'); expect(runs).toEqual([]);
    clock += 15 * 60_000 + 1000; const q = await planned(cookie, 10); expect((await confirm(cookie, q, {pin: PIN})).status).toBe(200);
    expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions.lockedMs).toBe(0);
  });
  it('o ciclo seguinte de erros escala (1 h) e o último revoga o aparelho (401 depois)', async () => {
    const {id, cookie} = makeDevice(); const wrongs = async (n: number) => { let last: Res | null = null; for (let i = 0; i < n; i++) last = await call('/api/account/acc-1/reload', {cookie, body: {pin: '000000'}}); return last!; };
    const newDay = () => { hub.store.clearPinState('*'); hub.store.setActionsDisabled(false); }; // o limite de 10 erros por dia (todos os aparelhos) tem teste próprio
    await wrongs(5); newDay(); clock += 15 * 60_000 + 1; const second = await wrongs(5); expect(second.status).toBe(423); expect(Number(second.headers['retry-after'])).toBeGreaterThan(3500);
    newDay(); clock += 3_600_000 + 1; expect((await wrongs(4)).status).toBe(403); const third = await wrongs(1); expect(third.status).toBe(423); expect(Number(third.headers['retry-after'])).toBeGreaterThan(80_000); newDay(); clock += 24 * 3_600_000 + 1; const last = await wrongs(5);
    expect(last.status).toBe(401); expect(hub.store.getDevice(id)).toBeNull(); expect((await call('/api/me', {cookie})).status).toBe(401); expect(runs).toEqual([]);
  });
  it('10 erros no dia (todos os aparelhos) desligam as ações pelo celular até religar no PC', async () => {
    const a = makeDevice('A'), b = makeDevice('B'), c = makeDevice('C'); const bad = (d: {cookie: string}) => call('/api/elevate', {cookie: d.cookie, body: {pin: '000000'}});
    for (let i = 0; i < 4; i++) { await bad(a); await bad(b); } await bad(a); await bad(b); // 10 erros no total (cada aparelho: 5, então os dois ficam bloqueados)
    const off = await call('/api/account/acc-1/reload', {cookie: c.cookie, body: {pin: PIN}}); expect(off.status).toBe(423); expect(json(off).code).toBe('acoes_desligadas'); expect(auditActions()).toContain('acoes_desligadas');
    expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: c.cookie})).actions.actionsDisabled).toBe(true);
    hub.reenableActions(); expect((await call('/api/account/acc-1/reload', {cookie: c.cookie, body: {pin: PIN}})).status).toBe(200);
  });
  it('elevação: PIN certo vale 10 min no servidor; compra pequena e ações dispensam o PIN; não renova sozinha; expira', async () => {
    const {cookie} = makeDevice(); const e = await call('/api/elevate', {cookie, body: {pin: PIN}}); expect(e.status).toBe(200); expect(json(e)).toMatchObject({ok: true, elevatedMs: ELEVATION_MS});
    const p = await planned(cookie, 10); expect(p.elevated).toBe(true); expect((await confirm(cookie, p)).status).toBe(200); // sem PIN
    clock += 5 * 60_000; expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(200); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions.elevatedMs).toBeLessThan(5 * 60_000 + 1);
    clock += 5 * 60_000 + 1; const late = await call('/api/account/acc-1/reload', {cookie, body: {}}); expect(late.status).toBe(403); expect(json(late).code).toBe('pin_necessario'); // usar não renovou
    expect((await call('/api/account/acc-1/reload', {cookie, body: {pin: PIN}})).status).toBe(200);
  });
  it('elevar exige o PIN sempre (mesmo já elevado) e PIN errado derruba a elevação', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}}); expect((await call('/api/elevate', {cookie, body: {}})).status).toBe(403);
    expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(403); // a tentativa sem PIN acima já zerou
    await call('/api/elevate', {cookie, body: {pin: PIN}}); await call('/api/elevate', {cookie, body: {pin: '000000'}}); expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(403);
  });
  it('a elevação cai ao trocar/remover o PIN, revogar, desligar o acesso e aumentar o teto', async () => {
    const a = makeDevice('A'); await call('/api/elevate', {cookie: a.cookie, body: {pin: PIN}}); await hub.setPin('135790'); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: a.cookie})).actions.elevatedMs).toBe(0);
    await call('/api/elevate', {cookie: a.cookie, body: {pin: '135790'}}); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: a.cookie})).actions.elevatedMs).toBeGreaterThan(0);
    await hub.setDailyCap(300_000); expect(native).toContain('PokéHub — teto diário do celular'); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: a.cookie})).actions.elevatedMs).toBe(0); // aumentar derruba
    await call('/api/elevate', {cookie: a.cookie, body: {pin: '135790'}}); await hub.setDailyCap(250_000); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: a.cookie})).actions.elevatedMs).toBeGreaterThan(0); // diminuir não
    hub.revoke(a.id); expect((await call('/api/me', {cookie: a.cookie})).status).toBe(401);
    const b = makeDevice('B'); await call('/api/elevate', {cookie: b.cookie, body: {pin: '135790'}}); hub.clearPin(); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: b.cookie})).actions.elevatedMs).toBe(0);
    await hub.setPin(PIN); await call('/api/elevate', {cookie: b.cookie, body: {pin: PIN}}); await hub.setEnabled(false); await hub.setEnabled(true); port = hub.status().port;
    expect(json<{actions: ActionsState}>(await call('/api/me', {cookie: b.cookie})).actions.elevatedMs).toBe(0); // desligar/religar (ou mudar de rede) zera
  });
  it('compra acima de 50% do teto restante exige PIN MESMO elevado; abaixo, não', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}});
    const big = await manual(cookie, [{cat: 'Pokebolas', name: 'Great Ball', qty: 101}]); const pb = json<ShopPlanReply>(big); expect(pb.plan.total).toBe(101_000); expect(pb.plan.needsPin).toBe(true);
    const no = await confirm(cookie, pb); expect(no.status).toBe(403); expect(json(no)).toMatchObject({code: 'pin_necessario', force: true}); expect(runs).toEqual([]);
    expect((await confirm(cookie, pb, {pin: PIN})).status).toBe(200);
    await call('/api/elevate', {cookie, body: {pin: PIN}}); // nova elevação: o gasto da elevação recomeça do zero
    const small = await manual(cookie, [{cat: 'Pokebolas', name: 'Great Ball', qty: 40}]); const ps = json<ShopPlanReply>(small); expect(ps.plan.needsPin).toBe(false); // 40.000 de 200.000 (teto diário) é menos que 50%
    expect((await confirm(cookie, ps)).status).toBe(200);
  });
});

describe('R4: ações de conta e Modo leve', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('recarregar/suspender/retomar com PIN: executa, audita e avisa o PC; estado inválido → 409', async () => {
    const {cookie} = makeDevice('Pixel');
    expect((await call('/api/account/acc-1/reload', {cookie, body: {pin: PIN}})).status).toBe(200); expect((await call('/api/account/acc-2/suspend', {cookie, body: {pin: PIN}})).status).toBe(200); expect((await call('/api/account/acc-2/resume', {cookie, body: {pin: PIN}})).status).toBe(200);
    expect(calls).toEqual(['reload:acc-1', 'suspend:acc-2', 'resume:acc-2']); expect(auditActions()).toEqual(expect.arrayContaining(['acao_recarregar', 'acao_suspender', 'acao_retomar']));
    expect(notices.map(x => x.body)).toEqual(['Recarregar Principal (pedido de “Pixel”).', 'Suspender Farm (pedido de “Pixel”).', 'Retomar Farm (pedido de “Pixel”).']);
    expect(json(await call('/api/account/acc-1/resume', {cookie, body: {pin: PIN}})).code).toBe('estado'); expect((await call('/api/account/acc-3/suspend', {cookie, body: {pin: PIN}})).status).toBe(409); expect((await call('/api/account/acc-3/reload', {cookie, body: {pin: PIN}})).status).toBe(409);
    expect((await call('/api/account/nope/reload', {cookie, body: {pin: PIN}})).status).toBe(404); expect(calls).toHaveLength(3);
  });
  it('sem PIN nem elevação: 403 pin_necessario e nada acontece', async () => {
    const {cookie} = makeDevice(); const r = await call('/api/account/acc-1/reload', {cookie, body: {}}); expect(r.status).toBe(403); expect(json(r).code).toBe('pin_necessario'); expect(calls).toEqual([]);
  });
  it('Modo leve: liga/desliga com PIN, valida o corpo, audita e avisa', async () => {
    const {cookie} = makeDevice(); expect((await call('/api/lite', {cookie, body: {on: 'sim', pin: PIN}})).status).toBe(400); expect((await call('/api/lite', {cookie, body: {on: true}})).status).toBe(403);
    expect((await call('/api/lite', {cookie, body: {on: true, pin: PIN}})).status).toBe(200); expect(lite).toBe(true); expect(json<{actions: ActionsState}>(await call('/api/me', {cookie})).actions.lite).toBe(true);
    expect((await call('/api/lite', {cookie, body: {on: false, pin: PIN}})).status).toBe(200); expect(lite).toBe(false); expect(auditActions()).toContain('modo_leve'); expect(notices.at(-1)!.body).toContain('Modo leve desligado');
  });
  it('limite de 5 ações por minuto por aparelho (429); volta depois de 1 min', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}});
    for (let i = 0; i < 5; i++) expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(200);
    const six = await call('/api/account/acc-1/reload', {cookie, body: {}}); expect(six.status).toBe(429); expect(calls).toHaveLength(5); expect((await call('/api/lite', {cookie, body: {on: true}})).status).toBe(429);
    clock += 61_000; await call('/api/elevate', {cookie, body: {pin: PIN}}); expect((await call('/api/account/acc-1/reload', {cookie, body: {}})).status).toBe(200);
  });
  it('o limite é por aparelho: outro aparelho não é afetado', async () => {
    const a = makeDevice('A'), b = makeDevice('B'); for (const c of [a, b]) await call('/api/elevate', {cookie: c.cookie, body: {pin: PIN}});
    for (let i = 0; i < 5; i++) await call('/api/account/acc-1/reload', {cookie: a.cookie, body: {}}); expect((await call('/api/account/acc-1/reload', {cookie: a.cookie, body: {}})).status).toBe(429); expect((await call('/api/account/acc-1/reload', {cookie: b.cookie, body: {}})).status).toBe(200);
  });
});

describe('R4: nada de compra no Mercado da Comunidade (RMT) e nada de e-mail', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('não existe rota de compra de RMT/Comunidade/mercado (404) e GET /api/market continua só leitura', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}});
    for (const p of ['/api/rmt/buy', '/api/rmt/comprar', '/api/market/buy', '/api/market/acc-1/buy', '/api/market/acc-1', '/api/community/buy', '/api/comunidade/comprar', '/api/shop/buy', '/api/shop/rmt', '/api/market/comprar']) expect((await call(p, {cookie, body: {pin: PIN, id: 1}})).status, p).toBe(404);
  });
  it('o código das ações não contém seletor, URL nem texto de compra no Mercado da Comunidade', () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    const files = ['spike/remote/actions.ts', 'spike/remote/hub.ts'].map(f => strip(readFileSync(f, 'utf8')));
    const server = readFileSync('spike/remote/server.ts', 'utf8'), block = strip(server.slice(server.indexOf('const ACTION_POST'), server.indexOf('async function route')));
    for (const code of [...files, block]) expect(code).not.toMatch(/rmt|comunidade|community|gema|\bgems?\b|\borb\b|dinheiro real|pokeidle/i);
    for (const code of [files[0]!, block]) expect(code).not.toMatch(/\.click\(|querySelector|executeJavaScript|https?:\/\//i); // as ações não tocam no jogo nem na rede: só chamam o hub
    expect(files[0]).not.toMatch(/\bfetch\s*\(/);
  });
  it('nenhuma resposta, SSE ou linha de banco das ações carrega emailLabel/e-mail', async () => {
    const {cookie} = makeDevice('Pixel'); const s = await sse(cookie); const bodies: string[] = [];
    await call('/api/elevate', {cookie, body: {pin: PIN}});
    bodies.push((await call('/api/me', {cookie})).body, (await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1', 'acc-2']}})).body);
    const pr = await manual(cookie, BALLS(10), ['acc-1', 'acc-2']); bodies.push(pr.body); const p = json<ShopPlanReply>(pr);
    bodies.push((await confirm(cookie, p)).body, (await call('/api/account/acc-1/reload', {cookie, body: {}})).body); await s.until('"kind":"done"');
    for (const b of [...bodies, s.text(), JSON.stringify(rows('SELECT * FROM remote_purchases')), JSON.stringify(rows('SELECT * FROM remote_confirms')), JSON.stringify(hub.audit()), JSON.stringify(hub.purchases()), JSON.stringify(notices)]) { expect(b).not.toMatch(/emailLabel|e-mail|@exemplo|@gmail/i); }
    s.close();
  });
});

describe('R4: push da compra e canônico', () => {
  it('o motor manda push "acao" aos aparelhos com notificações, sem dados sensíveis (payload ≤ 1 KB, url #alertas)', async () => {
    const store = new RemoteStore(join(root, `e${++n}.sqlite`)); const sent: string[] = [];
    store.addDevice({id: 'd1', name: 'A', tokenHash: 'h', now: new Date().toISOString()}); store.addPush('d1', {endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a'}, 'p1', new Date().toISOString());
    const fake = {publicKey: 'x', regenerated: false, send: async (_sub: PushSub, body: string): Promise<'ok'> => { sent.push(body); return 'ok'; }} as unknown as Push;
    const engine = createAlertEngine({store, push: () => fake, captures: {subscribe: () => () => undefined, list: () => []}, profiles: () => [], running: () => false, streams: () => 0, publish: () => undefined});
    expect(await engine.notifyAction('Compra pelo celular', 'Principal: 100× Poke Ball (−10.000 ouro)')).toBe(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({kind: 'acao', label: 'Compra pelo celular', url: '#alertas'}); expect(sent[0]).not.toMatch(/email|pin|token/i); engine.close(); store.close();
  });
  it('o JSON canônico do plano é estável (ordem das contas) e o hash muda com qualquer item, quantidade ou preço', () => {
    const line = (qty: number, unitPrice = 100) => ({cat: 'Pokebolas' as const, name: 'Poke Ball', qty, unitPrice, total: qty * unitPrice}), acc = (profileId: string, qty: number, price?: number) => ({profileId, label: profileId, lines: [line(qty, price)]});
    expect(canonicalPlan([acc('b', 1), acc('a', 1)])).toBe(canonicalPlan([acc('a', 1), acc('b', 1)])); expect(planHashOf([acc('a', 1)])).not.toBe(planHashOf([acc('a', 2)])); expect(planHashOf([acc('a', 1)])).not.toBe(planHashOf([acc('a', 1, 101)])); expect(planHashOf([acc('a', 1)])).not.toBe(planHashOf([acc('b', 1)]));
  });
});

describe('R4: teto diário no PC', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('só se edita no PC: validação, confirmação nativa ao aumentar (recusar mantém), audita; histórico mostra as últimas 50', async () => {
    expect(hub.status().dailyCapGold).toBe(200_000);
    await expect(hub.setDailyCap(-1)).rejects.toThrow(); await expect(hub.setDailyCap(1.5)).rejects.toThrow(); await expect(hub.setDailyCap('1000')).rejects.toThrow(); await expect(hub.setDailyCap(2e9)).rejects.toThrow();
    await hub.setDailyCap(150_000); expect(native).toEqual([]); expect(hub.status().dailyCapGold).toBe(150_000);
    nativeAnswer = false; await hub.setDailyCap(400_000); expect(native).toHaveLength(1); expect(hub.status().dailyCapGold).toBe(150_000);
    nativeAnswer = true; await hub.setDailyCap(400_000); expect(hub.status().dailyCapGold).toBe(400_000); expect(auditActions()).toContain('teto_diario');
    const {cookie} = makeDevice(); expect((await call('/api/cap', {cookie, body: {gold: 9_999_999}})).status).toBe(404); expect((await call('/api/me', {cookie, body: {dailyCapGold: 1}})).status).toBe(404); // o celular não edita o teto
    for (let i = 0; i < 60; i++) hub.store.addPurchase({at: new Date(clock + i).toISOString(), deviceId: null, deviceName: 'X', profileId: 'acc-1', confirmId: null, planHash: null, item: `i${i}`, qty: 1, unitPrice: 1, total: 1, result: 'ok'});
    expect(hub.purchases()).toHaveLength(50); expect(hub.purchases()[0]!.item).toBe('i59'); expect(hub.store.countPurchases()).toBe(60); // a tabela não é podada
  });
  it('o dia do teto é o dia LOCAL: virar o dia zera o gasto; reserva/devolução nunca ficam negativas', () => {
    const day = localDay(clock), next = localDay(clock + 24 * 3_600_000); expect(day).not.toBe(next);
    expect(hub.store.reserveSpend(day, 'acc-1', 150_000, 200_000, 'America/Sao_Paulo')).toBe(true); expect(hub.store.reserveSpend(day, 'acc-1', 60_000, 200_000, 'America/Sao_Paulo')).toBe(false); expect(hub.store.spentToday(next, 'acc-1')).toBe(0);
    hub.store.releaseSpend(day, 'acc-1', 999_999); expect(hub.store.spentToday(day, 'acc-1')).toBe(0); expect(rows('SELECT tz FROM remote_spend')[0]).toEqual({tz: 'America/Sao_Paulo'});
  });
});

describe('R4: contagem do teto (autorizada) e elevação', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('linha ok com spent 0 (delta de ouro do jogo ocioso): o dia soma quantidade × preço', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); runOverride = () => ({ok: true, code: 'ok', bought: 10, spent: 0});
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status, r.body).toBe(200); expect(json<ShopConfirmReply>(r).spent).toBe(1000); expect(spentToday()).toBe(1000);
    expect(rows('SELECT total, result FROM remote_purchases')).toEqual([{total: 1000, result: 'ok'}]);
  });
  it('comprou menos que o pedido: conta só o medido (limitado à quantidade)', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); runOverride = () => ({ok: true, code: 'ok', bought: 4, spent: 99_999});
    expect(json<ShopConfirmReply>(await confirm(cookie, p, {pin: PIN})).spent).toBe(400); expect(spentToday()).toBe(400);
  });
  it('não confirmada: a reserva FICA e o histórico diz "não confirmada (reservado)"', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); runOverride = () => ({ok: false, code: 'unconfirmed', error: 'O jogo não confirmou a compra.'});
    const r = await confirm(cookie, p, {pin: PIN}); expect(r.status).toBe(409); expect(spentToday()).toBe(1000);
    expect(rows('SELECT total, result FROM remote_purchases')).toEqual([{total: 1000, result: 'não confirmada (reservado)'}]);
  });
  it('preço mudou antes do clique: a reserva é devolvida', async () => {
    const {cookie} = makeDevice(); const p = await planned(cookie, 10); runOverride = () => ({ok: false, code: 'price', error: 'O preço mudou; compra cancelada.'});
    expect((await confirm(cookie, p, {pin: PIN})).status).toBe(409); expect(spentToday()).toBe(0);
    expect(rows('SELECT result FROM remote_purchases')[0]!.result).toMatch(/^erro:/);
  });
  it('B-8: compras fatiadas na mesma elevação passam de 50% do teto diário e pedem o PIN', async () => {
    const {cookie} = makeDevice(); await call('/api/elevate', {cookie, body: {pin: PIN}});
    const slice = async () => json<ShopPlanReply>(await manual(cookie, [{cat: 'Pokebolas', name: 'Great Ball', qty: 40}])); // 40.000 de 200.000
    const a = await slice(); expect(a.plan.needsPin).toBe(false); expect((await confirm(cookie, a)).status).toBe(200);
    const b = await slice(); expect(b.plan.needsPin).toBe(false); expect((await confirm(cookie, b)).status).toBe(200); // 80.000 acumulados
    const c = await slice(); expect(c.plan.needsPin).toBe(true); // 80.000 + 40.000 > 100.000
    const no = await confirm(cookie, c); expect(no.status).toBe(403); expect(json(no)).toMatchObject({code: 'pin_necessario', force: true});
    expect((await confirm(cookie, c, {pin: PIN})).status).toBe(200);
    await call('/api/elevate', {cookie, body: {pin: PIN}}); expect(json<ShopPlanReply>(await manual(cookie, [{cat: 'Pokebolas', name: 'Great Ball', qty: 40}])).plan.needsPin).toBe(false); // nova elevação zera o acumulado
  });
  it('auditoria: leitura e plano da Loja viram linhas', async () => {
    const {cookie} = makeDevice(); await call('/api/shop/read', {cookie, body: {profileIds: ['acc-1']}}); await planned(cookie, 1);
    expect(auditActions()).toEqual(expect.arrayContaining(['loja_leitura', 'loja_plano']));
  });
});
