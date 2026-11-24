import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { createECDH, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRemoteHub, type RemoteHub } from '../remote/hub';
import { COOKIE } from '../remote/server';
import { createAlertEngine, parsePrefs, DOWN_AFTER_MS, GROUP_MS, type AlertEngine, type CaptureSource } from '../remote/alerts';
import { ensureVapid, FAIL_LIMIT, PUSH_MAX_BYTES, type Push, type PushFetch, type PushSub, type SendResult } from '../remote/push';
import { RemoteStore, ALERTS_KEEP } from '../remote/store';
import { openDatabase } from '../electron/database';
import { DEFAULT_ALERT_PREFS, PUSH_URL_PATTERN, type AlertPrefs, type RemoteAlert } from '../contracts/remote';
import type { Capture } from '../domain/captures';
import type { SecretBox } from '../remote/certs';
import type { NetSelection } from '../remote/ip';

const root = mkdtempSync(join(tmpdir(), 'pokehub-alerts-'));
afterAll(() => { try { rmSync(root, {recursive: true, force: true}); } catch { /* Windows: arquivo ainda aberto */ } });
const box: SecretBox = {encrypt: s => Buffer.from(s, 'utf8').reverse(), decrypt: b => Buffer.from(b).reverse().toString('utf8')};
const SECRET_EMAIL = 'segredo@exemplo.com';
const profiles = [{id: 'acc-1', label: 'Principal', colorToken: '#d4a65f', emailLabel: SECRET_EMAIL}, {id: 'acc-2', label: 'Alt', colorToken: '#5fa8d4', emailLabel: 'outro@exemplo.com'}];
const cap = (o: Partial<Capture> = {}): Capture => ({profileId: 'acc-1', name: 'Pikachu', level: 20, time: '10:00', at: '2026-11-23T10:00:00.000Z', potencia: 5, iv: null, quality: null, nota: 8, shiny: true, record: false, hints: ['dica-interna'], ...o});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Fonte de capturas falsa: conta assinantes, devolve a lista e permite disparar eventos. */
function fakeSource() {
  const subs = new Set<(e: {captures: Capture[]}) => void>(); let list: Capture[] = [];
  const queries: unknown[] = [];
  const source: CaptureSource = {subscribe: fn => { subs.add(fn); return () => { subs.delete(fn); }; }, list: q => { queries.push(q); return list.filter(c => !q.profileId || c.profileId === q.profileId).slice(0, q.limit ?? 100); }};
  return {source, count: () => subs.size, emit: (captures: Capture[]) => { for (const fn of [...subs]) fn({captures}); }, set: (c: Capture[]) => { list = c; }, queries};
}
function receiver() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); const auth = randomBytes(16);
  const decrypt = (body: Buffer): string => {
    const salt = body.subarray(0, 16), idlen = body[20]!, asPub = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen), ua = ecdh.getPublicKey();
    const prk = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
    const d = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
    d.setAuthTag(cipher.subarray(cipher.length - 16));
    const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]); let end = plain.length; while (plain[end - 1] === 0) end--;
    return plain.subarray(0, end - 1).toString('utf8');
  };
  return {decrypt, sub: (name: string) => ({endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: {p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url')}})};
}

// ---------- Harness HTTPS (hub real, rede falsa, push falso) ----------
let hub: RemoteHub, port = 0, clock = Date.now(), dbPath = '', dirPath = '', src: ReturnType<typeof fakeSource>, status = 201;
let sentPush: {url: string; body: Buffer; headers: Record<string, string>}[] = [];
const receivers = new Map<string, ReturnType<typeof receiver>>();
let n = 0;
const sel: NetSelection = {binds: [], subnets: [], pin: 'pin-casa', label: 'Casa', source: 'subnet'};
const fetcher: PushFetch = async (url, init) => { sentPush.push({url, body: init.body, headers: init.headers}); return {status, body: {cancel: async () => undefined}}; };
async function setup() {
  const dir = join(root, `t${++n}`); dirPath = join(dir, 'remote'); mkdirSync(join(dir, 'ui'), {recursive: true}); writeFileSync(join(dir, 'ui', 'remote.html'), '<!doctype html>');
  dbPath = join(dir, 'p.sqlite'); clock = Date.now(); sentPush = []; status = 201; src = fakeSource(); receivers.clear();
  hub = createRemoteHub({dbPath, dir: dirPath, uiDir: join(dir, 'ui'), iconPath: join(process.cwd(), 'build', 'icon.png'), net: async () => sel, portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000, now: () => clock, secretBox: box,
    api: {accounts: () => profiles.map(p => ({id: p.id, label: p.label, color: p.colorToken, state: 'ready', suspended: false})), hunt: async () => ({}), market: async () => ({}), diag: () => ({})},
    running: () => 1, blocker: {start: () => 1, stop: () => undefined}, alerts: {captures: src.source, profiles: () => profiles, fetcher}});
  await hub.setEnabled(true); port = hub.status().port;
}
const teardown = async () => { await hub?.close(); };
function makeDevice(name = 'Pixel') {
  const id = randomUUID(), secret = randomBytes(32).toString('base64url');
  hub.store.addDevice({id, name, tokenHash: sha(secret), now: new Date(clock).toISOString(), nowMs: clock});
  return {id, cookie: `${COOKIE}=${id}.${secret}`};
}
interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function call(path: string, o: {method?: string; cookie?: string; body?: unknown; raw?: string | Buffer; origin?: string | null; json?: boolean; ph?: boolean} = {}): Promise<Res> {
  const method = o.method ?? (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET'), headers: Record<string, string> = {Host: `127.0.0.1:${port}`};
  if (o.cookie) headers.Cookie = o.cookie;
  if (method === 'GET' && o.ph !== false) headers['X-PH'] = '1';
  if (method === 'POST') { if (o.origin !== null) headers.Origin = o.origin ?? `https://127.0.0.1:${port}`; if (o.json !== false) headers['Content-Type'] = 'application/json'; }
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path, method, headers, rejectUnauthorized: false}, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')})); });
    req.on('error', reject); req.end(o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)));
  });
}
const get = async <T>(path: string, cookie: string): Promise<T> => { const r = await call(path, {cookie}); expect(r.status, `${path}: ${r.body}`).toBe(200); return JSON.parse(r.body) as T; };
const post = (path: string, cookie: string, body: unknown = {}) => call(path, {cookie, body});
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
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const subscribe = async (cookie: string, name: string) => { const r = receiver(); const body = r.sub(name); receivers.set(body.endpoint, r); const res = await post('/api/push/subscribe', cookie, body); expect(res.status, res.body).toBe(200); return {res, r, body}; };
const decoded = () => sentPush.map(p => JSON.parse(receivers.get(p.url)!.decrypt(p.body)) as {kind: string; label: string; text: string; at: string; url: string});
const rows = (sql: string, ...args: (string | number)[]) => { const db = new DatabaseSync(dbPath); try { return db.prepare(sql).all(...args) as Record<string, unknown>[]; } finally { db.close(); } };

