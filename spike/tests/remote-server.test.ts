import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteHub, type RemoteHub } from '../remote/hub';
import { registerRemoteIpc } from '../remote/ipc';
import { COOKIE } from '../remote/server';

const root = mkdtempSync(join(tmpdir(), 'pokehub-remote-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));
let n = 0;
interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
const accounts = [{id: 'acc-1', label: 'Principal', color: '#d4a65f', state: 'ready', suspended: false}];
let decision = true, hub: RemoteHub, port = 0, dbPath = '', requests = 0;
const blockerCalls: string[] = [];

async function setup(enabled = true) {
  const dir = join(root, `t${++n}`); mkdirSync(join(dir, 'ui'), {recursive: true});
  writeFileSync(join(dir, 'ui', 'remote.html'), '<!doctype html><title>x</title>'); writeFileSync(join(dir, 'ui', 'sw.js'), '//sw'); writeFileSync(join(dir, 'ui', 'manifest.webmanifest'), '{}');
  mkdirSync(join(dir, 'ui', 'assets')); writeFileSync(join(dir, 'ui', 'assets', 'a-1.js'), 'x');
  dbPath = join(dir, 'p.sqlite'); requests = 0;
  hub = createRemoteHub({
    dbPath, dir: join(dir, 'remote'), uiDir: join(dir, 'ui'), iconPath: join(process.cwd(), 'build', 'icon.png'), lan: () => [], portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000,
    api: {accounts: () => accounts, hunt: async id => ({estado: 'ok', id}), market: async (id, foco) => ({estado: 'ok', id, foco}), diag: () => ({accounts: [], host: {totalKb: 1, freeKb: 1}})},
    running: () => 1, blocker: {start: type => { blockerCalls.push(`start:${type}`); return 7; }, stop: () => { blockerCalls.push('stop'); }},
    onPairRequest: () => { requests++; queueMicrotask(() => hub.decide(decision)); },
  });
  if (enabled) { await hub.setEnabled(true); port = hub.status().port; }
}
const teardown = async () => { await hub?.close(); };
function call(path: string, o: {method?: string; headers?: Record<string, string>; body?: string | Buffer; host?: string; cookie?: string; origin?: string | null; json?: boolean} = {}): Promise<Res> {
  const method = o.method ?? 'GET';
  const headers: Record<string, string> = {Host: o.host ?? `127.0.0.1:${port}`, ...o.headers};
  if (o.cookie) headers.Cookie = o.cookie;
  if (method === 'POST') { if (o.origin !== null) headers.Origin = o.origin ?? `https://127.0.0.1:${port}`; if (o.json !== false) headers['Content-Type'] = 'application/json'; }
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path, method, headers, rejectUnauthorized: false}, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')})); });
    req.on('error', reject); req.end(o.body);
  });
}
const cookieOf = (res: Res) => String((res.headers['set-cookie'] as string[])[0]).split(';')[0]!;
async function pairDevice(): Promise<string> {
  const code = hub.startPairing().pairing!.code;
  const res = await call('/api/pair', {method: 'POST', body: JSON.stringify({code, deviceName: 'Pixel · Chrome'})});
  expect(res.status).toBe(200);
  return cookieOf(res);
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
});

