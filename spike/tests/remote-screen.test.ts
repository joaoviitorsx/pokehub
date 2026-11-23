import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { controlDialog, createRemoteHub, type NativeConfirm, type RemoteHub } from '../remote/hub';
import { guardedSend } from '../remote/screen';
import { COOKIE } from '../remote/server';
import type { ScreenFrame, ScreenTarget, ScreenTiming } from '../remote/screen';
import type { SendInput } from '../remote/screen-input';
import { decodeFrame, type ClientMsg, type FrameHeader, type ServerMsg } from '../contracts/screen';
import type { NetSelection } from '../remote/ip';

const root = mkdtempSync(join(tmpdir(), 'pokehub-screen-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));
let n = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const HUB_KEY = {hub: true}; // identidade do "webContents do hub": jamais pode ser capturado
const accounts = [{id: 'acc-1', label: 'Principal', color: '#d4a65f', state: 'ready', suspended: false}, {id: 'acc-2', label: 'Farm', color: '#3fa7d6', state: 'ready', suspended: false}, {id: 'acc-3', label: 'Reserva', color: '#e5484d', state: 'ready', suspended: false}];

// ---------- alvo falso (no lugar do webContents) ----------
class FakeTarget implements ScreenTarget {
  key: unknown = {}; urlValue = 'https://pokeidle.io/'; password: boolean[] | boolean = false; empty = false; changing = true; open = true; captureCalls = 0; passwordCalls = 0; n = 0; inputs: SendInput[] = []; holds = 0; releases = 0;
  url() { return this.urlValue; } alive() { return this.open; } size() { return {width: 800, height: 600}; }
  async passwordFocused() { this.passwordCalls++; return Array.isArray(this.password) ? (this.password.shift() ?? false) : this.password; }
  async capture(): Promise<ScreenFrame | null> { this.captureCalls++; if (this.empty) return null; if (this.changing) this.n++; const id = this.n; return {width: 640, height: 360, hash: `h${id}`, jpeg: () => Buffer.from([0xff, 0xd8, 0xff, id & 255, 0xff, 0xd9])}; }
  input(e: SendInput) { this.inputs.push(e); }
  hold() { this.holds++; return () => { this.releases++; }; }
}

// ---------- cliente WebSocket de teste (mascarado, RFC 6455) ----------
function clientFrame(opcode: number, payload: Buffer, o: {mask?: boolean; fin?: boolean} = {}): Buffer {
  const mask = o.mask !== false, len = payload.length, key = randomBytes(4);
  const head = len < 126 ? Buffer.from([(o.fin === false ? 0 : 0x80) | opcode, (mask ? 0x80 : 0) | len]) : len < 65536 ? Buffer.from([(o.fin === false ? 0 : 0x80) | opcode, (mask ? 0x80 : 0) | 126, len >> 8, len & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = (mask ? 0x80 : 0) | 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
  const body = Buffer.from(payload); if (mask) for (let i = 0; i < len; i++) body[i] = body[i]! ^ key[i & 3]!;
  return Buffer.concat([head, mask ? key : Buffer.alloc(0), body]);
}
class TestWs {
  text: ServerMsg[] = []; frames: {header: FrameHeader; jpeg: Uint8Array}[] = []; closeCode: number | null = null; raw = 0; private buf = Buffer.alloc(0); closed: Promise<number>; private done!: (c: number) => void; pongs = 0; pings = 0;
  constructor(public socket: Duplex, head: Buffer) {
    this.closed = new Promise(r => { this.done = r; });
    socket.on('data', c => this.feed(c as Buffer)); socket.on('close', () => { this.closeCode ??= 1006; this.done(this.closeCode); }); socket.on('error', () => undefined);
    if (head.length) this.feed(head);
  }
  private feed(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const b = this.buf; if (b.length < 2) return; let len = b[1]! & 0x7f, off = 2; const op = b[0]! & 15;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) return; const data = b.subarray(off, off + len); this.buf = b.subarray(off + len); this.raw++;
      if (op === 1) this.text.push(JSON.parse(data.toString('utf8')) as ServerMsg);
      else if (op === 2) { const f = decodeFrame(new Uint8Array(data)); if (f) { this.frames.push({header: f.header, jpeg: new Uint8Array(f.jpeg)}); this.auto?.(f.header.seq); } }
      else if (op === 8) { this.closeCode = data.length >= 2 ? data.readUInt16BE(0) : 1005; this.socket.write(clientFrame(8, data)); }
      else if (op === 9) { this.pings++; this.socket.write(clientFrame(10, data)); }
      else if (op === 10) this.pongs++;
    }
  }
  /** Confirma sozinho cada quadro recebido (como o celular). */
  auto: ((seq: number) => void) | null = null;
  autoAck() { this.auto = seq => this.send({t: 'ack', seq}); return this; }
  send(m: ClientMsg | Record<string, unknown>) { this.socket.write(clientFrame(1, Buffer.from(JSON.stringify(m)))); }
  sendRaw(b: Buffer) { this.socket.write(b); }
  of<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, {t: T}>[] { return this.text.filter(m => m.t === t) as Extract<ServerMsg, {t: T}>[]; }
  statuses() { return this.of('status').map(m => m.state); }
  async until(pred: () => boolean, ms = 3000) { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) throw new Error('timeout esperando condição'); await sleep(5); } }
  close() { try { this.socket.destroy(); } catch { /* ok */ } }
}