describe('alertas: validação das preferências', () => {
  it('aceita só as 5 chaves exatas, booleanos e nota 0–10 ou null', () => {
    expect(parsePrefs({...DEFAULT_ALERT_PREFS})).toEqual(DEFAULT_ALERT_PREFS); expect(parsePrefs({shiny: false, p5: true, recorde: true, notaMin: 7.5, contaCaiu: false})).toMatchObject({notaMin: 7.5});
    expect(parsePrefs({shiny: true, p5: true, recorde: false, notaMin: 0, contaCaiu: true})).not.toBeNull(); expect(parsePrefs({shiny: true, p5: true, recorde: false, notaMin: 10, contaCaiu: true})).not.toBeNull();
    for (const bad of [null, undefined, 1, 'x', [], {}, {...DEFAULT_ALERT_PREFS, extra: 1}, {...DEFAULT_ALERT_PREFS, shiny: 1}, {...DEFAULT_ALERT_PREFS, shiny: 'true'}, {...DEFAULT_ALERT_PREFS, notaMin: 11}, {...DEFAULT_ALERT_PREFS, notaMin: -1}, {...DEFAULT_ALERT_PREFS, notaMin: '5'}, {...DEFAULT_ALERT_PREFS, notaMin: NaN}, {...DEFAULT_ALERT_PREFS, notaMin: Infinity}, {shiny: true, p5: true, recorde: false, notaMin: null}])
      expect(parsePrefs(bad), JSON.stringify(bad)).toBeNull();
  });
  it('padrão por aparelho', () => { expect(DEFAULT_ALERT_PREFS).toEqual({shiny: true, p5: true, recorde: false, notaMin: null, contaCaiu: true}); });
});

