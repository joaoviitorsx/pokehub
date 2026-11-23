import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteHub, type HubDeps, type RemoteHub } from '../remote/hub';
import { registerRemoteIpc } from '../remote/ipc';
import { COOKIE, COOKIE_MAX_AGE, createRemoteServer, ROTATE_MS, type RemoteServer } from '../remote/server';
import { Pairing } from '../remote/guards';
import { RemoteStore } from '../remote/store';
import { createCa, createLeaf } from '../remote/certs';
import type { NetSelection } from '../remote/ip';

const root = mkdtempSync(join(tmpdir(), 'pokehub-remote-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));
let n = 0;
interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
const accounts = [{id: 'acc-1', label: 'Principal', color: '#d4a65f', state: 'ready', suspended: false}];
let nativeAnswer = true, decision: boolean | 'hold' = true, hub: RemoteHub, port = 0, dbPath = '', requests = 0, clock = Date.now(), huntCalls = 0, huntDelay = 0;
let sel: NetSelection = {binds: [], subnets: [], pin: 'pin-casa', label: 'Casa', source: 'subnet'};
const native: Parameters<NonNullable<HubDeps['nativeConfirm']>>[0][] = [];
const blockerCalls: string[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const LOOP = {address: '127.0.0.1', netmask: '255.255.255.0', name: 'eth0'};

interface Opts extends Partial<HubDeps> { native?: boolean | null }
function makeHub(path: string, dir: string, o: Opts = {}): RemoteHub {
  const {native: nat, ...rest} = o;
  return createRemoteHub({
    dbPath: path, dir: join(dir, 'remote'), uiDir: join(dir, 'ui'), iconPath: join(process.cwd(), 'build', 'icon.png'), net: async () => sel, portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000, now: () => clock, approveDelayMs: 0,
    api: {accounts: () => accounts, hunt: async id => { huntCalls++; if (huntDelay) await sleep(huntDelay); return {estado: 'ok', id}; }, market: async (id, foco) => ({estado: 'ok', id, foco}), diag: () => ({accounts: [], host: {totalKb: 1, freeKb: 1}})},
    running: () => 1, blocker: {start: type => { blockerCalls.push(`start:${type}`); return 7; }, stop: () => { blockerCalls.push('stop'); }},
    nativeConfirm: nat === null ? undefined : async options => { native.push(options); return nat ?? nativeAnswer; },
    onPairRequest: () => { requests++; const d = decision; if (d !== 'hold') queueMicrotask(() => void hub.decide(d).catch(() => undefined)); },
    ...rest,
  });
}
async function setup(enabled = true, o: Opts = {}) {
  const dir = join(root, `t${++n}`); mkdirSync(join(dir, 'ui'), {recursive: true});
  writeFileSync(join(dir, 'ui', 'remote.html'), '<!doctype html><title>x</title>'); writeFileSync(join(dir, 'ui', 'sw.js'), '//sw'); writeFileSync(join(dir, 'ui', 'manifest.webmanifest'), '{}');
  mkdirSync(join(dir, 'ui', 'assets')); writeFileSync(join(dir, 'ui', 'assets', 'a-1.js'), 'x');
  dbPath = join(dir, 'p.sqlite'); requests = 0; clock = Date.now(); huntCalls = 0; huntDelay = 0; native.length = 0; decision = true; nativeAnswer = true;
  sel = {binds: [], subnets: [], pin: 'pin-casa', label: 'Casa', source: 'subnet'};
  hub = makeHub(dbPath, dir, o);
  if (enabled) { await hub.setEnabled(true); port = hub.status().port; }
}
const teardown = async () => { await hub?.close(); };
function call(path: string, o: {method?: string; headers?: Record<string, string>; body?: string | Buffer; host?: string; cookie?: string; origin?: string | null; json?: boolean; sw?: boolean; ph?: boolean} = {}): Promise<Res> {
  const method = o.method ?? 'GET';
  const headers: Record<string, string> = {Host: o.host ?? `127.0.0.1:${port}`, ...o.headers};
  if (o.cookie) headers.Cookie = o.cookie;
  if (path.startsWith('/api/pair') && o.sw !== false) headers['X-PH-SW'] = '1'; // o service worker do celular acrescenta isto
  if (/^\/api\/(hunt|market)\//.test(path) && o.ph !== false) headers['X-PH'] = '1';
  if (method === 'POST') { if (o.origin !== null) headers.Origin = o.origin ?? `https://127.0.0.1:${port}`; if (o.json !== false) headers['Content-Type'] = 'application/json'; }
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path, method, headers, rejectUnauthorized: false}, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')})); });
    req.on('error', reject); req.end(o.body);
  });
}
const cookieOf = (res: Res) => String((res.headers['set-cookie'] as string[])[0]).split(';')[0]!;
const idOf = (cookie: string) => cookie.slice(COOKIE.length + 1).split('.')[0]!;
/** Passo 1 do celular: manda o código (o PC mostra o pedido) e recebe 202 com requestId e SAS. */
async function startPair(deviceName = 'Pixel · Chrome', code?: string, headers?: Record<string, string>) {
  if (code === undefined) { hub.startPairing(); code = hub.revealCode().pairing!.code; }
  const res = await call('/api/pair', {method: 'POST', body: JSON.stringify({code, deviceName}), headers});
  return {res, code, data: JSON.parse(res.body) as {requestId?: string; sas?: string; error?: string}};
}
async function waitPair(requestId: string): Promise<Res> {
  for (let i = 0; i < 6; i++) { const res = await call(`/api/pair/wait?id=${requestId}`); if (res.status !== 202) return res; }
  throw new Error('o pedido não terminou');
}
async function pairDevice(): Promise<string> {
  const {res, data} = await startPair();
  expect(res.status).toBe(202);
  const done = await waitPair(data.requestId!);
  expect(done.status).toBe(200);
  return cookieOf(done);
}

describe('servidor remoto: desligado por padrão', () => {
  beforeEach(() => setup(false)); afterEach(teardown);
  it('boot sem a preferência ligada não abre porta nem segura o sono', async () => {
    blockerCalls.length = 0;
    await hub.boot();
    expect(hub.isListening()).toBe(false); expect(hub.status()).toMatchObject({enabled: false, running: false, urls: []}); expect(blockerCalls).toEqual([]);
    expect(() => hub.startPairing()).toThrow();
  });
  it('ligar abre a porta; desligar fecha (conexão recusada) e solta o bloqueio de sono', async () => {
    blockerCalls.length = 0;
    await hub.setEnabled(true); const p = hub.status().port;
    expect(hub.isListening()).toBe(true); expect(blockerCalls).toContain('start:prevent-app-suspension');
    await hub.setEnabled(false);
    expect(hub.isListening()).toBe(false); expect(blockerCalls.at(-1)).toBe('stop');
    await expect(new Promise((resolve, reject) => { const s = connect(p, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve('aberta'); }); s.on('error', reject); })).rejects.toMatchObject({code: 'ECONNREFUSED'});
  });
  it('close() (sair do app) também fecha a porta e é idempotente', async () => {
    await hub.setEnabled(true); const p = hub.status().port;
    await hub.close(); await hub.close();
    await expect(new Promise((resolve, reject) => { const s = connect(p, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(1); }); s.on('error', reject); })).rejects.toMatchObject({code: 'ECONNREFUSED'});
  });
  it('o sono só é segurado com o servidor de fato escutando (falha ao abrir a porta não segura)', async () => {
    blockerCalls.length = 0;
    const failing = makeHub(join(root, 'fail.sqlite'), join(root, 'failx'), {serverFactory: () => ({listen: async () => { throw new Error('porta ocupada'); }, close: async () => undefined, listening: () => false} as unknown as RemoteServer)});
    await expect(failing.setEnabled(true)).rejects.toThrow(); expect(blockerCalls).toEqual([]); expect(failing.enabled()).toBe(false);
    await failing.close();
  });
});

