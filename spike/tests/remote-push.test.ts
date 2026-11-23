import { afterAll, describe, expect, it } from 'vitest';
import { createECDH, createPublicKey, hkdfSync, createDecipheriv, randomBytes, verify } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_MAX_BYTES, PUSH_TIMEOUT_MS, VAPID_SUBJECT, buildPayload, createPush, ensureVapid, validKeys, validPushUrl, validateEndpoint, type PushFetch } from '../remote/push';
import type { SecretBox } from '../remote/certs';
import { PUSH_URL_PATTERN } from '../contracts/remote';

const root = mkdtempSync(join(tmpdir(), 'pokehub-push-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));
let n = 0;
const dir = () => join(root, `d${++n}`);
const box: SecretBox = {encrypt: s => Buffer.from(s, 'utf8').reverse(), decrypt: b => Buffer.from(b).reverse().toString('utf8')};

/** Receptor de teste (o navegador): chave P-256 e segredo de autenticação de 16 bytes. */
function receiver() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {ecdh, auth, sub: (endpoint: string) => ({endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url')})};
}
/** Decifra o corpo aes128gcm do Web Push (RFC 8291 + RFC 8188), como o navegador faz. */
function decrypt(body: Buffer, r: ReturnType<typeof receiver>): string {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20]!, asPub = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  expect(rs).toBeGreaterThanOrEqual(cipher.length);
  const uaPub = r.ecdh.getPublicKey(), secret = r.ecdh.computeSecret(asPub);
  const prk = Buffer.from(hkdfSync('sha256', secret, r.auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  let end = plain.length; while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(2); // delimitador do último registro
  return plain.subarray(0, end - 1).toString('utf8');
}
interface Sent { url: string; init: Parameters<PushFetch>[1] }
const capture = (status = 201, extra?: () => void) => { const sent: Sent[] = []; const fetcher: PushFetch = async (url, init) => { sent.push({url, init}); extra?.(); return {status, body: {cancel: async () => undefined}}; }; return {sent, fetcher}; };

describe('push: allowlist de endpoints (anti-SSRF)', () => {
  const good = ['https://fcm.googleapis.com/fcm/send/abc:def', 'https://fcm.googleapis.com:443/wp/xyz', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'https://web.push.apple.com/QGAAA', 'https://api.push.apple.com/3/device/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc', 'https://foo.push.services.mozilla.com/x', 'https://FCM.GoogleAPIs.com/x'];
  const bad = [
    'http://fcm.googleapis.com/x', 'ftp://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com:80/x',
    'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.0.1:443/x', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://2130706433/x', 'https://0x7f.0.0.1/x', 'https://169.254.169.254/latest/meta-data',
    'https://user@fcm.googleapis.com/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com@evil.com/x', 'https://evil.com\\@fcm.googleapis.com/x', 'https://evil.com#@fcm.googleapis.com/x',
    'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x', 'https://fcm-googleapis.com/x', 'https://notfcm.googleapis.com.example/x', 'https://evil.com/fcm.googleapis.com', 'https://xpush.apple.com/x', 'https://push.apple.com/x', 'https://notify.windows.com/x',
    'https://evilnotify.windows.com/x', 'https://x.notify.windows.com.evil.com/x', 'https://fcm.googleapis.com./x', 'https://localhost/x', 'https://metadata.google.internal/x', 'https://updates.push.services.mozilla.com/x#frag',
    '', ' https://fcm.googleapis.com/x', 'https://fcm.googleapis.com/x y', 'javascript:alert(1)', '//fcm.googleapis.com/x', '/fcm/send/x', `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
  ];
  it.each(good)('aceita %s', endpoint => { const url = validateEndpoint(endpoint); expect(url).not.toBeNull(); expect(url!.protocol).toBe('https:'); });
  it.each(bad)('recusa %j', endpoint => { expect(validateEndpoint(endpoint)).toBeNull(); });
  it('recusa tipos que não são texto', () => { for (const v of [null, undefined, 1, {}, [], ['https://fcm.googleapis.com/x']]) expect(validateEndpoint(v)).toBeNull(); });
  it('chaves da assinatura: p256dh de 65 bytes (ponto não comprimido) e auth de 16', () => {
    const r = receiver(), sub = r.sub('https://fcm.googleapis.com/x');
    expect(validKeys(sub.p256dh, sub.auth)).toBe(true);
    expect(validKeys(sub.p256dh, randomBytes(15).toString('base64url'))).toBe(false); expect(validKeys(randomBytes(64).toString('base64url'), sub.auth)).toBe(false);
    expect(validKeys('???', sub.auth)).toBe(false); expect(validKeys(1, 2)).toBe(false); expect(validKeys(Buffer.concat([Buffer.from([3]), randomBytes(64)]).toString('base64url'), sub.auth)).toBe(false);
  });
});

describe('push: payload', () => {
  it('JSON com os 5 campos, ≤ 1 KB, e a url só da allowlist', () => {
    const body = buildPayload({kind: 'shiny', label: 'Principal', text: 'Shiny: Pikachu Nv 20', at: '2026-11-23T10:00:00.000Z', url: '#alertas'});
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['at', 'kind', 'label', 'text', 'url']); expect(Buffer.byteLength(body)).toBeLessThanOrEqual(PUSH_MAX_BYTES);
    for (const url of ['#alertas', '#contas', '#conta/abc-123']) expect(validPushUrl(url)).toBe(true);
    for (const url of ['https://evil.com', 'javascript:alert(1)', '#conta/', '#conta/../x', '#outra', '//evil.com', '#alertas?x=1', '', null, 5]) expect(validPushUrl(url), String(url)).toBe(false);
    expect(() => buildPayload({kind: 'shiny', label: 'a', text: 'b', at: 'x', url: 'https://evil.com'})).toThrow();
    expect(PUSH_URL_PATTERN.test('#alertas')).toBe(true);
  });
  it('texto enorme é cortado para caber em 1 KB; rótulo longo também', () => {
    const body = buildPayload({kind: 'p5', label: 'L'.repeat(5000), text: 'x'.repeat(5000), at: '2026-11-23T10:00:00.000Z', url: '#contas'});
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(PUSH_MAX_BYTES); expect(JSON.parse(body).text.length).toBeLessThanOrEqual(120);
  });
});

describe('push: chave VAPID', () => {
  it('é gerada uma vez e reaproveitada; a privada fica cifrada com o safeStorage e nunca em texto', () => {
    const d = dir(), a = ensureVapid(d, box), b = ensureVapid(d, box);
    expect(a.regenerated).toBe(true); expect(b.regenerated).toBe(false); expect(b).toMatchObject({publicKey: a.publicKey, privateKey: a.privateKey});
    const file = readFileSync(join(d, 'vapid.key')); expect(file.toString('latin1')).not.toContain(a.privateKey); expect(file.subarray(0, 6).toString()).toBe('PHENC1');
    expect(readFileSync(join(d, 'vapid.pub'), 'utf8')).toBe(a.publicKey); expect(Buffer.from(a.publicKey, 'base64url')).toHaveLength(65);
  });
  it('se não dá para abrir a chave cifrada (outra máquina), refaz e avisa; sem cifra grava com marca de texto', () => {
    const d = dir(), a = ensureVapid(d, box), other: SecretBox = {encrypt: box.encrypt, decrypt: () => { throw new Error('x'); }};
    const c = ensureVapid(d, other); expect(c.regenerated).toBe(true); expect(c.replaced).toBe(true); expect(a.replaced).toBe(false); expect(c.publicKey).not.toBe(a.publicKey);
    const d2 = dir(), p = ensureVapid(d2); expect(readFileSync(join(d2, 'vapid.key'), 'utf8')).toContain(p.privateKey); expect(ensureVapid(d2).regenerated).toBe(false);
    expect(ensureVapid(d2, box).regenerated).toBe(false); expect(readFileSync(join(d2, 'vapid.key'), 'latin1')).not.toContain(p.privateKey); // havia texto e agora há cifra: sobe de nível
  });
  it('arquivo adulterado/ilegível → refaz', () => {
    const d = dir(); ensureVapid(d, box); const original = readFileSync(join(d, 'vapid.pub'), 'utf8');
    rmSync(join(d, 'vapid.key')); expect(existsSync(join(d, 'vapid.key'))).toBe(false);
    expect(ensureVapid(d, box).publicKey).not.toBe(original);
  });
});

describe('push: envio', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/xyz';
  it('JWT ES256 válido: aud do serviço, sub genérico, exp ≤ 12 h; assinatura confere com a chave pública', async () => {
    const r = receiver(), {sent, fetcher} = capture(), push = createPush({dir: dir(), box, fetcher}), t0 = Math.floor(Date.now() / 1000);
    expect(await push.send(r.sub(ENDPOINT), '{"a":1}')).toBe('ok');
    const auth = sent[0]!.init.headers.Authorization!, m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth); expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!; expect(k).toBe(push.publicKey);
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({typ: 'JWT', alg: 'ES256'});
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as {aud: string; exp: number; sub: string};
    expect(claims.aud).toBe('https://fcm.googleapis.com'); expect(claims.sub).toBe(VAPID_SUBJECT); expect(claims.sub).toBe('mailto:pokehub@example.com'); expect(claims.sub).not.toContain('localhost');
    expect(claims.exp).toBeGreaterThan(t0); expect(claims.exp - t0).toBeLessThanOrEqual(12 * 3600 + 5);
    const raw = Buffer.from(push.publicKey, 'base64url'), key = createPublicKey({key: {kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url')}, format: 'jwk'});
    expect(verify('sha256', Buffer.from(`${h}.${c}`), {key, dsaEncoding: 'ieee-p1363'}, Buffer.from(sig!, 'base64url'))).toBe(true);
  });
  it('cifra por RFC 8291 (aes128gcm): o receptor recupera o payload; só o JSON vai pela rede', async () => {
    const r = receiver(), {sent, fetcher} = capture(), push = createPush({dir: dir(), box, fetcher});
    const body = buildPayload({kind: 'shiny', label: 'Principal', text: 'Shiny: Pikachu Nv 20 P5', at: '2026-11-23T10:00:00.000Z', url: '#alertas'});
    expect(await push.send(r.sub(ENDPOINT), body, 'high')).toBe('ok');
    const req = sent[0]!, headers = req.init.headers;
    expect(headers['Content-Encoding']).toBe('aes128gcm'); expect(String(headers.TTL)).toBe('3600'); expect(headers.Urgency).toBe('high');
    expect(req.init.body.includes(Buffer.from('Pikachu'))).toBe(false); // nada em claro
    expect(decrypt(req.init.body, r)).toBe(body);
  });
  it('transporte: https normalizado, POST, redirect:error, timeout de 5 s, sem credenciais; endpoint ruim nem chega à rede', async () => {
    const r = receiver(), {sent, fetcher} = capture(), push = createPush({dir: dir(), box, fetcher});
    await push.send(r.sub('https://FCM.googleapis.com:443/x'), '{}');
    expect(sent[0]!.url).toBe('https://fcm.googleapis.com/x'); expect(sent[0]!.init).toMatchObject({method: 'POST', redirect: 'error', credentials: 'omit'}); expect(sent[0]!.init.signal).toBeInstanceOf(AbortSignal); expect(PUSH_TIMEOUT_MS).toBe(5000);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x']) expect(await push.send(r.sub(bad), '{}')).toBe('rejected');
    expect(await push.send({...r.sub(ENDPOINT), auth: 'curto'}, '{}')).toBe('rejected'); expect(await push.send(r.sub(ENDPOINT), 'x'.repeat(2000))).toBe('rejected');
    expect(sent).toHaveLength(1);
  });
  it('404/410 = gone; 5xx/429 = fail; erro de rede, redirecionamento e estouro de tempo = fail (sem lançar)', async () => {
    const r = receiver(), d = dir();
    for (const [status, want] of [[201, 'ok'], [200, 'ok'], [404, 'gone'], [410, 'gone'], [500, 'fail'], [429, 'fail'], [403, 'fail'], [301, 'fail']] as const) expect(await createPush({dir: d, box, fetcher: capture(status).fetcher}).send(r.sub(ENDPOINT), '{}'), String(status)).toBe(want);
    const boom: PushFetch = async () => { throw new TypeError('redirect mode is set to error'); };
    expect(await createPush({dir: d, box, fetcher: boom}).send(r.sub(ENDPOINT), '{}')).toBe('fail');
    const slow: PushFetch = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('timeout'))));
    expect(await createPush({dir: d, box, fetcher: slow, timeoutMs: 30}).send(r.sub(ENDPOINT), '{}')).toBe('fail');
  });
  it('o corpo da resposta é descartado (cancelado), nunca lido', async () => {
    let cancelled = 0; const r = receiver(), fetcher: PushFetch = async () => ({status: 201, body: {cancel: async () => { cancelled++; }}});
    await createPush({dir: dir(), box, fetcher}).send(r.sub(ENDPOINT), '{}'); expect(cancelled).toBe(1);
  });
});