describe('alertas: rotas (HTTPS, autenticação, X-PH, Origin)', () => {
  beforeEach(setup); afterEach(teardown);
  it('todas as rotas novas exigem autenticação (401)', async () => {
    for (const p of ['/api/captures', '/api/alerts', '/api/alerts/prefs', '/api/push/key']) expect((await call(p)).status, p).toBe(401);
    for (const p of ['/api/alerts/prefs', '/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test']) expect((await call(p, {body: {}})).status, p).toBe(401);
  });
  it('GETs exigem X-PH: 1 (400 sem ele)', async () => {
    const {cookie} = makeDevice();
    for (const p of ['/api/captures', '/api/alerts', '/api/alerts/prefs', '/api/push/key']) { expect((await call(p, {cookie, ph: false})).status, p).toBe(400); expect((await call(p, {cookie})).status, p).toBe(200); }
  });
  it('POSTs: Origin errado/ausente → 403, sem JSON → 400, corpo > 8 KB → 413', async () => {
    const {cookie} = makeDevice(), body = {endpoint: 'https://fcm.googleapis.com/x', keys: {}};
    for (const p of ['/api/alerts/prefs', '/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test']) {
      expect((await call(p, {cookie, body, origin: 'https://evil.com'})).status, p).toBe(403); expect((await call(p, {cookie, body, origin: null})).status, p).toBe(403);
      expect((await call(p, {cookie, body, json: false})).status, p).toBe(400);
      expect((await call(p, {cookie, raw: JSON.stringify({x: 'a'.repeat(9000)})})).status, p).toBe(413);
    }
  });
  it('GET devolve 405 para métodos estranhos e 404 para rotas desconhecidas', async () => {
    const {cookie} = makeDevice(); expect((await call('/api/push/key', {cookie, method: 'DELETE'})).status).toBe(405); expect((await call('/api/push/privada', {cookie})).status).toBe(404);
    expect((await call('/api/alerts/prefs', {cookie, method: 'POST', body: DEFAULT_ALERT_PREFS})).status).toBe(200);
  });
  it('chave VAPID: só a pública; a privada nunca aparece em nenhuma resposta', async () => {
    const {cookie} = makeDevice(), key = await get<{publicKey: string}>('/api/push/key', cookie);
    expect(Object.keys(key)).toEqual(['publicKey']); expect(Buffer.from(key.publicKey, 'base64url')).toHaveLength(65);
    const vapid = ensureVapid(dirPath, box); expect(vapid.publicKey).toBe(key.publicKey); expect(vapid.regenerated).toBe(false);
    const all = [(await call('/api/push/key', {cookie})).body, (await call('/api/me', {cookie})).body, (await call('/api/alerts/prefs', {cookie})).body, JSON.stringify(hub.status()), JSON.stringify(hub.devices())].join('|');
    expect(all).not.toContain(vapid.privateKey); expect(all.toLowerCase()).not.toContain('privatekey');
  });
  it('prefs: padrão, gravação validada e isolamento por aparelho', async () => {
    const a = makeDevice('A'), b = makeDevice('B');
    expect(await get<AlertPrefs>('/api/alerts/prefs', a.cookie)).toEqual(DEFAULT_ALERT_PREFS);
    const want: AlertPrefs = {shiny: false, p5: true, recorde: true, notaMin: 7, contaCaiu: false}, saved = await post('/api/alerts/prefs', a.cookie, want);
    expect(saved.status).toBe(200); expect(JSON.parse(saved.body)).toEqual(want); expect(await get<AlertPrefs>('/api/alerts/prefs', a.cookie)).toEqual(want); expect(await get<AlertPrefs>('/api/alerts/prefs', b.cookie)).toEqual(DEFAULT_ALERT_PREFS);
    for (const bad of [{}, {...want, notaMin: 11}, {...want, shiny: 'sim'}, {...want, extra: true}, [1]]) expect((await post('/api/alerts/prefs', a.cookie, bad)).status).toBe(400);
    expect(await get<AlertPrefs>('/api/alerts/prefs', a.cookie)).toEqual(want);
  });
  it('assinatura de OUTRO aparelho: 409 e o dono continua com ela', async () => {
    const a = makeDevice(), b = makeDevice(), r = receiver(), sub = r.sub('hijack');
    expect((await post('/api/push/subscribe', a.cookie, sub)).status).toBe(200);
    expect((await post('/api/push/subscribe', b.cookie, sub)).status).toBe(409);
    expect(hub.store.pushOf(a.id).map(s => s.endpoint)).toEqual([sub.endpoint]); expect(hub.store.pushOf(b.id)).toEqual([]);
    expect((await post('/api/push/subscribe', a.cookie, sub)).status).toBe(200); expect(hub.store.pushCount(a.id)).toBe(1);
  });
  it('subscribe: só endpoints da allowlist com chaves válidas; máx. 2 por aparelho; unsubscribe remove', async () => {
    const {id, cookie} = makeDevice(), r = receiver(), good = r.sub('um');
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://[::1]/x', 'https://10.0.0.1/x', 5, null]) expect((await post('/api/push/subscribe', cookie, {...good, endpoint})).status, String(endpoint)).toBe(400);
    expect((await post('/api/push/subscribe', cookie, {endpoint: good.endpoint, keys: {p256dh: 'x', auth: 'y'}})).status).toBe(400); expect((await post('/api/push/subscribe', cookie, {endpoint: good.endpoint})).status).toBe(400); expect((await post('/api/push/subscribe', cookie, {endpoint: good.endpoint, keys: 'x'})).status).toBe(400);
    expect(hub.store.pushCount(id)).toBe(0);
    expect(JSON.parse((await post('/api/push/subscribe', cookie, good)).body)).toEqual({ok: true}); expect(hub.store.pushCount(id)).toBe(1);
    await post('/api/push/subscribe', cookie, good); expect(hub.store.pushCount(id)).toBe(1); // o mesmo endpoint não duplica
    await post('/api/push/subscribe', cookie, r.sub('dois')); await post('/api/push/subscribe', cookie, r.sub('tres'));
    expect(hub.store.pushOf(id).map(s => s.endpoint.split('/').pop())).toEqual(['dois', 'tres']); // a mais antiga saiu
    expect(JSON.parse((await post('/api/push/unsubscribe', cookie, {endpoint: r.sub('dois').endpoint})).body)).toEqual({ok: true}); expect(hub.store.pushCount(id)).toBe(1);
    expect((await post('/api/push/unsubscribe', cookie, {})).status).toBe(400); expect((await post('/api/push/unsubscribe', cookie, {endpoint: 'https://evil.com/x'})).status).toBe(200); // nada a remover; sem erro
    expect(hub.devices().find(d => d.id === id)?.push).toBe(1);
  });
  it('um aparelho não remove a assinatura de outro', async () => {
    const a = makeDevice('A'), b = makeDevice('B'), s = await subscribe(a.cookie, 'a1');
    await post('/api/push/unsubscribe', b.cookie, {endpoint: s.body.endpoint}); expect(hub.store.pushCount(a.id)).toBe(1);
  });
  it('push/test: envia só às assinaturas do aparelho, payload ≤ 1 KB com url da allowlist; 3 a cada 10 min (429)', async () => {
    const a = makeDevice('A'), b = makeDevice('B'); await subscribe(a.cookie, 'a1'); await subscribe(a.cookie, 'a2'); await subscribe(b.cookie, 'b1');
    expect(JSON.parse((await post('/api/push/test', a.cookie)).body)).toEqual({sent: 2}); expect(sentPush).toHaveLength(2);
    for (const p of sentPush) { expect(p.url).toMatch(/\/a[12]$/); expect(p.body.length).toBeLessThan(PUSH_MAX_BYTES + 200); expect(p.headers['Content-Encoding']).toBe('aes128gcm'); }
    for (const m of decoded()) { expect(PUSH_URL_PATTERN.test(m.url)).toBe(true); expect(Object.keys(m).sort()).toEqual(['at', 'kind', 'label', 'text', 'url']); expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThanOrEqual(PUSH_MAX_BYTES); }
    expect((await post('/api/push/test', a.cookie)).status).toBe(200); expect((await post('/api/push/test', a.cookie)).status).toBe(200);
    expect((await post('/api/push/test', a.cookie)).status).toBe(429); expect((await post('/api/push/test', b.cookie)).status).toBe(200); // o limite é por aparelho
    clock += 11 * 60_000; expect((await post('/api/push/test', a.cookie)).status).toBe(200);
  });
  it('push/test sem assinatura → {sent:0}; serviço que recusa (403) → {sent:0} e conta falha', async () => {
    const {id, cookie} = makeDevice(); expect(JSON.parse((await post('/api/push/test', cookie)).body)).toEqual({sent: 0});
    await subscribe(cookie, 'x'); status = 403; expect(JSON.parse((await post('/api/push/test', cookie)).body)).toEqual({sent: 0}); expect(hub.store.pushOf(id)[0]!.failCount).toBe(1);
  });
  it('/api/captures: nome/cor da conta, sem hints nem emailLabel; filtros e limites validados', async () => {
    const {cookie} = makeDevice(); src.set([cap(), cap({profileId: 'acc-2', name: 'Eevee', shiny: false, potencia: 1})]);
    const out = await get<{captures: Record<string, unknown>[]}>('/api/captures?limit=10', cookie);
    expect(out.captures).toHaveLength(2); expect(out.captures[0]).toMatchObject({profileId: 'acc-1', label: 'Principal', color: '#d4a65f', name: 'Pikachu', shiny: true}); expect(out.captures[0]).not.toHaveProperty('hints');
    const text = JSON.stringify(out); expect(text).not.toContain('emailLabel'); expect(text).not.toContain(SECRET_EMAIL); expect(text).not.toContain('dica-interna');
    expect((await get<{captures: unknown[]}>('/api/captures?profileId=acc-2', cookie)).captures).toHaveLength(1);
    await get('/api/captures?onlyAlerts=1&limit=200', cookie); expect(src.queries.at(-1)).toMatchObject({onlyAlerts: true, limit: 200});
    for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'limit=1.5', 'onlyAlerts=2']) expect((await call(`/api/captures?${q}`, {cookie})).status, q).toBe(400);
    expect((await call('/api/captures?profileId=nao-existe', {cookie})).status).toBe(404);
  });
});