describe('servidor remoto: filas e corridas (liga/desliga)', () => {
  let live = 0, delay = 80;
  const factory = (): RemoteServer => {
    let up = false;
    return {listen: async () => { await sleep(delay); up = true; live++; return 4242; }, close: async () => { if (up) { up = false; live--; } }, listening: () => up, publish: () => undefined, revoke: () => false, sweepExpired: () => 0, streamCount: () => 0, connectionCount: () => 0, pendingCount: () => 0} as unknown as RemoteServer;
  };
  const fresh = async () => { await setup(false, {serverFactory: factory}); live = 0; delay = 80; };
  beforeEach(fresh); afterEach(teardown);
  it('ligar e desligar na sequência (listen lento): nada fica escutando e o estado final é desligado', async () => {
    const a = hub.setEnabled(true), b = hub.setEnabled(false);
    await Promise.all([a, b]);
    expect(live).toBe(0); expect(hub.isListening()).toBe(false); expect(hub.enabled()).toBe(false);
  });
  it('ligar, desligar e ligar de novo: termina ligado com exatamente um servidor', async () => {
    const all = [hub.setEnabled(true), hub.setEnabled(false), hub.setEnabled(true)];
    await Promise.all(all);
    expect(live).toBe(1); expect(hub.isListening()).toBe(true); expect(hub.enabled()).toBe(true);
    await hub.setEnabled(false); expect(live).toBe(0);
  });
  it('fechar o hub durante o listen aborta e fecha o servidor que estava abrindo', async () => {
    const a = hub.setEnabled(true).catch(() => undefined);
    await sleep(10); await hub.close(); await a;
    expect(live).toBe(0);
  });
  it('várias chamadas ligar/desligar simultâneas nunca deixam mais de um servidor', async () => {
    const calls: Promise<void>[] = []; for (let i = 0; i < 6; i++) calls.push(hub.setEnabled(i % 2 === 0));
    await Promise.all(calls); expect(live).toBe(0);
  });
});