// ---------- hub de teste ----------
let confirms: Parameters<NativeConfirm>[0][] = [], notices: string[] = [];
let hub: RemoteHub, port = 0, skew = 0, targets = new Map<string, FakeTarget>(), forbiddenCalls: string[] = [], controlCounts: number[] = [], lastTarget = '';
const open: TestWs[] = [], clockNow = () => Date.now() + skew; // relógio do hub = real + salto (os testes de 10 min/2 min avançam `skew`)
const sel: NetSelection = {binds: [], subnets: [], pin: 'pin-casa', label: 'Casa', source: 'subnet'};
const FAST: Partial<ScreenTiming> = {frameMs: 10, idleFrameMs: 20, ackTimeoutMs: 1e12, pingMs: 60_000, deadMs: 1e12, pausedMaxMs: 1e12, tickMs: 15, captureTimeoutMs: 100, statsMs: 40};
async function setup(timing: Partial<ScreenTiming> = {}, o: {pin?: boolean} = {}) {
  const dir = join(root, `t${++n}`); mkdirSync(join(dir, 'ui'), {recursive: true}); writeFileSync(join(dir, 'ui', 'remote.html'), '<!doctype html>');
  skew = 0; confirms = []; notices = []; targets = new Map(accounts.map(a => [a.id, new FakeTarget()])); forbiddenCalls = []; controlCounts = []; for (const a of accounts) a.suspended = false;
  hub = createRemoteHub({
    dbPath: join(dir, 'p.sqlite'), dir: join(dir, 'remote'), uiDir: join(dir, 'ui'), iconPath: join(process.cwd(), 'build', 'icon.png'), net: async () => sel, portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000, now: clockNow,
    api: {accounts: () => accounts, hunt: async () => ({}), market: async () => ({}), diag: () => ({})}, running: () => 1, blocker: {start: () => 1, stop: () => undefined}, nativeConfirm: async o => { confirms.push(o); return true; },
    screen: {target: id => { lastTarget = id; forbiddenCalls.push(id); return targets.get(id) ?? null; }, forbidden: () => [HUB_KEY], onControl: c => { controlCounts.push(c); }, notify: (kind, device, account) => { notices.push(`${kind}|${device}|${account}`); }, timing: {...FAST, ...timing}},
  });
  await hub.setEnabled(true); port = hub.status().port;
  if (o.pin !== false) await hub.setPin('123456');
}
afterEach(async () => { for (const w of open.splice(0)) w.close(); await hub?.close(); });
function addDevice(name = 'Pixel · Chrome', canAct = true, canControl = canAct) {
  const id = randomUUID(), secret = randomBytes(32).toString('base64url');
  hub.store.addDevice({id, name, tokenHash: createHash('sha256').update(secret).digest('hex'), now: new Date(clockNow()).toISOString(), nowMs: clockNow()}); if (canAct) hub.store.setCanAct(id, true); if (canControl) hub.store.setCanControl(id, true);
  return {id, cookie: `${COOKIE}=${id}.${secret}`};
}
interface Conn { origin?: string | null; host?: string; cookie?: string | null; protocols?: string | null; path?: string }
function upgrade(profile: string, c: Conn = {}): Promise<{status: number; ws?: TestWs}> {
  const host = c.host ?? `127.0.0.1:${port}`, headers: Record<string, string> = {Host: host, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64')};
  if (c.protocols !== null) headers['Sec-WebSocket-Protocol'] = c.protocols ?? 'ph.v1';
  if (c.origin !== null) headers.Origin = c.origin ?? `https://127.0.0.1:${port}`; if (c.cookie) headers.Cookie = c.cookie;
  return new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, path: c.path ?? `/api/screen/${profile}`, headers, rejectUnauthorized: false, agent: false});
    req.on('response', res => { res.resume(); resolve({status: res.statusCode ?? 0}); });
    req.on('upgrade', (_res, socket, head) => { const ws = new TestWs(socket, head); open.push(ws); resolve({status: 101, ws}); });
    req.on('error', reject); req.end();
  });
}
async function watch(profile = 'acc-1', device = addDevice(), ack = true) { const r = await upgrade(profile, {cookie: device.cookie}); expect(r.status).toBe(101); if (ack) r.ws!.autoAck(); return {ws: r.ws!, device}; }
const audits = () => hub.audit().map(a => `${a.action}|${a.detail ?? ''}`);
async function control(ws: TestWs, pin = '123456') { await ws.until(() => ws.statuses().includes('streaming')); ws.send({t: 'control', pin}); await ws.until(() => ws.of('control').length + ws.of('denied').length > 0); }
const tokenOf = (ws: TestWs) => (ws.of('control').filter(m => m.on).at(-1) as Extract<ServerMsg, {t: 'control'; on: true}>).token;