describe('alertas: leitor de capturas, SSE e push de ponta a ponta', () => {
  beforeEach(setup); afterEach(teardown);
  it('o leitor só liga com acesso remoto escutando e (push assinado ou SSE aberto)', async () => {
    const a = makeDevice('A'); expect(src.count()).toBe(0);
    const s = await sse(a.cookie); expect(src.count()).toBe(1); s.close(); await tick(80); expect(src.count()).toBe(0);
    await subscribe(a.cookie, 'a1'); expect(src.count()).toBe(1);
    await post('/api/push/unsubscribe', a.cookie, {endpoint: receiver().sub('zzz').endpoint}); expect(src.count()).toBe(1); // outro endpoint: nada mudou
    await post('/api/push/unsubscribe', a.cookie, {endpoint: [...receivers.keys()][0]}); expect(src.count()).toBe(0);
    await subscribe(a.cookie, 'a2'); expect(src.count()).toBe(1);
    await hub.setEnabled(false); expect(src.count()).toBe(0);
    await hub.setEnabled(true); expect(src.count()).toBe(1); // ainda há assinatura e o acesso voltou
  });
  it('revogar o aparelho apaga assinaturas e preferências e desliga o leitor', async () => {
    const a = makeDevice('A'); await subscribe(a.cookie, 'a1'); await post('/api/alerts/prefs', a.cookie, {...DEFAULT_ALERT_PREFS, recorde: true});
    expect(src.count()).toBe(1); expect(rows('SELECT * FROM remote_push')).toHaveLength(1); expect(rows('SELECT * FROM remote_alert_prefs')).toHaveLength(1);
    expect(hub.revoke(a.id)).toBe(true); expect(rows('SELECT * FROM remote_push')).toHaveLength(0); expect(rows('SELECT * FROM remote_alert_prefs')).toHaveLength(0); expect(src.count()).toBe(0);
  });
  it('expirar o aparelho (30 dias sem uso) também apaga assinaturas e preferências', async () => {
    const a = makeDevice('A'); await subscribe(a.cookie, 'a1'); await post('/api/alerts/prefs', a.cookie, DEFAULT_ALERT_PREFS);
    clock += 31 * 86_400_000; expect((await call('/api/me', {cookie: a.cookie})).status).toBe(401);
    expect(rows('SELECT * FROM remote_devices')).toHaveLength(0); expect(rows('SELECT * FROM remote_push')).toHaveLength(0); expect(rows('SELECT * FROM remote_alert_prefs')).toHaveLength(0); expect(src.count()).toBe(0);
  });
  it('sair (logout) apaga as assinaturas do aparelho', async () => {
    const a = makeDevice('A'); await subscribe(a.cookie, 'a1'); expect((await post('/api/logout', a.cookie)).status).toBe(200); expect(rows('SELECT * FROM remote_push')).toHaveLength(0);
  });
  it('captura nova: SSE `capture` + `alert`, histórico e push cifrado; nada de emailLabel em lugar nenhum', async () => {
    const a = makeDevice('A'), s = await sse(a.cookie); await subscribe(a.cookie, 'a1');
    src.emit([cap(), cap({name: 'Comum', shiny: false, potencia: 1, nota: 2, time: '09:59', at: '2026-11-23T09:59:00.000Z'})]);
    await s.until('event: alert'); await tick(50);
    const text = s.text(), capFrame = /event: capture\ndata: (.+)\n/.exec(text)!, alertFrame = /event: alert\ndata: (.+)\n/.exec(text)!;
    const captures = JSON.parse(capFrame[1]!) as {captures: Record<string, unknown>[]}; expect(captures.captures).toHaveLength(2); expect(captures.captures[0]).toMatchObject({label: 'Principal', color: '#d4a65f'}); expect(captures.captures[0]).not.toHaveProperty('hints');
    const alert = JSON.parse(alertFrame[1]!) as RemoteAlert; expect(alert).toMatchObject({kind: 'shiny', profileId: 'acc-1', label: 'Principal'}); expect(alert.text.length).toBeLessThanOrEqual(120); expect(alert.text).toContain('Pikachu'); expect(alert.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((text.match(/event: alert/g) ?? []).length).toBe(1); // só a captura alertável vira alerta
    const history = await get<{alerts: RemoteAlert[]}>('/api/alerts?limit=5', a.cookie); expect(history.alerts).toEqual([alert]);
    expect(decoded()).toHaveLength(1); expect(decoded()[0]).toMatchObject({kind: 'shiny', label: 'Principal', url: '#alertas', at: alert.at}); expect(decoded()[0]!.text).toBe(alert.text);
    const everything = [text, JSON.stringify(history), ...sentPush.map(p => receivers.get(p.url)!.decrypt(p.body)), (await call('/api/captures', {cookie: a.cookie})).body, JSON.stringify(hub.alerts()), JSON.stringify(hub.devices())].join('|');
    expect(everything).not.toContain('emailLabel'); expect(everything).not.toContain(SECRET_EMAIL); expect(everything).not.toContain('dica-interna'); expect(everything).not.toContain('outro@exemplo.com');
    s.close();
  });
  it('preferências por aparelho: shiny desligado não recebe nem SSE nem push; recorde ligado recebe', async () => {
    const a = makeDevice('A'), b = makeDevice('B'); await post('/api/alerts/prefs', a.cookie, {...DEFAULT_ALERT_PREFS, shiny: false, p5: false, recorde: true});
    const sa = await sse(a.cookie), sb = await sse(b.cookie); await subscribe(a.cookie, 'a1'); await subscribe(b.cookie, 'b1');
    src.emit([cap({name: 'Brilhante'})]); await sb.until('event: alert'); await tick(60);
    expect(sa.text()).not.toContain('event: alert'); expect(sa.text()).toContain('event: capture'); expect(decoded().map(m => m.text)).toHaveLength(1); expect(sentPush[0]!.url).toContain('/b1');
    src.emit([cap({name: 'Recordista', shiny: false, potencia: 2, record: true, time: '10:05', at: '2026-11-23T10:05:00.000Z'})]); await sa.until('event: alert'); await tick(60);
    expect(sentPush.some(p => p.url.endsWith('/a1'))).toBe(true); expect(sentPush.filter(p => p.url.endsWith('/b1'))).toHaveLength(1); // b (recorde desligado) só recebeu o shiny
    sa.close(); sb.close();
  });
  it('nota mínima por aparelho: só vira alerta quando a nota alcança o mínimo dele', async () => {
    const a = makeDevice('A'); await post('/api/alerts/prefs', a.cookie, {...DEFAULT_ALERT_PREFS, shiny: false, p5: false, notaMin: 9}); await subscribe(a.cookie, 'a1');
    src.emit([cap({shiny: false, potencia: 2, nota: 8})]); await tick(60); expect(sentPush).toHaveLength(0);
    src.emit([cap({shiny: false, potencia: 2, nota: 9.5, time: '10:07', at: '2026-11-23T10:07:00.000Z'})]); await tick(60); expect(sentPush).toHaveLength(1); expect(decoded()[0]!.kind).toBe('nota');
  });
  it('agrupamento: 1 push por aparelho e tipo a cada 2 min; o próximo diz "+N"', async () => {
    const a = makeDevice('A'); await subscribe(a.cookie, 'a1');
    for (let i = 0; i < 4; i++) src.emit([cap({name: `Shiny${i}`, time: `10:0${i}`, at: `2026-11-23T10:0${i}:00.000Z`})]);
    await tick(80); expect(sentPush).toHaveLength(1); expect(decoded()[0]!.text).not.toContain('(+');
    clock += GROUP_MS - 1; src.emit([cap({name: 'Cedo', time: '10:10', at: '2026-11-23T10:10:00.000Z'})]); await tick(60); expect(sentPush).toHaveLength(1);
    clock += 2; src.emit([cap({name: 'Tarde', time: '10:11', at: '2026-11-23T10:11:00.000Z'})]); await tick(60); expect(sentPush).toHaveLength(2); expect(decoded()[1]!.text).toMatch(/Tarde.*\(\+4\)$/);
    src.emit([cap({name: 'PotCinco', shiny: false, time: '10:12', at: '2026-11-23T10:12:00.000Z'})]); await tick(60); expect(sentPush).toHaveLength(3); // outro tipo (p5) tem a própria janela
    expect(decoded().every(m => Buffer.byteLength(JSON.stringify(m)) <= PUSH_MAX_BYTES)).toBe(true);
  });
  it('404/410 do serviço apaga a assinatura; falhas repetidas apagam depois de 5', async () => {
    const a = makeDevice('A'); await subscribe(a.cookie, 'a1'); status = 410; await post('/api/push/test', a.cookie); expect(hub.store.pushCount(a.id)).toBe(0); expect(src.count()).toBe(0);
    await subscribe(a.cookie, 'a2'); status = 500; for (let i = 0; i < FAIL_LIMIT - 1; i++) { clock += 11 * 60_000; await post('/api/push/test', a.cookie); }
    expect(hub.store.pushOf(a.id)[0]!.failCount).toBe(FAIL_LIMIT - 1); clock += 11 * 60_000; await post('/api/push/test', a.cookie); expect(hub.store.pushCount(a.id)).toBe(0);
    await subscribe(a.cookie, 'a3'); status = 500; clock += 11 * 60_000; await post('/api/push/test', a.cookie); status = 201; clock += 11 * 60_000; await post('/api/push/test', a.cookie); expect(hub.store.pushOf(a.id)[0]!.failCount).toBe(0); // sucesso zera
  });
  it('IPC do PC: pushTest e histórico; aparelho sem notificação recusa', async () => {
    const a = makeDevice('A'); await expect(hub.pushTest(a.id)).rejects.toThrow('não ativou'); await expect(hub.pushTest('x')).rejects.toThrow('não encontrado');
    await subscribe(a.cookie, 'a1'); expect(await hub.pushTest(a.id)).toEqual({sent: 1}); await hub.pushTest(a.id); await hub.pushTest(a.id); await expect(hub.pushTest(a.id)).rejects.toThrow('Aguarde');
    expect(hub.devices().find(d => d.id === a.id)?.push).toBe(1); expect(hub.alerts()).toEqual([]);
  });
});

// ---------- Banco ----------
describe('alertas: banco (v13)', () => {
  it('migração cria as tabelas, aceita 0–13 e as chaves estrangeiras apagam em cascata', () => {
    const path = join(root, `m${++n}.sqlite`); openDatabase(path).close();
    const db = openDatabase(path); expect(db.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 16}); expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({foreign_keys: 1});
    db.exec("INSERT INTO remote_devices (id, name, token_hash, created_at) VALUES ('d','N','h','t'); INSERT INTO remote_push (id, device_id, endpoint, p256dh, auth, created_at) VALUES ('p','d','https://fcm.googleapis.com/x','a','b','t'); INSERT INTO remote_alert_prefs VALUES ('d','{}')");
    expect(() => db.exec("INSERT INTO remote_push (id, device_id, endpoint, p256dh, auth, created_at) VALUES ('q','nao','https://fcm.googleapis.com/y','a','b','t')")).toThrow(); // FK
    expect(() => db.exec("INSERT INTO remote_push (id, device_id, endpoint, p256dh, auth, created_at) VALUES ('r','d','https://fcm.googleapis.com/x','a','b','t')")).toThrow(); // endpoint UNIQUE
    db.exec("DELETE FROM remote_devices WHERE id='d'");
    expect(db.prepare('SELECT COUNT(*) AS n FROM remote_push').get()).toMatchObject({n: 0}); expect(db.prepare('SELECT COUNT(*) AS n FROM remote_alert_prefs').get()).toMatchObject({n: 0});
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='remote_alerts_at'").get()).toBeTruthy(); db.close();
  });
  it('v12 → v13 não apaga nada', () => {
    const path = join(root, `m${++n}.sqlite`); openDatabase(path).close();
    const raw = new DatabaseSync(path); raw.exec("INSERT INTO profiles VALUES ('p1','Conta','e','c','#fff','t','t'); INSERT INTO remote_devices (id, name, token_hash, created_at) VALUES ('d','N','h','t'); DROP TABLE remote_push; DROP TABLE remote_alert_prefs; DROP TABLE remote_alerts; PRAGMA user_version=12"); raw.close();
    openDatabase(path).close(); const check = new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 16});
    expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label: 'Conta'}); expect(check.prepare('SELECT id FROM remote_devices').get()).toMatchObject({id: 'd'}); expect(check.prepare('SELECT COUNT(*) AS n FROM remote_alerts').get()).toMatchObject({n: 0}); check.close();
  });
  it('histórico: 7 dias e no máximo 1000 linhas, mais novas primeiro', () => {
    const path = join(root, `m${++n}.sqlite`), store = new RemoteStore(path), base = Date.parse('2026-11-23T12:00:00.000Z');
    const mk = (i: number, at: number): RemoteAlert => ({id: `a${i}`, at: new Date(at).toISOString(), kind: 'shiny', profileId: 'acc-1', label: 'L', text: `t${i}`});
    store.addAlert(mk(0, base - 8 * 86_400_000), base); store.addAlert(mk(1, base - 6 * 86_400_000), base); expect(store.listAlerts(10).map(a => a.id)).toEqual(['a1']); // a de 8 dias sai na poda
    for (let i = 2; i < ALERTS_KEEP + 30; i++) store.addAlert(mk(i, base + i * 1000), base + i * 1000);
    const raw = new DatabaseSync(path), all = raw.prepare('SELECT COUNT(*) AS n FROM remote_alerts').get(); raw.close(); expect(all).toMatchObject({n: ALERTS_KEEP}); expect(store.listAlerts(3).map(a => a.id)).toEqual([`a${ALERTS_KEEP + 29}`, `a${ALERTS_KEEP + 28}`, `a${ALERTS_KEEP + 27}`]);
    expect(store.listAlerts(9999)).toHaveLength(200); store.close();
  }, 60_000);
  it('máx. 2 assinaturas por aparelho; endpoint de outro aparelho é recusado', () => {
    const path = join(root, `m${++n}.sqlite`), store = new RemoteStore(path);
    for (const id of ['d1', 'd2']) store.addDevice({id, name: id, tokenHash: id, now: new Date().toISOString()});
    const sub = (e: string) => ({endpoint: `https://fcm.googleapis.com/${e}`, p256dh: 'p', auth: 'a'});
    store.addPush('d1', sub('1'), 'i1', 't1'); store.addPush('d1', sub('2'), 'i2', 't2'); store.addPush('d1', sub('3'), 'i3', 't3');
    expect(store.pushOf('d1').map(s => s.id)).toEqual(['i2', 'i3']); expect(store.addPush('d2', sub('2'), 'i4', 't4')).toBe('conflito'); expect(store.pushOf('d1').map(s => s.id)).toEqual(['i2', 'i3']); expect(store.pushOf('d2')).toEqual([]); expect(store.addPush('d1', sub('2'), 'i5', 't5')).toBe('ok');
    store.setPrefs('d1', DEFAULT_ALERT_PREFS); expect(store.getPrefs('d1')).toEqual(DEFAULT_ALERT_PREFS); expect(store.revokeDevice('d1')).toBe(true); expect(store.pushOf('d1')).toEqual([]); expect(store.getPrefs('d1')).toBeNull(); store.close();
  });
});