describe('servidor remoto: rede doméstica fixada', () => {
  beforeEach(async () => { await setup(false, {networkPollMs: 25}); sel = {binds: [LOOP], subnets: ['127.0.0.0/24'], pin: 'pin-casa', label: 'Casa', source: 'subnet'}; }); afterEach(teardown);
  it('ao ligar fixa a rede; se a rede muda, para de escutar (enabled=true, running=false, rede_nova) e NUNCA religa sozinho', async () => {
    await hub.setEnabled(true);
    expect(hub.status()).toMatchObject({enabled: true, running: true, network: {state: 'ok', label: 'Casa'}});
    sel = {...sel, pin: 'pin-cafe', label: 'Café'};
    for (let i = 0; i < 100 && hub.status().running; i++) await sleep(20);
    expect(hub.status()).toMatchObject({enabled: true, running: false, network: {state: 'rede_nova'}});
    await sleep(150); expect(hub.status().running).toBe(false); expect(hub.isListening()).toBe(false);
    expect(hub.audit().map(a => a.action)).toContain('rede_nova');
    sel = {...sel, pin: 'pin-casa', label: 'Casa'}; // voltou para a rede fixada: volta sozinho
    for (let i = 0; i < 100 && !hub.status().running; i++) await sleep(20);
    expect(hub.status()).toMatchObject({running: true, network: {state: 'ok'}});
  });
  it('liberar a rede nova pede confirmação nativa, fixa a nova e religa', async () => {
    await hub.setEnabled(true);
    sel = {...sel, pin: 'pin-cafe', label: 'Café'};
    for (let i = 0; i < 100 && hub.status().running; i++) await sleep(20);
    native.length = 0; await hub.allowNetwork();
    expect(native).toHaveLength(1); expect(native[0]!.message).toContain('Café');
    expect(hub.status()).toMatchObject({running: true, network: {state: 'ok', label: 'Café'}});
    expect(hub.audit().map(a => a.action)).toContain('rede_liberada');
  });
  it('sem interface privada elegível e sem porta de teste: não liga e explica', async () => {
    const strict = makeHub(join(root, 'strict.sqlite'), join(root, 'strictx'), {portOverride: undefined});
    sel = {binds: [], subnets: [], pin: '', label: '', source: 'windows', error: 'Não foi possível confirmar que a rede é Privada (PowerShell indisponível).'};
    await expect(strict.setEnabled(true)).rejects.toThrow('Privada'); expect(strict.isListening()).toBe(false); await strict.close();
  });
  it('o servidor recusa quem não está na sub-rede da interface (máscara /32 vs /8)', async () => {
    const dir = join(root, `sub${++n}`); mkdirSync(join(dir, 'ui'), {recursive: true}); writeFileSync(join(dir, 'ui', 'remote.html'), 'x');
    const store = new RemoteStore(join(dir, 'p.sqlite')), ca = createCa(Date.now(), ['127.0.0.0/24']), leaf = createLeaf(ca.cert, ca.key, ['127.0.0.2']);
    const mk = () => createRemoteServer({store, certs: () => ({caDer: ca.der, leafCert: leaf.cert, leafKey: leaf.key}), api: {accounts: () => [], hunt: async () => ({}), market: async () => ({}), diag: () => ({})}, pairing: new Pairing(), confirmPair: async () => false, uiDir: join(dir, 'ui'), iconPath: ''});
    const hit = (p: number) => new Promise<number>((resolve, reject) => { request({host: '127.0.0.2', port: p, path: '/', headers: {Host: `127.0.0.2:${p}`}, rejectUnauthorized: false}, res => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject).end(); });
    const strict = mk(), p1 = await strict.listen([{address: '127.0.0.2', netmask: '255.255.255.255', name: 'x'}], 0);
    await expect(hit(p1)).rejects.toThrow(); await strict.close(); // origem 127.0.0.1 ≠ 127.0.0.2/32
    const wide = mk(), p2 = await wide.listen([{address: '127.0.0.2', netmask: '255.0.0.0', name: 'x'}], 0);
    expect(await hit(p2)).toBe(200); await wide.close(); store.close();
  });
});