describe('upgrade do WebSocket: recusas', () => {
  it('Origin errado, de outra porta ou ausente → 403 (Cross-Site WebSocket Hijacking)', async () => {
    await setup(); const d = addDevice();
    expect((await upgrade('acc-1', {cookie: d.cookie, origin: 'https://evil.example'})).status).toBe(403);
    expect((await upgrade('acc-1', {cookie: d.cookie, origin: `https://127.0.0.1:${port + 1}`})).status).toBe(403);
    expect((await upgrade('acc-1', {cookie: d.cookie, origin: `http://127.0.0.1:${port}`})).status).toBe(403);
    expect((await upgrade('acc-1', {cookie: d.cookie, origin: null})).status).toBe(403);
    expect(targets.get('acc-1')!.captureCalls).toBe(0);
  });
  it('Host fora dos IPs vinculados → 421 (DNS rebinding)', async () => { await setup(); const d = addDevice(); expect((await upgrade('acc-1', {cookie: d.cookie, host: 'evil.example'})).status).toBe(421); expect((await upgrade('acc-1', {cookie: d.cookie, host: `10.9.9.9:${port}`})).status).toBe(421); });
  it('sem cookie, cookie inventado ou aparelho revogado → 401', async () => {
    await setup(); const d = addDevice();
    expect((await upgrade('acc-1', {cookie: null})).status).toBe(401);
    expect((await upgrade('acc-1', {cookie: `${COOKIE}=${randomUUID()}.${randomBytes(32).toString('base64url')}`})).status).toBe(401);
    expect((await upgrade('acc-1', {cookie: d.cookie.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))})).status).toBe(401);
    hub.revoke(d.id); expect((await upgrade('acc-1', {cookie: d.cookie})).status).toBe(401);
  });
  it('conta desconhecida → 404; suspensa → 409; sem o subprotocolo ph.v1 → 400; rota errada → 404', async () => {
    await setup(); const d = addDevice();
    expect((await upgrade('nao-existe', {cookie: d.cookie})).status).toBe(404);
    accounts[1]!.suspended = true; expect((await upgrade('acc-2', {cookie: d.cookie})).status).toBe(409);
    expect((await upgrade('acc-1', {cookie: d.cookie, protocols: null})).status).toBe(400);
    expect((await upgrade('acc-1', {cookie: d.cookie, protocols: 'outro.v1'})).status).toBe(400);
    expect((await upgrade('acc-1', {cookie: d.cookie, path: '/api/state'})).status).toBe(404);
    expect(forbiddenCalls).not.toContain('nao-existe'); // conta desconhecida nem chega a pedir um alvo
  });
  it('1 espectador por conta e 2 no total; o mesmo aparelho reconectando substitui a conexão velha', async () => {
    await setup(); const a = addDevice('A'), b = addDevice('B'), c = addDevice('C');
    const first = await upgrade('acc-1', {cookie: a.cookie}); expect(first.status).toBe(101);
    expect((await upgrade('acc-1', {cookie: b.cookie})).status).toBe(429); // outra pessoa na mesma conta
    expect((await upgrade('acc-2', {cookie: b.cookie})).status).toBe(101); // conta livre
    expect((await upgrade('acc-3', {cookie: c.cookie})).status).toBe(429); // 3º espectador no total
    const again = await upgrade('acc-1', {cookie: a.cookie}); expect(again.status).toBe(101); // reconexão do mesmo aparelho
    await first.ws!.closed; expect(first.ws!.of('bye')[0]?.reason).toBe('substituída');
    expect(hub.status().screen?.length).toBe(2);
  });
  it('o upgrade não rotaciona o cookie (a resposta 101 não entrega Set-Cookie)', async () => {
    await setup(); const d = addDevice(); skew += 2 * 86_400_000; const before = hub.store.tokenRow(d.id)!.rotatedAt;
    const {ws} = await watch('acc-1', d); expect(hub.store.tokenRow(d.id)!.rotatedAt).toBe(before); ws.close();
  });
});