describe('servidor remoto: autenticação e cabeçalhos', () => {
  beforeEach(() => setup()); afterEach(teardown);
  it('/api/state sem cookie → 401 genérico, com cabeçalhos estritos', async () => {
    const res = await call('/api/state');
    expect(res.status).toBe(401); expect(JSON.parse(res.body)).toEqual({error: 'Não autorizado.'});
    expect(res.headers['content-security-policy']).toContain("default-src 'self'"); expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY'); expect(res.headers['referrer-policy']).toBe('no-referrer'); expect(res.headers['x-content-type-options']).toBe('nosniff'); expect(res.headers['cache-control']).toBe('no-store');
    for (const p of ['/api/hunt/acc-1', '/api/market/acc-1', '/api/diag', '/api/me', '/api/events']) expect((await call(p)).status).toBe(401);
  });
  it('cookie inválido, de formato errado ou de aparelho revogado → 401', async () => {
    const cookie = await pairDevice();
    expect((await call('/api/state', {cookie})).status).toBe(200);
    const [id] = cookie.slice(COOKIE.length + 1).split('.');
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
  it('métodos fora de GET/POST → 405; rota desconhecida → 404 genérico', async () => {
    expect((await call('/api/state', {method: 'DELETE'})).status).toBe(405);
    const res = await call('/nada'); expect(res.status).toBe(404); expect(res.body).toBe('{"error":"Não encontrado."}');
  });
  it('limite por IP: depois de N requisições seguidas responde 429', async () => {
    let last = 0; for (let i = 0; i < 12; i++) last = (await call('/api/pair', {method: 'POST', body: '{"code":"X"}'})).status;
    expect(last).toBe(429);
  });
  it('arquivos estáticos só pela lista permitida; sem travessia de pasta', async () => {
    expect((await call('/')).status).toBe(200); expect((await call('/sw.js')).headers['service-worker-allowed']).toBe('/');
    expect((await call('/assets/a-1.js')).status).toBe(200); expect((await call('/icon-512.png')).headers['content-type']).toBe('image/png');
    for (const p of ['/assets/../p.sqlite', '/assets/%2e%2e/p.sqlite', '/p.sqlite', '/remote/ca.key.pem', '/ca.key.pem', '/leaf.key.pem', '/package.json']) expect((await call(p)).status).toBe(404);
  });
});

describe('servidor remoto: pareamento', () => {
  beforeEach(() => { decision = true; return setup(); }); afterEach(teardown);
  it('fluxo completo: código → pedido no PC → aceitar → cookie HttpOnly/Secure/SameSite=Strict; o banco guarda só o hash', async () => {
    const code = hub.startPairing().pairing!.code;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const res = await call('/api/pair', {method: 'POST', body: JSON.stringify({code: code.toLowerCase().replace('-', ' '), deviceName: 'iPhone · Safari'})});
    expect(res.status).toBe(200); expect(requests).toBe(1);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(new RegExp(`^${COOKIE}=[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43};`)); for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=']) expect(set).toContain(flag);
    expect(set).not.toContain('Domain');
    const secret = set.split(';')[0]!.split('.')[1]!;
    const db = new DatabaseSync(dbPath); const rows = db.prepare('SELECT * FROM remote_devices').all(); db.close();
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain(secret); expect(String(rows[0]!.token_hash)).toMatch(/^[0-9a-f]{64}$/); expect(rows[0]!.name).toBe('iPhone · Safari');
    expect(hub.status().pairing).toBeNull(); // uso único
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(403);
    expect(hub.audit().map(a => a.action)).toEqual(expect.arrayContaining(['pareamento_pedido', 'pareamento_aceito']));
  });
  it('recusar no PC: sem cookie e sem aparelho', async () => {
    decision = false; const code = hub.startPairing().pairing!.code;
    const res = await call('/api/pair', {method: 'POST', body: JSON.stringify({code})});
    expect(res.status).toBe(403); expect(res.headers['set-cookie']).toBeUndefined(); expect(hub.devices()).toHaveLength(0); expect(hub.audit()[0]!.action).toBe('pareamento_negado');
  });
  it('sem modo de pareamento → 403; 5 códigos errados invalidam o código certo', async () => {
    expect((await call('/api/pair', {method: 'POST', body: '{"code":"AAAA-AAAA"}'})).status).toBe(403);
    const code = hub.startPairing().pairing!.code;
    for (let i = 0; i < 5; i++) expect((await call('/api/pair', {method: 'POST', body: '{"code":"0000-0000"}'})).status).toBe(403);
    expect(hub.status().pairing).toBeNull();
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(403); expect(requests).toBe(0);
  });
  it('a CA pública só é baixada durante o pareamento e nunca vaza chave privada', async () => {
    expect((await call('/ca.crt')).status).toBe(404); expect((await call('/ca.mobileconfig')).status).toBe(404);
    hub.startPairing();
    const crt = await call('/ca.crt'), plist = await call('/ca.mobileconfig');
    expect(crt.status).toBe(200); expect(crt.headers['content-type']).toBe('application/x-x509-ca-cert'); expect(plist.headers['content-type']).toBe('application/x-apple-aspen-config');
    expect(plist.body).toContain('com.apple.security.root');
    for (const body of [crt.body, plist.body]) expect(body).not.toMatch(/PRIVATE KEY/);
    hub.cancelPairing(); expect((await call('/ca.crt')).status).toBe(404);
  });
  it('nenhuma resposta da API, do status ou do IPC contém chave privada, token ou hash', async () => {
    const cookie = await pairDevice(); const secret = cookie.split('.')[1]!;
    const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
    registerRemoteIpc({handle: (c: string, h: never) => { handlers.set(c, (...a) => (h as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, ...a)); }}, () => true, hub);
    const dumps: string[] = [];
    for (const channel of ['remote:status', 'remote:devices', 'remote:audit']) dumps.push(JSON.stringify(await handlers.get(channel)!()));
    for (const p of ['/api/me', '/api/state', '/api/diag', '/api/hunt/acc-1', '/api/market/acc-1']) dumps.push((await call(p, {cookie})).body);
    for (const d of dumps) { expect(d).not.toMatch(/PRIVATE KEY/); expect(d).not.toContain(secret); expect(d).not.toMatch(/token_hash|tokenHash|[0-9a-f]{64}/); expect(d).not.toContain(root); }
    hub.startPairing(); for (const channel of ['remote:status']) expect(JSON.stringify(await handlers.get(channel)!())).not.toMatch(/PRIVATE KEY/);
    expect(readFileSync(join(root, `t${n}`, 'remote', 'ca.key.pem'), 'utf8')).toContain('PRIVATE KEY'); // a chave existe, só em disco
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
    for (let i = 0; i < 8; i++) await pairDevice();
    const code = hub.startPairing().pairing!.code;
    expect((await call('/api/pair', {method: 'POST', body: JSON.stringify({code})})).status).toBe(403); expect(hub.devices()).toHaveLength(8);
  });
});

describe('servidor remoto: SSE, revogação e PIN', () => {
  beforeEach(() => { decision = true; return setup(); }); afterEach(teardown);
  function sse(cookie: string) {
    return new Promise<{req: ReturnType<typeof request>; first: string; closed: Promise<void>}>((resolve, reject) => {
      const req = request({host: '127.0.0.1', port, path: '/api/events', headers: {Host: `127.0.0.1:${port}`, Cookie: cookie}, rejectUnauthorized: false}, res => {
        const closed = new Promise<void>(done => { res.on('close', done); res.on('end', done); res.on('error', () => done()); });
        res.once('data', chunk => resolve({req, first: String(chunk), closed}));
      });
      req.on('error', reject); req.end();
    });
  }
  it('SSE exige autenticação, manda o estado inicial e recebe publicações', async () => {
    expect((await call('/api/events')).status).toBe(401);
    const cookie = await pairDevice();
    const stream = await sse(cookie);
    expect(stream.first).toContain('event: state'); expect(stream.first).toContain('Principal');
    expect(hub.status().running).toBe(true);
    stream.req.destroy();
  });
  it('revogar fecha na hora os fluxos SSE do aparelho', async () => {
    const cookie = await pairDevice(); const id = cookie.slice(COOKIE.length + 1).split('.')[0]!;
    const stream = await sse(cookie);
    expect(hub.revoke(id)).toBe(true);
    await Promise.race([stream.closed, new Promise((_r, rej) => setTimeout(() => rej(new Error('fluxo não fechou')), 2000))]);
    expect((await call('/api/events', {cookie})).status).toBe(401);
  });
  it('desligar o acesso remoto derruba os fluxos abertos', async () => {
    const stream = await sse(await pairDevice());
    await hub.setEnabled(false);
    await Promise.race([stream.closed, new Promise((_r, rej) => setTimeout(() => rej(new Error('fluxo não fechou')), 2000))]);
  });
  it('PIN: não definido → 409; errado → 403; 5 erros bloqueiam (429) até o certo também; definir limpa os contadores', async () => {
    const cookie = await pairDevice();
    const check = (pin: string) => call('/api/pin/check', {method: 'POST', cookie, body: JSON.stringify({pin})});
    expect((await check('123456')).status).toBe(409);
    hub.setPin('482913');
    expect((await check('000000')).status).toBe(403);
    expect((await check('482913')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await check('111111')).status).toBe(403);
    const locked = await check('111111'); expect(locked.status).toBe(429); expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
    expect((await check('482913')).status).toBe(429);
    expect(hub.audit().map(a => a.action)).toContain('pin_bloqueado');
    hub.setPin('135790'); expect((await check('135790')).status).toBe(200);
  });
  it('o hash do PIN no banco não contém o PIN', async () => {
    hub.setPin('482913');
    const db = new DatabaseSync(dbPath); const hash = String(db.prepare('SELECT remote_pin_hash AS h FROM workspace_settings').get()!.h); db.close();
    expect(hash).toMatch(/^scrypt\$/); expect(hash).not.toContain('482913');
    expect(() => hub.setPin('abc')).toThrow(); expect(() => hub.setPin(123456)).toThrow();
  });
  it('sair (logout) apaga o aparelho', async () => {
    const cookie = await pairDevice();
    const res = await call('/api/logout', {method: 'POST', cookie, body: '{}'}); expect(res.status).toBe(200);
    expect(hub.devices()).toHaveLength(0); expect((await call('/api/state', {cookie})).status).toBe(401);
  });
});