describe('servidor remoto: autenticação e cabeçalhos', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('/api/state sem cookie → 401 genérico, com cabeçalhos estritos e sem pokeidle.io no CSP', async () => {
    const res = await call('/api/state');
    expect(res.status).toBe(401); expect(JSON.parse(res.body)).toEqual({error: 'Não autorizado.'});
    expect(res.headers['content-security-policy']).toContain("default-src 'self'"); expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'"); expect(res.headers['content-security-policy']).not.toContain('pokeidle');
    expect(res.headers['x-frame-options']).toBe('DENY'); expect(res.headers['referrer-policy']).toBe('no-referrer'); expect(res.headers['x-content-type-options']).toBe('nosniff'); expect(res.headers['cache-control']).toBe('no-store');
    for (const p of ['/api/hunt/acc-1', '/api/market/acc-1', '/api/diag', '/api/me', '/api/events']) expect((await call(p)).status).toBe(401);
  });
  it('cookie inválido, de formato errado ou de aparelho revogado → 401', async () => {
    const cookie = await pairDevice();
    expect((await call('/api/state', {cookie})).status).toBe(200);
    const id = idOf(cookie);
    expect((await call('/api/state', {cookie: `${COOKIE}=${id}.${'A'.repeat(43)}`})).status).toBe(401); // segredo errado
    expect((await call('/api/state', {cookie: `${COOKIE}=lixo`})).status).toBe(401);
    expect(hub.revoke(id)).toBe(true);
    expect((await call('/api/state', {cookie})).status).toBe(401);
  });
  it('rotas autenticadas devolvem os dados, sem caminhos nem chaves', async () => {
    const cookie = await pairDevice();
    const state = await call('/api/state', {cookie}); expect(JSON.parse(state.body)).toEqual({accounts});
    expect(JSON.parse((await call('/api/hunt/acc-1', {cookie})).body)).toEqual({estado: 'ok', id: 'acc-1'});
    expect(JSON.parse((await call('/api/market/acc-1?foco=desconto', {cookie})).body)).toMatchObject({foco: 'desconto'});
    expect((await call('/api/hunt/outra', {cookie})).status).toBe(404);
    expect((await call('/api/hunt/..%2F..%2Fetc', {cookie})).status).toBe(404);
    expect(JSON.parse((await call('/api/me', {cookie})).body)).toEqual({name: 'Pixel · Chrome', canAct: false, pinSet: false});
  });
  it('Host que não é um IP vinculado nem localhost → 421 (DNS rebinding)', async () => {
    for (const host of ['evil.example.com', 'evil.example.com:47321', '8.8.8.8', '192.168.1.77', 'localhost.evil.com']) expect((await call('/', {host})).status).toBe(421);
    expect((await call('/', {host: `localhost:${port}`})).status).toBe(200);
    expect((await call('/', {host: `127.0.0.1:${port}`})).status).toBe(200);
  });
  it('POST exige Origin igual ao servidor, JSON e corpo ≤ 8 KB', async () => {
    const body = JSON.stringify({code: 'AAAA-AAAA'});
    expect((await call('/api/pair', {method: 'POST', body, origin: 'https://evil.example.com'})).status).toBe(403);
    expect((await call('/api/pair', {method: 'POST', body, origin: null})).status).toBe(403);
    expect((await call('/api/pair', {method: 'POST', body, origin: `http://127.0.0.1:${port}`})).status).toBe(403);
    expect((await call('/api/pair', {method: 'POST', body, json: false})).status).toBe(400); // sem content-type JSON
    hub.startPairing();
    expect((await call('/api/pair', {method: 'POST', body: '{"code":"' + 'A'.repeat(9000) + '"}'})).status).toBe(413);
    expect((await call('/api/pair', {method: 'POST', body: 'não é json'})).status).toBe(400);
    expect((await call('/api/pair', {method: 'POST', body: '[1]'})).status).toBe(400);
  });
  it('métodos fora de GET/POST → 405; rota desconhecida → 404 genérico; /api/pin/check não existe mais', async () => {
    expect((await call('/api/state', {method: 'DELETE'})).status).toBe(405);
    const res = await call('/nada'); expect(res.status).toBe(404); expect(res.body).toBe('{"error":"Não encontrado."}');
    const cookie = await pairDevice(); expect((await call('/api/pin/check', {method: 'POST', cookie, body: '{"pin":"123456"}'})).status).toBe(404);
  });
  it('limite por IP: depois de N requisições seguidas responde 429', async () => {
    let last = 0; for (let i = 0; i < 12; i++) last = (await call('/api/pair', {method: 'POST', body: '{"code":"X"}'})).status;
    expect(last).toBe(429);
  });
  it('arquivos estáticos só pela lista permitida; sem travessia de pasta; bundle do desktop não existe aqui', async () => {
    expect((await call('/')).status).toBe(200); expect((await call('/sw.js')).headers['service-worker-allowed']).toBe('/');
    expect((await call('/assets/a-1.js')).status).toBe(200); expect((await call('/icon-512.png')).headers['content-type']).toBe('image/png');
    for (const p of ['/assets/../p.sqlite', '/assets/%2e%2e/p.sqlite', '/p.sqlite', '/remote/ca.key.pem', '/ca.key.pem', '/leaf.key.pem', '/package.json', '/assets/main-abc123.js', '/index.html']) expect((await call(p)).status).toBe(404);
  });
});