describe('quadros: só do jogo, nada de senha', () => {
  it('manda JPEG com cabeçalho {seq,w,h}; hello sem e-mail; nenhum campo emailLabel em nenhuma mensagem', async () => {
    await setup(); const {ws} = await watch(); await ws.until(() => ws.frames.length >= 3);
    expect(ws.frames[0]!.header).toMatchObject({seq: 1, w: 640, h: 360}); expect(ws.frames[0]!.jpeg[0]).toBe(0xff); expect(ws.frames.map(f => f.header.seq)).toEqual(ws.frames.map((_, i) => i + 1));
    const hello = ws.of('hello')[0]!; expect(hello).toMatchObject({v: 1, profileId: 'acc-1', label: 'Principal', canAct: true, pinSet: true});
    await ws.until(() => ws.of('stats').length > 0);
    const dump = JSON.stringify(ws.text) + JSON.stringify(ws.frames.map(f => f.header)); expect(dump).not.toMatch(/email/i); expect(dump).not.toContain('@');
  });
  it('só transmite com a URL em https://pokeidle.io; em outras origens manda "protegido" e NÃO captura', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await ws.until(() => ws.frames.length >= 1);
    for (const url of ['https://accounts.google.com/o/oauth2', 'https://discord.com/login', 'https://pokeidle.io.evil.com/', 'http://pokeidle.io/', 'https://pokeidle.io:8443/', 'about:blank', 'javascript:alert(1)', 'https://evilpokeidle.io/']) {
      t.urlValue = url; await ws.until(() => ws.statuses().at(-1) === 'protected'); const calls = t.captureCalls, frames = ws.frames.length; await sleep(80);
      expect(t.captureCalls, url).toBe(calls); expect(ws.frames.length, url).toBe(frames);
      t.urlValue = 'https://pokeidle.io/play'; await ws.until(() => ws.statuses().at(-1) === 'streaming'); await ws.until(() => ws.frames.length > frames);
    }
  });
  it('foco em campo de senha pausa a captura; sai do foco e volta', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await ws.until(() => ws.frames.length >= 1);
    t.password = true; await ws.until(() => ws.statuses().at(-1) === 'password'); const calls = t.captureCalls; await sleep(80); expect(t.captureCalls).toBe(calls);
    t.password = false; await ws.until(() => ws.statuses().at(-1) === 'streaming');
  });
  it('senha que ganha foco DURANTE a captura: o quadro é descartado (conferência dupla)', async () => {
    await setup(); const t = targets.get('acc-1')!; t.password = [false, true, true, true, true, true, true, true, true]; const {ws} = await watch();
    await ws.until(() => ws.statuses().includes('password')); expect(ws.frames.length).toBe(0);
  });
  it('só envia quadro que mudou (hash)', async () => {
    await setup(); const t = targets.get('acc-1')!; t.changing = false; const {ws} = await watch(); await ws.until(() => t.captureCalls >= 5); expect(ws.frames.length).toBe(1);
    t.changing = true; await ws.until(() => ws.frames.length >= 2);
  });
  it('sem ack por ack-timeout: pausa ("sem-ack") e só volta com resume; pausa do celular (app oculto) também', async () => {
    await setup({ackTimeoutMs: 250}); const t = targets.get('acc-1')!, {ws} = await watch('acc-1', addDevice(), false);
    await ws.until(() => ws.of('status').some(s => s.state === 'paused' && s.reason === 'sem-ack'), 3000);
    const calls = t.captureCalls; await sleep(80); expect(t.captureCalls).toBe(calls); // pausado: não captura
    ws.autoAck(); ws.send({t: 'resume'}); await ws.until(() => ws.statuses().at(-1) === 'streaming'); const count = ws.frames.length; await ws.until(() => ws.frames.length > count);
    ws.send({t: 'pause', why: 'oculto'}); await ws.until(() => ws.of('status').some(s => s.reason === 'oculto')); const c2 = t.captureCalls; await sleep(80); expect(t.captureCalls).toBe(c2);
  });
  it('view oculta sem imagem: status "hidden"; o hold da janela é pedido ao abrir e restaurado UMA vez ao fechar', async () => {
    await setup(); const t = targets.get('acc-1')!; t.empty = true; const {ws} = await watch(); expect(t.holds).toBe(1);
    await ws.until(() => ws.statuses().includes('hidden')); t.empty = false; await ws.until(() => ws.frames.length >= 1);
    ws.close(); await ws.closed; await sleep(60); expect(t.releases).toBe(1);
  });
  it('nunca captura o alvo do hub: alvo proibido é recusado (403) e `capture` não é chamado', async () => {
    await setup(); const bad = new FakeTarget(); bad.key = HUB_KEY; targets.set('acc-1', bad); const d = addDevice();
    expect((await upgrade('acc-1', {cookie: d.cookie})).status).toBe(403); expect(bad.captureCalls).toBe(0); expect(bad.passwordCalls).toBe(0); expect(audits().some(a => a.startsWith('tela_recusada'))).toBe(true);
  });
  it('alvo que vira o hub no meio da sessão: nada é capturado (unavailable)', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await ws.until(() => ws.frames.length >= 1); t.key = HUB_KEY; const calls = t.captureCalls;
    await ws.until(() => ws.statuses().at(-1) === 'unavailable'); await sleep(60); expect(t.captureCalls).toBe(calls);
  });
  it('conta fechada/crashada: "unavailable"; volta quando reabre', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await ws.until(() => ws.frames.length >= 1); t.open = false; await ws.until(() => ws.statuses().at(-1) === 'unavailable'); t.open = true; await ws.until(() => ws.statuses().at(-1) === 'streaming', 5000);
  });
});

describe('protocolo e limites do WebSocket', () => {
  it('payload > 64 KB fecha com 1009; cliente sem máscara 1002; binário 1003; fragmento 1003; texto inválido 1007', async () => {
    await setup(); const d = addDevice();
    for (const [make, code] of [[() => clientFrame(1, Buffer.alloc(70_000, 97)), 1009], [() => clientFrame(1, Buffer.from('{}'), {mask: false}), 1002], [() => clientFrame(2, Buffer.from([1, 2, 3])), 1003 /* binário: o app fecha 1003 */], [() => clientFrame(1, Buffer.from('{}'), {fin: false}), 1003], [() => clientFrame(1, Buffer.from([0xff, 0xfe, 0xfd])), 1007]] as const) {
      const {ws} = await watch('acc-1', d); ws.sendRaw(make()); expect(await ws.closed).toBe(code); open.length = 0;
      await sleep(30);
    }
  });
  it('mensagem JSON acima de 4 KB (mesmo ≤ 64 KB) também fecha (1009); lixo repetido fecha (1008)', async () => {
    await setup(); const d = addDevice(); const a = await watch('acc-1', d); a.ws.send({t: 'ack', seq: 1, pad: 'x'.repeat(5000)}); expect(await a.ws.closed).toBe(1009); await sleep(30);
    const b = await watch('acc-1', d); for (let i = 0; i < 12; i++) b.ws.sendRaw(clientFrame(1, Buffer.from('nao e json'))); expect(await b.ws.closed).toBe(1008);
  });
  it('ping/pong: o servidor pergunta, o cliente responde e a conexão segue', async () => { await setup({pingMs: 30, deadMs: 5_000}); const {ws} = await watch(); await ws.until(() => ws.pings >= 2); expect(ws.closeCode).toBeNull(); });
  it('cliente que não responde nada (nem pong) é fechado e some da lista', async () => {
    await setup({pingMs: 20, deadMs: 120}); const quiet = await watch('acc-1', addDevice(), false); quiet.ws.socket.removeAllListeners('data'); quiet.ws.socket.on('data', () => undefined);
    await quiet.ws.closed; expect(hub.status().screen).toEqual([]); expect(audits().some(a => /sem resposta/.test(a))).toBe(true);
  });
  it('conexão parada por mais de 6 s (keep-alive do HTTP) não é derrubada pelo servidor', async () => {
    await setup({pingMs: 1500}); targets.get('acc-1')!.changing = false; const {ws} = await watch(); await sleep(6200); expect(ws.closeCode).toBeNull(); await ws.until(() => ws.pings >= 3); // continua viva e respondendo ping
  }, 15_000);
});