// ---------- Motor: conta caiu / voltou (relógio e temporizador falsos) ----------
describe('alertas: conta caiu / voltou', () => {
  let t = 0, timers: {at: number; fn: () => void; id: number}[] = [], store: RemoteStore, engine: AlertEngine, published: {event: string; data: unknown}[] = [], sends: PushSub[] = [], running = true;
  const advance = (ms: number) => { const end = t + ms; for (;;) { const next = timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; timers = timers.filter(x => x !== next); t = next.at; next.fn(); } t = end; };
  let idc = 0;
  const fakePush = {publicKey: 'x', regenerated: false, send: async (sub: PushSub): Promise<SendResult> => { sends.push(sub); return 'ok'; }} as unknown as Push;
  beforeEach(() => {
    t = Date.parse('2026-11-23T10:00:00.000Z'); timers = []; published = []; sends = []; running = true;
    store = new RemoteStore(join(root, `e${++n}.sqlite`)); store.addDevice({id: 'd1', name: 'A', tokenHash: 'h', now: new Date(t).toISOString()}); store.addPush('d1', {endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a'}, 'p1', 't');
    engine = createAlertEngine({store, push: () => fakePush, captures: fakeSource().source, profiles: () => profiles, running: () => running, streams: () => 0, publish: (event, data) => { published.push({event, data}); }, now: () => t, setTimer: (fn, ms) => { const id = ++idc; timers.push({at: t + ms, fn, id}); return id; }, clearTimer: h => { timers = timers.filter(x => x.id !== h); }});
  });
  afterEach(() => { engine.close(); store.close(); });
  const kinds = () => published.filter(p => p.event === 'alert').map(p => (p.data as RemoteAlert).kind);
  it('só avisa depois de 5 min contínuos fora; "loading" não zera o relógio; voltar a "ready" avisa "voltou"', async () => {
    engine.reportState('acc-1', 'error'); advance(DOWN_AFTER_MS - 1000); expect(kinds()).toEqual([]);
    engine.reportState('acc-1', 'loading'); engine.reportState('acc-1', 'offline'); engine.reportState('acc-1', 'error'); advance(500); expect(kinds()).toEqual([]);
    advance(600); await tick(5); expect(kinds()).toEqual(['conta_caiu']); expect(published[0]!.data).toMatchObject({kind: 'conta_caiu', profileId: 'acc-1', label: 'Principal'});
    advance(10 * 60_000); engine.reportState('acc-1', 'error'); await tick(5); expect(kinds()).toEqual(['conta_caiu']); // sem repetir
    engine.reportState('acc-1', 'loading'); await tick(5); expect(kinds()).toEqual(['conta_caiu']);
    engine.reportState('acc-1', 'ready'); await tick(5); expect(kinds()).toEqual(['conta_caiu', 'conta_voltou']);
    expect(sends).toHaveLength(2); expect(store.listAlerts(5).map(a => a.kind)).toEqual(['conta_voltou', 'conta_caiu']);
    engine.reportState('acc-1', 'ready'); await tick(5); expect(kinds()).toHaveLength(2);
  });
  it('recuperar antes de 5 min não gera nada; suspender limpa sem "voltou"; o payload usa #conta/<id>', async () => {
    engine.reportState('acc-1', 'error'); advance(4 * 60_000); engine.reportState('acc-1', 'ready'); advance(10 * 60_000); await tick(5); expect(kinds()).toEqual([]);
    engine.reportState('acc-2', 'error'); advance(DOWN_AFTER_MS + 1); await tick(5); expect(kinds()).toEqual(['conta_caiu']); engine.reportState('acc-2', 'suspended'); await tick(5); expect(kinds()).toEqual(['conta_caiu']);
    engine.reportState('acc-2', 'error'); advance(DOWN_AFTER_MS + 1); await tick(5); expect(kinds()).toEqual(['conta_caiu', 'conta_caiu']);
  });
  it('preferência "conta caiu" desligada: nada é publicado; acesso remoto parado: nada é gravado', async () => {
    store.setPrefs('d1', {...DEFAULT_ALERT_PREFS, contaCaiu: false}); engine.reportState('acc-1', 'error'); advance(DOWN_AFTER_MS + 1); await tick(5); expect(kinds()).toEqual([]); expect(store.listAlerts(5)).toEqual([]);
    store.setPrefs('d1', DEFAULT_ALERT_PREFS); running = false; engine.reportState('acc-2', 'error'); advance(DOWN_AFTER_MS + 1); await tick(5); expect(store.listAlerts(5)).toEqual([]);
  });
  it('conta desconhecida (removida) não gera alerta', async () => {
    engine.reportState('fantasma', 'error'); advance(DOWN_AFTER_MS + 1); await tick(5); expect(kinds()).toEqual([]);
  });
});