describe('servidor remoto: pareamento (202 + número de conferência)', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('fluxo completo: código → 202 com SAS → pedido no PC → confirmação nativa → /wait entrega o cookie HttpOnly/Secure/SameSite=Strict; o banco guarda só o hash', async () => {
    hub.startPairing(); const code = hub.revealCode().pairing!.code;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const {res, data} = await startPair('iPhone · Safari', code.toLowerCase().replace('-', ' '));
    expect(res.status).toBe(202); expect(data.sas).toMatch(/^\d{2}$/); expect(res.headers['set-cookie']).toBeUndefined();
    const done = await waitPair(data.requestId!);
    expect(done.status).toBe(200); expect(requests).toBe(1);
    expect(native[0]!.message).toContain('iPhone · Safari'); expect(native[0]!.detail).toContain(data.sas!);
    const set = String(done.headers['set-cookie']);
    expect(set).toMatch(new RegExp(`^${COOKIE}=[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43};`)); for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', `Max-Age=${COOKIE_MAX_AGE}`]) expect(set).toContain(flag);
    expect(set).not.toContain('Domain');
    const secret = set.split(';')[0]!.split('.')[1]!;
    const db = new DatabaseSync(dbPath); const rows = db.prepare('SELECT * FROM remote_devices').all(); db.close();
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain(secret); expect(String(rows[0]!.token_hash)).toMatch(/^[0-9a-f]{64}$/); expect(rows[0]!.name).toBe('iPhone · Safari');
    expect(hub.status().pairing).toBeNull(); // uso único
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(403);
    expect((await call(`/api/pair/wait?id=${data.requestId}`)).status).toBe(404); // o resultado só é entregue uma vez
    expect(hub.audit().map(a => a.action)).toEqual(expect.arrayContaining(['pareamento_pedido', 'pareamento_aceito']));
  });
  it('POST /api/pair e /wait exigem o cabeçalho X-PH-SW (heurística do service worker)', async () => {
    hub.startPairing(); const code = hub.revealCode().pairing!.code;
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code}), sw: false})).status).toBe(403);
    expect(hub.status().pairing).not.toBeNull(); expect(requests).toBe(0);
    expect((await call('/api/pair/wait?id=AAAAAAAAAAAAAAAAAAAAAA', {sw: false})).status).toBe(403);
    expect((await call('/api/pair/wait?id=AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });
  it('o PC vê o nome lido pelo servidor separado do apelido e o mesmo SAS do celular', async () => {
    decision = 'hold'; const {res, data} = await startPair('Meu Pixel Bonito', undefined, {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});
    expect(res.status).toBe(202);
    for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    expect(hub.status().request).toMatchObject({ua: 'iPhone · Safari', nickname: 'Meu Pixel Bonito', sas: data.sas, contested: false, ip: '127.0.0.1'});
    await hub.decide(false); expect((await waitPair(data.requestId!)).status).toBe(403);
  });
  it('recusar no PC: sem cookie e sem aparelho', async () => {
    decision = false; const {data} = await startPair();
    const done = await waitPair(data.requestId!);
    expect(done.status).toBe(403); expect(done.headers['set-cookie']).toBeUndefined(); expect(hub.devices()).toHaveLength(0); expect(hub.audit().map(a => a.action)).toContain('pareamento_negado');
  });
  it('confirmação nativa negada (ou indisponível) não cria aparelho', async () => {
    await teardown(); await setup(true, {native: false});
    const {data} = await startPair(); const done = await waitPair(data.requestId!);
    expect(done.status).toBe(403); expect(hub.devices()).toHaveLength(0);
    await teardown(); await setup(true, {native: null}); decision = 'hold';
    const second = await startPair(); for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    await expect(hub.decide(true)).rejects.toThrow('confirmação'); expect(hub.devices()).toHaveLength(0);
    await hub.decide(false); expect((await waitPair(second.data.requestId!)).status).toBe(403);
  });
  it('"Permitir" é ignorado antes de 1,5 s do pedido (atraso também no main)', async () => {
    await teardown(); await setup(true, {approveDelayMs: 1500}); decision = 'hold';
    const {data} = await startPair(); for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    await expect(hub.decide(true)).rejects.toThrow('Aguarde'); expect(native).toHaveLength(0); expect(hub.status().request).not.toBeNull();
    await hub.decide(false); await waitPair(data.requestId!);
  });
  it('o mesmo código certo enviado de novo com o pedido aberto marca contested e recomenda recusar', async () => {
    decision = 'hold'; const first = await startPair('A');
    for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    const again = await call('/api/pair', {method: 'POST', body: JSON.stringify({code: first.code, deviceName: 'B'})});
    expect(again.status).toBe(409);
    expect(hub.status().request).toMatchObject({contested: true}); expect(hub.audit().map(a => a.action)).toContain('pareamento_contestado');
    const other = await call('/api/pair', {method: 'POST', body: JSON.stringify({code: 'ZZZZ-ZZZZ', deviceName: 'C'})}); expect(other.status).toBe(409);
    await hub.decide(false);
  });
  it('long-poll: devolve 202 pending quando o PC ainda não decidiu e o resultado na consulta seguinte', async () => {
    await teardown(); await setup(true, {serverTiming: {waitMs: 120}}); decision = 'hold';
    const {data} = await startPair(); for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    const t0 = Date.now(), pending = await call(`/api/pair/wait?id=${data.requestId}`);
    expect(pending.status).toBe(202); expect(JSON.parse(pending.body)).toEqual({pending: true}); expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    void hub.decide(true); const done = await waitPair(data.requestId!); expect(done.status).toBe(200);
  });
  it('o celular some (não consulta mais): o pedido é cancelado, nada é guardado e o PC fecha o modal', async () => {
    await teardown(); await setup(true, {serverTiming: {abandonMs: 120}}); decision = 'hold';
    const {data} = await startPair(); for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    expect(hub.status().request).not.toBeNull();
    for (let i = 0; i < 60 && hub.status().request; i++) await sleep(20);
    expect(hub.status().request).toBeNull(); expect(hub.devices()).toHaveLength(0);
    expect(hub.audit().map(a => a.action)).toEqual(expect.arrayContaining(['pareamento_abandonado', 'pareamento_cancelado']));
    expect((await waitPair(data.requestId!)).status).toBe(403);
  });
  it('no máximo 60 s no total (aqui 150 ms): expira como recusado', async () => {
    await teardown(); await setup(true, {serverTiming: {maxMs: 150, waitMs: 60}}); decision = 'hold';
    const {data} = await startPair(); for (let i = 0; i < 20 && !hub.status().request; i++) await sleep(10);
    const done = await waitPair(data.requestId!); expect(done.status).toBe(403); expect(hub.devices()).toHaveLength(0); expect(hub.status().request).toBeNull();
  });
  it('sem modo de pareamento → 403; 5 erros de UM IP bloqueiam só esse IP e o código segue válido para os outros', async () => {
    expect((await call('/api/pair', {method: 'POST', body: '{"code":"AAAA-AAAA"}'})).status).toBe(403);
    hub.startPairing(); const code = hub.revealCode().pairing!.code;
    for (let i = 0; i < 4; i++) expect((await call('/api/pair', {method: 'POST', body: '{"code":"0000-0000"}'})).status).toBe(403);
    expect((await call('/api/pair', {method: 'POST', body: '{"code":"0000-0000"}'})).status).toBe(429);
    expect(hub.status().pairing).not.toBeNull(); expect(hub.status().pairing!.attemptsByIp).toEqual([{ip: '127.0.0.1', wrong: 5, left: 0}]); expect(hub.status().pairing!.attemptsLeft).toBe(15);
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(429); expect(requests).toBe(0); // este IP gastou as tentativas
  });
  it('a CA pública só é baixada durante o pareamento, com impressão digital no nome do arquivo e no perfil iOS; nunca vaza chave', async () => {
    expect((await call('/ca.crt')).status).toBe(404); expect((await call('/ca.mobileconfig')).status).toBe(404);
    hub.startPairing(); const fp = hub.status().pairing!.fingerprint, hex = fp.replace(/ /g, '').toLowerCase();
    expect(fp).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
    const crt = await call('/ca.crt'), plist = await call('/ca.mobileconfig');
    expect(crt.status).toBe(200); expect(crt.headers['content-type']).toBe('application/x-x509-ca-cert'); expect(plist.headers['content-type']).toBe('application/x-apple-aspen-config');
    expect(String(crt.headers['content-disposition'])).toContain(`pokehub-ca-${hex.slice(0, 6)}.crt`);
    expect(plist.body).toContain('com.apple.security.root'); expect(plist.body).toContain(fp);
    for (const body of [crt.body, plist.body]) expect(body).not.toMatch(/PRIVATE KEY/);
    expect(hub.status().pairing!.bootstrapUrl).toBe(`https://127.0.0.1:${port}/#fp=${hex}`);
    hub.cancelPairing(); expect((await call('/ca.crt')).status).toBe(404);
  });
  it('1º pareamento: o código só aparece depois de "conferi a impressão digital" (revealCode); depois já aparece', async () => {
    expect(hub.status().firstPairing).toBe(true);
    const gated = hub.startPairing().pairing!; expect(gated).toMatchObject({code: '', codeHidden: true});
    expect(hub.revealCode().pairing!.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    await pairDevice();
    expect(hub.startPairing().pairing).toMatchObject({codeHidden: false}); expect(hub.status().pairing!.code).not.toBe('');
  });
  it('nenhuma resposta da API, do status ou do IPC contém chave privada, token ou hash', async () => {
    const cookie = await pairDevice(); const secret = cookie.split('.')[1]!;
    const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
    registerRemoteIpc({handle: (c: string, h: never) => { handlers.set(c, (...a) => (h as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, ...a)); }}, () => true, hub);
    const dumps: string[] = [];
    for (const channel of ['remote:status', 'remote:devices', 'remote:audit']) dumps.push(JSON.stringify(await handlers.get(channel)!()));
    for (const p of ['/api/me', '/api/state', '/api/diag', '/api/hunt/acc-1', '/api/market/acc-1']) dumps.push((await call(p, {cookie})).body);
    for (const d of dumps) { expect(d).not.toMatch(/PRIVATE KEY/); expect(d).not.toContain(secret); expect(d).not.toMatch(/token_hash|tokenHash|[0-9a-f]{64}/); expect(d).not.toContain(root); }
    hub.startPairing(); expect(JSON.stringify(await handlers.get('remote:status')!())).not.toMatch(/PRIVATE KEY|token_hash|prev_token/);
    expect(readFileSync(join(root, `t${n}`, 'remote', 'ca.key.pem'), 'utf8')).toContain('PRIVATE KEY'); // sem safeStorage (testes): a chave existe só em disco
  });
  it('com cifra de repouso (safeStorage) a chave no disco não é PEM', async () => {
    await teardown();
    const box = {encrypt: (s: string) => Buffer.from(s, 'utf8').reverse(), decrypt: (b: Buffer) => Buffer.from(b).reverse().toString('utf8')};
    await setup(true, {secretBox: box});
    for (const f of ['ca.key.pem', 'leaf.key.pem']) { const raw = readFileSync(join(root, `t${n}`, 'remote', f)); expect(raw.toString('latin1').startsWith('-----BEGIN')).toBe(false); expect(raw.toString('latin1')).not.toContain('PRIVATE KEY'); }
    expect((await call('/')).status).toBe(200); // o servidor sobe normalmente com a chave decifrada
  });
  it('IPC: origem não confiável é recusada e erros são genéricos', async () => {
    const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>(); let ok = false;
    registerRemoteIpc({handle: (c: string, h: never) => { handlers.set(c, (...a) => (h as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, ...a)); }}, () => ok, hub);
    expect(await handlers.get('remote:status')!()).toEqual({ok: false, error: 'Origem não autorizada.'});
    ok = true;
    expect(await handlers.get('remote:set-pin')!('12')).toEqual({ok: false, error: 'O PIN precisa ter 6 dígitos.'});
    expect(await handlers.get('remote:enable')!('x')).toEqual({ok: false, error: 'Não foi possível concluir a operação.'});
  });
  it('limite de aparelhos', async () => {
    for (let i = 0; i < 8; i++) { clock += 61_000; await pairDevice(); }
    hub.startPairing(); const code = hub.revealCode().pairing!.code;
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(403); expect(hub.devices()).toHaveLength(8);
  });
  it('"pode agir" passa por confirmação nativa; recusar não muda nada', async () => {
    const id = idOf(await pairDevice()); native.length = 0;
    await hub.setCanAct(id, true); expect(native).toHaveLength(1); expect(native[0]!.message).toContain('Pixel'); expect(hub.devices()[0]!.canAct).toBe(true); expect(hub.audit().map(a => a.action)).toContain('pode_agir_ligado');
    nativeAnswer = false; await hub.setCanAct(id, false); expect(hub.devices()[0]!.canAct).toBe(true); // recusado no diálogo do sistema: nada muda
  });
});

describe('servidor remoto: token (validade, rotação, renovação)', () => {
  beforeEach(() => setup()); afterEach(teardown);
  const setCookieOf = (res: Res) => { const raw = res.headers['set-cookie']; return raw ? String(raw[0]).split(';')[0]! : null; };
  it('rotaciona a cada 24 h (novo Set-Cookie), o anterior vale 5 min, e o cookie renova Max-Age de 30 dias', async () => {
    const old = await pairDevice();
    expect(setCookieOf(await call('/api/state', {cookie: old}))).toBeNull(); // dentro das 24 h: sem rotação
    clock += ROTATE_MS + 1000;
    const res = await call('/api/state', {cookie: old}); expect(res.status).toBe(200);
    const fresh = setCookieOf(res)!; expect(fresh).toBeTruthy(); expect(fresh).not.toBe(old); expect(String(res.headers['set-cookie'])).toContain(`Max-Age=${COOKIE_MAX_AGE}`);
    expect(idOf(fresh)).toBe(idOf(old));
    clock += 60_000; expect((await call('/api/state', {cookie: old})).status).toBe(200); expect((await call('/api/state', {cookie: fresh})).status).toBe(200); // janela de 5 min
    clock += 5 * 60_000; expect((await call('/api/state', {cookie: old})).status).toBe(401); expect((await call('/api/state', {cookie: fresh})).status).toBe(200);
    const db = new DatabaseSync(dbPath); const row = db.prepare('SELECT token_hash, prev_token_hash FROM remote_devices').get()!; db.close(); expect(row.token_hash).not.toBe(row.prev_token_hash);
  });
  it('o cookie é renovado (mesmo valor, Max-Age 30 dias) depois de 1 h de uso', async () => {
    const cookie = await pairDevice(); clock += 2 * 3_600_000;
    const res = await call('/api/state', {cookie}); expect(setCookieOf(res)).toBe(cookie); expect(String(res.headers['set-cookie'])).toContain(`Max-Age=${COOKIE_MAX_AGE}`);
  });
  it('inativo por mais de 30 dias: revoga com auditoria "expirado"', async () => {
    const cookie = await pairDevice(); clock += 31 * 86_400_000;
    expect((await call('/api/state', {cookie})).status).toBe(401);
    expect(hub.devices()).toHaveLength(0); expect(hub.audit().map(a => a.action)).toContain('expirado');
  });
  it('limite absoluto de 180 dias mesmo com uso constante', async () => {
    let cookie = await pairDevice(); let status = 200;
    for (let day = 0; day < 190 && status === 200; day += 20) {
      clock += 20 * 86_400_000; const res = await call('/api/state', {cookie}); status = res.status; cookie = setCookieOf(res) ?? cookie;
    }
    expect(status).toBe(401); expect(hub.devices()).toHaveLength(0); expect(hub.audit().find(a => a.action === 'expirado')!.detail).toContain('180');
  });
  it('varredura periódica expira aparelhos que nunca voltam', async () => {
    await pairDevice(); clock += 31 * 86_400_000;
    await hub.setEnabled(false); await hub.setEnabled(true); // ligar roda a varredura
    expect(hub.devices()).toHaveLength(0);
  });
});

describe('servidor remoto: limites (B1, B2, B3, B6)', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('hunt/mercado exigem X-PH: 1; 10 por minuto por aparelho; chamadas simultâneas iguais dividem uma só execução', async () => {
    const cookie = await pairDevice();
    expect((await call('/api/hunt/acc-1', {cookie, ph: false})).status).toBe(400);
    huntDelay = 120; huntCalls = 0;
    const burst = await Promise.all([1, 2, 3, 4].map(() => call('/api/hunt/acc-1', {cookie})));
    expect(burst.map(r => r.status)).toEqual([200, 200, 200, 200]); expect(huntCalls).toBe(1); // coalescência
    huntDelay = 0; let last = 200;
    for (let i = 0; i < 12; i++) last = (await call('/api/market/acc-1', {cookie})).status;
    expect(last).toBe(429);
    clock += 61_000; expect((await call('/api/hunt/acc-1', {cookie})).status).toBe(200);
  });
  it('no máximo 8 conexões por IP; a 9ª é fechada na hora', async () => {
    const socks = await Promise.all(Array.from({length: 8}, () => new Promise<ReturnType<typeof connect>>((resolve, reject) => { const s = connect(port, '127.0.0.1'); s.once('connect', () => resolve(s)); s.once('error', reject); })));
    await sleep(100);
    const ninth = connect(port, '127.0.0.1'); ninth.on('error', () => undefined);
    const closed = await Promise.race([new Promise<boolean>(resolve => ninth.once('close', () => resolve(true))), sleep(1500).then(() => false)]);
    expect(closed).toBe(true);
    for (const s of socks) s.destroy(); ninth.destroy();
    await sleep(100); const again = connect(port, '127.0.0.1'); again.on('error', () => undefined);
    const ok = await new Promise<boolean>(resolve => { again.once('connect', () => resolve(true)); sleep(1500).then(() => resolve(false)); }); again.destroy(); expect(ok).toBe(true);
  });
});

describe('servidor remoto: SSE, revogação e contrapressão', () => {
  beforeEach(() => { decision = true; return setup(); }); afterEach(teardown);
  function sse(cookie: string, pause = false) {
    return new Promise<{req: ReturnType<typeof request>; first: string; closed: Promise<void>}>((resolve, reject) => {
      const req = request({host: '127.0.0.1', port, path: '/api/events', headers: {Host: `127.0.0.1:${port}`, Cookie: cookie}, rejectUnauthorized: false}, res => {
        const closed = new Promise<void>(done => { res.on('close', done); res.on('end', done); res.on('error', () => done()); });
        res.once('data', chunk => { if (pause) res.pause(); resolve({req, first: String(chunk), closed}); });
      });
      req.on('error', reject); req.end();
    });
  }
  const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error('fluxo não fechou')), ms))]);
  it('SSE exige autenticação, manda o estado inicial e recebe publicações', async () => {
    expect((await call('/api/events')).status).toBe(401);
    const cookie = await pairDevice();
    const stream = await sse(cookie);
    expect(stream.first).toContain('event: state'); expect(stream.first).toContain('Principal');
    expect(hub.status().running).toBe(true);
    stream.req.destroy();
  });
  it('revogar fecha na hora os fluxos SSE do aparelho', async () => {
    const cookie = await pairDevice(); const id = idOf(cookie);
    const stream = await sse(cookie);
    expect(hub.revoke(id)).toBe(true);
    await within(stream.closed, 2000);
    expect((await call('/api/events', {cookie})).status).toBe(401);
  });
  it('desligar o acesso remoto derruba os fluxos abertos', async () => {
    const stream = await sse(await pairDevice());
    await hub.setEnabled(false);
    await within(stream.closed, 2000);
  });
  it('cliente SSE que não lê é desconectado quando o buffer passa de 256 KB (contrapressão)', async () => {
    const stream = await sse(await pairDevice(), true);
    const blob = 'x'.repeat(200_000);
    expect(hub.streamCount()).toBe(1);
    for (let i = 0; i < 400 && hub.streamCount() > 0; i++) { hub.publish('state', {blob}); await sleep(5); }
    const dropped = hub.streamCount() === 0; stream.req.destroy(); expect(dropped).toBe(true);
  }, 30_000);
  it('o hash do PIN no banco não contém o PIN', async () => {
    await hub.setPin('482913');
    const db = new DatabaseSync(dbPath); const hash = String(db.prepare('SELECT remote_pin_hash AS h FROM workspace_settings').get()!.h); db.close();
    expect(hash).toMatch(/^scrypt\$/); expect(hash).not.toContain('482913');
    await expect(hub.setPin('abc')).rejects.toThrow(); await expect(hub.setPin(123456)).rejects.toThrow();
  });
  it('sair (logout) apaga o aparelho', async () => {
    const cookie = await pairDevice();
    const res = await call('/api/logout', {method: 'POST', cookie, body: '{}'}); expect(res.status).toBe(200);
    expect(hub.devices()).toHaveLength(0); expect((await call('/api/state', {cookie})).status).toBe(401);
  });
});