describe('Controlar: PIN, token, permissão', () => {
  it('exige "pode controlar" (permissão SEPARADA): só "pode agir" não basta e nenhum PIN é gasto', async () => {
    await setup(); const {ws} = await watch('acc-1', addDevice('Só agir', true, false)); await ws.until(() => ws.of('hello').length > 0); expect(ws.of('hello')[0]).toMatchObject({canAct: true, canControl: false});
    await control(ws); expect(ws.of('denied')[0]!.code).toBe('sem-permissao'); expect(ws.of('control')).toHaveLength(0);
    expect(audits().some(a => a.startsWith('controle_pin_recusado'))).toBe(false);
  });
  it('exige PIN definido no PC', async () => { await setup({}, {pin: false}); const {ws} = await watch(); await control(ws); expect(ws.of('denied')[0]!.code).toBe('sem-pin'); });
  it('PIN errado: nega com tentativas restantes; 5 erros bloqueiam (mesma trava do PIN do hub); PIN certo depois do bloqueio continua negado', async () => {
    await setup(); const {ws} = await watch(); await control(ws, '000000'); expect(ws.of('denied')[0]).toMatchObject({code: 'pin', attemptsLeft: 4});
    for (let i = 0; i < 4; i++) { ws.send({t: 'control', pin: '111111'}); await ws.until(() => ws.of('denied').length === i + 2); }
    expect(ws.of('denied').at(-1)).toMatchObject({code: 'bloqueado'}); ws.send({t: 'control', pin: '123456'}); await ws.until(() => ws.of('denied').length === 6); expect(ws.of('denied').at(-1)!.code).toBe('bloqueado'); expect(ws.of('control')).toHaveLength(0);
    expect(audits().filter(a => a.startsWith('controle_pin_recusado')).length).toBeGreaterThanOrEqual(5);
  });
  it('PIN certo → token de controle; entrada sem token ou com token errado é ignorada', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch();
    ws.send({t: 'in', token: 'x', e: {k: 'md', x: 10, y: 10}}); await sleep(40); expect(t.inputs).toHaveLength(0); // ainda sem controle
    await control(ws); const ctl = ws.of('control')[0]!; expect(ctl.on).toBe(true); const token = tokenOf(ws); expect(token).toMatch(/^[0-9a-f]{32}$/);
    ws.send({t: 'in', token: 'errado', e: {k: 'md', x: 10, y: 10}}); await sleep(40); expect(t.inputs).toHaveLength(0);
    ws.send({t: 'in', token, e: {k: 'md', x: 320, y: 180}}); await ws.until(() => t.inputs.length === 1);
    expect(hub.controlling('acc-1')).toBe(true); expect(hub.status().screen?.[0]).toMatchObject({control: true, account: 'Principal'}); expect(audits().some(a => a.startsWith('controle_inicio'))).toBe(true);
  });
  it('com a tela pausada (app oculto) a entrada é ignorada até retomar', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const token = tokenOf(ws);
    ws.send({t: 'pause', why: 'oculto'}); await ws.until(() => ws.of('status').some(s => s.reason === 'oculto')); ws.send({t: 'in', token, e: {k: 'md', x: 1, y: 1}}); await sleep(50); expect(t.inputs).toHaveLength(0);
    ws.send({t: 'resume'}); await ws.until(() => ws.statuses().at(-1) === 'streaming'); ws.send({t: 'in', token, e: {k: 'md', x: 1, y: 1}}); await ws.until(() => t.inputs.length === 1);
  });
  it('fora de pokeidle.io o controle não injeta nada', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const token = tokenOf(ws); t.urlValue = 'https://accounts.google.com/'; await ws.until(() => ws.statuses().at(-1) === 'protected');
    ws.send({t: 'in', token, e: {k: 'md', x: 1, y: 1}}); await sleep(50); expect(t.inputs).toHaveLength(0);
  });
});

describe('Controlar: entrada sanitizada', () => {
  async function ctl() { await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const token = tokenOf(ws); const inp = async (e: unknown, wait = 40) => { const before = t.inputs.length; ws.send({t: 'in', token, e}); await sleep(wait); return t.inputs.slice(before); }; return {t, ws, inp, token}; }
  it('mapeia a imagem do celular (640×360) para a view (800×600) e limita ao interior', async () => {
    const {inp} = await ctl();
    expect(await inp({k: 'md', x: 320, y: 180})).toEqual([{type: 'mouseDown', x: 400, y: 300, button: 'left', clickCount: 1}]);
    expect(await inp({k: 'mu', x: 320, y: 180, n: 2})).toEqual([{type: 'mouseUp', x: 400, y: 300, button: 'left', clickCount: 2}]);
    expect(await inp({k: 'md', x: 99_999, y: 99_999})).toMatchObject([{x: 799, y: 599}]); expect(await inp({k: 'md', x: -50, y: -1})).toMatchObject([{x: 0, y: 0}]);
    expect(await inp({k: 'mm', x: 640, y: 360, down: true})).toEqual([{type: 'mouseMove', x: 799, y: 599, modifiers: ['leftButtonDown']}]);
    expect(await inp({k: 'wh', x: 0, y: 0, dx: 5, dy: -99_999})).toEqual([{type: 'mouseWheel', x: 0, y: 0, deltaX: 5, deltaY: -1200}]);
  });
  it('recusa coordenadas inválidas, botão direito/meio, campos extras e tipos fora da lista', async () => {
    const {inp} = await ctl();
    for (const e of [{k: 'md', x: 'a', y: 1}, {k: 'md', x: 1, y: null}, {k: 'md', x: 1, y: 1, b: 'right'}, {k: 'md', x: 1, y: 1, button: 'right'}, {k: 'cx', x: 1, y: 1}, {k: 'drag'}, {k: 'md', x: 1, y: 1, n: 3}, {k: 'wh', x: 1, y: 1, dx: 'a', dy: 1}, {k: 'ch', text: '', extra: 1}, null, 5, [], {k: 'kd', key: 'a', extra: 1}, {k: 'md', x: 1, y: 1, __proto__: {x: 1}, z: 1}]) expect(await inp(e, 15), JSON.stringify(e)).toEqual([]);
  });
  it('BLOQUEIA F12, Ctrl+Shift+I/J/C, Ctrl+L/P/S/U/W/R/N/T, Alt+F4, F5, Alt+Left/Right, Meta/Win; deixa passar Enter, Backspace, Esc, setas, letras e texto', async () => {
    const {inp} = await ctl();
    const blocked = [{k: 'kd', key: 'F12'}, {k: 'ku', key: 'F12'}, {k: 'kd', key: 'F5'}, {k: 'kd', key: 'F4', m: ['alt']}, ...['i', 'j', 'c'].map(key => ({k: 'kd', key, m: ['ctrl', 'shift']})), ...['l', 'p', 's', 'u', 'w', 'r', 'n', 't'].map(key => ({k: 'kd', key, m: ['ctrl']})),
      {k: 'kd', key: 'ArrowLeft', m: ['alt']}, {k: 'kd', key: 'ArrowRight', m: ['alt']}, {k: 'kd', key: 'Meta'}, {k: 'kd', key: 'OS'}, {k: 'kd', key: 'Win'}, {k: 'kd', key: 'a', m: ['meta']}, {k: 'kd', key: 'Control'}, {k: 'kd', key: 'Alt'}, {k: 'kd', key: 'ContextMenu'}, {k: 'kd', key: 'Shift'}, {k: 'kd', key: 'PrintScreen'}, {k: 'kd', key: 'Dead'}];
    for (const e of blocked) expect(await inp(e, 12), JSON.stringify(e)).toEqual([]);
    expect(await inp({k: 'kd', key: 'Enter'})).toEqual([{type: 'keyDown', keyCode: 'Enter'}]); expect(await inp({k: 'ku', key: 'Backspace'})).toEqual([{type: 'keyUp', keyCode: 'Backspace'}]);
    expect(await inp({k: 'kd', key: 'Escape'})).toHaveLength(1); expect(await inp({k: 'kd', key: 'ArrowUp'})).toHaveLength(1); expect(await inp({k: 'kd', key: 'a', m: ['shift']})).toHaveLength(1);
    expect(await inp({k: 'ch', text: 'oi 😀'})).toEqual(['o', 'i', ' ', '😀'].map(c => ({type: 'char', keyCode: c})));
  });
  it('texto com controle/bidi ou longo demais é recusado', async () => { const {inp} = await ctl(); for (const text of ['\n', '\u0007', 'a‮b', '\u0000', 'x'.repeat(17), '​z']) expect(await inp({k: 'ch', text}, 12), JSON.stringify(text)).toEqual([]); });
  it('taxa: no máximo ~30 eventos por segundo (excesso descartado + aviso "limit")', async () => {
    const {t, ws, token} = await ctl(); for (let i = 0; i < 80; i++) ws.send({t: 'in', token, e: {k: 'mm', x: i, y: 1}}); await sleep(250);
    expect(t.inputs.length).toBeGreaterThanOrEqual(25); expect(t.inputs.length).toBeLessThanOrEqual(40); expect(ws.of('limit').length).toBeGreaterThan(0);
  });
  it('taxa: 500 caracteres por minuto (relógio injetável)', async () => {
    const {t, ws, token} = await ctl(); let sent = 0;
    for (let i = 0; i < 40; i++) { ws.send({t: 'in', token, e: {k: 'ch', text: 'abcdefghijklmnop'}}); sent++; skew += 40; await sleep(8); } // ~25 eventos/s: abaixo do limite de eventos
    await sleep(60); const chars = t.inputs.filter(e => e.type === 'char').length; expect(sent * 16).toBeGreaterThan(500); expect(chars).toBeLessThanOrEqual(500); expect(chars).toBeGreaterThanOrEqual(480);
    skew += 61_000; ws.send({t: 'in', token, e: {k: 'ch', text: 'z'}}); await ws.until(() => t.inputs.filter(e => e.type === 'char').length === chars + 1); // a janela andou
  });
  it('campo de senha com foco: teclas e texto não passam (o mouse sim)', async () => {
    const {t, ws, inp} = await ctl(); t.password = true; await ws.until(() => ws.statuses().at(-1) === 'password'); expect(await inp({k: 'ch', text: 'senha'})).toEqual([]); expect(await inp({k: 'kd', key: 'a'})).toEqual([]);
    t.password = false; await ws.until(() => ws.statuses().at(-1) === 'streaming'); expect(await inp({k: 'ch', text: 'ok'})).toHaveLength(2);
  });
});