describe('PIN no hub: bloqueios persistentes', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('os contadores sobrevivem a recriar o hub (mesmo banco) e escalam 15 min → 1 h → 24 h → revoga o aparelho e avisa o PC', async () => {
    const id = idOf(await pairDevice()); await hub.setPin('482913');
    for (let i = 0; i < 4; i++) expect(await hub.pin.check(id, '000000')).toMatchObject({reason: 'wrong'});
    await hub.close();
    const dir = join(root, `t${n}`); hub = makeHub(dbPath, dir); await hub.setEnabled(true);
    expect(await hub.pin.check(id, '000000')).toMatchObject({ok: false, reason: 'locked', retryAfterMs: 15 * 60_000}); // o 5º erro veio depois de recriar
    hub.reenableActions(); // o teto global de 10 erros/dia não é o assunto aqui
    expect(await hub.pin.check(id, '482913')).toMatchObject({reason: 'locked'}); // nem o certo passa
    clock += 15 * 60_000 + 1;
    for (let i = 0; i < 4; i++) await hub.pin.check(id, '000000');
    expect(await hub.pin.check(id, '000000')).toMatchObject({reason: 'locked', retryAfterMs: 60 * 60_000}); hub.reenableActions();
    clock += 60 * 60_000 + 1;
    for (let i = 0; i < 4; i++) await hub.pin.check(id, '000000');
    expect(await hub.pin.check(id, '000000')).toMatchObject({reason: 'locked', retryAfterMs: 24 * 60 * 60_000}); hub.reenableActions();
    clock += 24 * 3_600_000 + 1;
    for (let i = 0; i < 4; i++) await hub.pin.check(id, '000000');
    expect(await hub.pin.check(id, '000000')).toMatchObject({ok: false, reason: 'revoked'});
    expect(hub.devices()).toHaveLength(0); expect(hub.status().notice).toContain('revogado'); expect(hub.audit().map(a => a.action)).toEqual(expect.arrayContaining(['pin_bloqueado', 'aparelho_revogado_pin']));
  });
  it('10 erros no dia (todos os aparelhos) desligam as ações até religar no PC', async () => {
    const a = idOf(await pairDevice()); clock += 61_000; const b = idOf(await pairDevice()); await hub.setPin('482913');
    for (let i = 0; i < 4; i++) { await hub.pin.check(a, '000000'); await hub.pin.check(b, '000000'); }
    await hub.pin.check(a, '000000'); // 9º
    expect(hub.status().actionsDisabled).toBe(false);
    expect(await hub.pin.check(b, '000000')).toMatchObject({reason: 'disabled'}); // 10º
    expect(hub.status()).toMatchObject({actionsDisabled: true}); expect(hub.status().notice).toContain('desligadas');
    expect(await hub.pin.check(a, '482913')).toMatchObject({reason: 'disabled'}); // nem o PIN certo
    hub.reenableActions(); expect(hub.status().actionsDisabled).toBe(false);
    expect(await hub.pin.check(b, '482913')).toEqual({ok: true});
  });
});