describe('Controlar: validade, ociosidade, encerramento', () => {
  it('expira em 10 min e NÃO renova sem PIN: o token antigo morre, novo PIN dá token novo', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const old = tokenOf(ws); expect(ws.of('control')[0]).toMatchObject({on: true, idleMs: 120_000});
    for (let i = 1; i <= 5; i++) { skew += 100_000; ws.send({t: 'in', token: old, e: {k: 'mm', x: 1, y: 1}}); await ws.until(() => t.inputs.length === i); } // ainda vale e cada entrada zera a ociosidade
    skew += 101_000; await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({on: false, reason: 'expirou'});
    ws.send({t: 'in', token: old, e: {k: 'mm', x: 2, y: 2}}); await sleep(40); expect(t.inputs).toHaveLength(5); expect(hub.controlling('acc-1')).toBe(false);
    ws.send({t: 'control', pin: '999999'}); await ws.until(() => ws.of('denied').length === 1); // renovar exige o PIN
    ws.send({t: 'control', pin: '123456'}); await ws.until(() => ws.of('control').filter(m => m.on).length === 2); expect(tokenOf(ws)).not.toBe(old);
    expect(audits().some(a => /^controle_fim\|Principal; 600 s; expirou/.test(a) || /^controle_fim\|Principal; \d+ s; expirou/.test(a))).toBe(true);
  });
  it('2 min sem entrada encerra por ociosidade; entrada reinicia o relógio', async () => {
    await setup(); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const token = tokenOf(ws);
    skew += 100_000; ws.send({t: 'in', token, e: {k: 'mm', x: 1, y: 1}}); await ws.until(() => t.inputs.length === 1); skew += 100_000; await sleep(60); expect(hub.controlling('acc-1')).toBe(true); // 100 s desde a última entrada
    skew += 21_000; await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({reason: 'ocioso'});
  });
  it('"pode controlar" removido no PC encerra o controle; a visualização continua', async () => {
    await setup(); const {ws, device} = await watch(); await control(ws); hub.store.setCanControl(device.id, false);
    await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({reason: 'permissao'}); expect(ws.closeCode).toBeNull();
  });
  it('Ctrl+Shift+F12 / "Encerrar controle" do PC: termina TODOS os controles, mantém a visão, avisa o atalho global e audita a duração', async () => {
    await setup(); const a = await watch('acc-1', addDevice('A')), b = await watch('acc-2', addDevice('B')); await control(a.ws); await control(b.ws); expect(controlCounts.at(-1)).toBe(2);
    skew += 42_000; expect(hub.endControl()).toBe(2);
    await a.ws.until(() => a.ws.of('control').some(m => !m.on)); await b.ws.until(() => b.ws.of('control').some(m => !m.on)); expect(a.ws.of('control').at(-1)).toMatchObject({reason: 'pc'});
    expect(controlCounts.at(-1)).toBe(0); expect(hub.controlling('acc-1')).toBe(false); expect(a.ws.closeCode).toBeNull(); expect(hub.status().screen?.every(s => !s.control)).toBe(true);
    expect(audits().filter(x => x.startsWith('controle_fim')).every(x => /; 42 s; pc$/.test(x))).toBe(true);
  });
  it('"Encerrar tudo" do PC fecha também a visão (bye)', async () => { await setup(); const {ws} = await watch(); await ws.until(() => ws.frames.length > 0); hub.endScreen(); expect(await ws.closed).toBe(1000); expect(ws.of('bye')[0]?.reason).toContain('PC'); expect(hub.status().screen).toEqual([]); });
  it('"Voltar ao jogo" no celular encerra o controle sem fechar a tela', async () => {
    await setup(); const {ws} = await watch(); await control(ws); ws.send({t: 'end-control'}); await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({reason: 'encerrado'}); expect(ws.closeCode).toBeNull();
  });
});

describe('revogação, expiração, desligar e auditoria', () => {
  it('revogar o aparelho fecha o WebSocket na hora e encerra o controle (auditado)', async () => {
    await setup(); const {ws, device} = await watch(); await control(ws); expect(hub.revoke(device.id)).toBe(true);
    expect(await ws.closed).toBe(1008); expect(ws.of('bye')[0]?.reason).toBe('revogado'); expect(hub.status().screen).toEqual([]); expect(controlCounts.at(-1)).toBe(0);
    expect(audits().some(a => a.startsWith('controle_fim|Principal'))).toBe(true); expect(audits().some(a => /^tela_fim\|Principal; \d+ s; \d+ quadros; revogado/.test(a))).toBe(true);
    expect((await upgrade('acc-1', {cookie: device.cookie})).status).toBe(401);
  });
  const http = (path: string, method: string, cookie: string) => new Promise<number>(resolve => { const req = request({host: '127.0.0.1', port, path, method, rejectUnauthorized: false, headers: {Host: `127.0.0.1:${port}`, Origin: `https://127.0.0.1:${port}`, 'Content-Type': 'application/json', Cookie: cookie}}, r => { r.resume(); resolve(r.statusCode ?? 0); }); req.end(method === 'POST' ? '{}' : undefined); });
  it('sair (logout) fecha o WebSocket', async () => { await setup(); const a = await watch('acc-1', addDevice('A')); expect(await http('/api/logout', 'POST', a.device.cookie)).toBe(200); expect(await a.ws.closed).toBe(1008); });
  it('aparelho vencido (30 dias sem uso) fecha a tela no próximo contato', async () => { await setup(); const a = await watch('acc-1', addDevice('A')); skew += 31 * 86_400_000; expect(await http('/api/me', 'GET', a.device.cookie)).toBe(401); expect(await a.ws.closed).toBe(1008); expect(audits().some(x => x.startsWith('expirado'))).toBe(true); });
  it('desligar o acesso remoto (ou a rede mudar: mesmo caminho de parar o servidor) fecha todas as telas', async () => {
    await setup(); const a = await watch('acc-1', addDevice('A')), b = await watch('acc-2', addDevice('B')); await control(a.ws); await hub.setEnabled(false);
    expect(await a.ws.closed).toBeGreaterThan(0); expect(await b.ws.closed).toBeGreaterThan(0); expect(a.ws.of('bye')[0]?.reason).toBe('desligado'); expect(hub.controlling('acc-1')).toBe(false);
  });
  it('sair do app (close do hub) encerra telas e controle; a auditoria registra início e fim com duração', async () => {
    await setup(); const {ws} = await watch(); await control(ws); skew += 7000;
    expect(audits().some(a => /^tela_inicio\|Principal; Pixel/.test(a))).toBe(true); expect(audits().some(a => /^controle_inicio\|Principal; 10 min/.test(a))).toBe(true);
    hub.endScreen(); await ws.closed; expect(audits().some(a => /^controle_fim\|Principal; 7 s; sessao/.test(a))).toBe(true); expect(audits().some(a => /^tela_fim\|Principal; 7 s;/.test(a))).toBe(true);
  });
  it('tooltip da bandeja e banner: quem está vendo/controlando', async () => {
    await setup(); expect(hub.screenTooltip()).toBe(''); const {ws} = await watch('acc-1', addDevice('Pixel 8')); await ws.until(() => hub.status().screen!.length === 1);
    expect(hub.screenTooltip()).toContain('tela remota: Pixel 8 em Principal'); await control(ws); expect(hub.screenTooltip()).toContain('CONTROLE REMOTO'); expect(JSON.stringify(hub.status().screen)).not.toMatch(/email|token/i);
  });
  it('a captura só é pedida para alvos de CONTA (identidade conferida): `target` só recebe ids de perfil', async () => {
    await setup(); const {ws} = await watch('acc-2'); await ws.until(() => ws.frames.length > 0); expect(new Set(forbiddenCalls)).toEqual(new Set(['acc-2'])); expect(lastTarget).toBe('acc-2'); expect(targets.get('acc-2')!.captureCalls).toBeGreaterThan(0); expect(targets.get('acc-1')!.captureCalls).toBe(0);
  });
});

describe('R5: correções da auditoria', () => {
  it('aparelho sem permissão nenhuma → 403; com só "pode controlar" vê; 7ª sessão nova no minuto → 429', async () => {
    await setup(); expect((await upgrade('acc-1', {cookie: addDevice('Nada', false).cookie})).status).toBe(403);
    expect((await upgrade('acc-1', {cookie: addDevice('Ctl', false, true).cookie})).status).toBe(101);
    const d = addDevice('Rápido'); for (let i = 0; i < 6; i++) expect((await upgrade('acc-2', {cookie: d.cookie})).status).toBe(101);
    expect((await upgrade('acc-2', {cookie: d.cookie})).status).toBe(429);
  });
  it('500 mensagens num só pedaço fecham com 1008 (balde de fichas)', async () => {
    await setup(); const {ws} = await watch(); const one = clientFrame(1, Buffer.from('{"t":"pause"}'));
    ws.sendRaw(Buffer.concat(Array.from({length: 500}, () => one))); expect(await ws.closed).toBe(1008);
  });
  it('close com código reservado → 1002; motivo não UTF-8 → 1007', async () => {
    await setup(); const a = await watch(); a.ws.sendRaw(clientFrame(8, Buffer.from([0x03, 0xed]))); expect(await a.ws.closed).toBe(1002);
    const b = await watch('acc-2'); b.ws.sendRaw(clientFrame(8, Buffer.from([0x03, 0xe8, 0xff, 0xfe]))); expect(await b.ws.closed).toBe(1007);
  });
  it('socket que não escoa é derrubado no envio de texto', () => {
    let killed = 0; expect(guardedSend({buffered: () => 600 * 1024, sendText: () => true, terminate: () => { killed++; }}, 'x')).toBe(false); expect(killed).toBe(1);
  });
  it('diálogo do "pode controlar" diz controle total, gemas e sem teto; mudar o PIN encerra o controle; notificações', async () => {
    const d = controlDialog('Pixel', true); expect(d.detail).toMatch(/controle total/); expect(d.detail).toMatch(/gemas/); expect(d.detail).toMatch(/SEM o teto/);
    await setup(); const {ws, device} = await watch(); await control(ws); expect(notices).toEqual(expect.arrayContaining(['tela|Pixel · Chrome|Principal', 'controle|Pixel · Chrome|Principal']));
    await hub.setPin('654321'); await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({reason: 'permissao'});
    await hub.setCanControl(device.id, false); expect(confirms.at(-1)!.detail).toMatch(/não controla/); expect(hub.devices()[0]!.canControl).toBe(false);
  });
  it('expiração conferida na própria entrada, sem esperar o sweep', async () => {
    await setup({tickMs: 1e9}); const t = targets.get('acc-1')!, {ws} = await watch(); await control(ws); const token = tokenOf(ws); skew += 11 * 60_000;
    ws.send({t: 'in', token, e: {k: 'md', x: 10, y: 10}}); await ws.until(() => ws.of('control').some(m => !m.on)); expect(ws.of('control').at(-1)).toMatchObject({reason: 'expirou'}); expect(t.inputs).toHaveLength(0);
  });
});
