// Servidor HTTPS do acesso remoto (LAN). Só IPv4 privado/loopback, Host e Origin conferidos, corpo ≤ 8 KB só JSON,
// cabeçalhos estritos, limite por IP, respostas de erro genéricas e NENHUM log (códigos, tokens, PINs e IPs ficam fora do console).
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostOnly, isAllowedRemote, unmapIPv4 } from './ip';
import { deviceNameFromUA, sanitizeName } from './device-name';
import { Pairing, PinGuard, RateLimiter } from './guards';
import { MAX_DEVICES, type DeviceRow, type RemoteStore } from './store';
import type { CertSet } from './certs';
import { mobileconfig } from './certs';

export interface RemoteAccount { id: string; label: string; color: string; state: string; suspended: boolean }
export interface RemoteApi {
  accounts(): RemoteAccount[];
  hunt(id: string, soLiberadas: boolean): Promise<unknown>;
  market(id: string, focus: string): Promise<unknown>;
  diag(): unknown;
}
export interface ServerDeps {
  store: RemoteStore; certs: () => Pick<CertSet, 'caDer' | 'leafCert' | 'leafKey'>; api: RemoteApi; pairing: Pairing; pin: PinGuard;
  confirmPair(info: {name: string; ip: string}): Promise<boolean>;
  uiDir: string; iconPath: string; now?: () => number; limits?: {general?: number; pair?: number};
}
export const COOKIE = '__Host-ph', MAX_BODY = 8192, SSE_MAX = 20, SSE_PER_DEVICE = 4, HEARTBEAT_MS = 25_000, COOKIE_MAX_AGE = 34_560_000;
export const CSP = "default-src 'self'; img-src 'self' data: https://pokeidle.io; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const MSG = {notFound: 'Não encontrado.', auth: 'Não autorizado.', host: 'Endereço não permitido.', origin: 'Origem não permitida.', json: 'Requisição inválida.', big: 'Requisição grande demais.', rate: 'Muitas requisições. Aguarde um pouco.', fail: 'Não foi possível concluir.', pairOff: 'Pareamento desligado.', code: 'Código inválido ou expirado.', busy: 'Já existe um pedido aguardando no PC.', method: 'Método não permitido.', denied: 'O pedido não foi aceito.', limit: 'Limite de aparelhos atingido.', pin: 'PIN incorreto.'};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEqualHex = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const STATIC: Record<string, {file: string; type: string; icon?: boolean}> = {
  '/': {file: 'remote.html', type: 'text/html; charset=utf-8'}, '/manifest.webmanifest': {file: 'manifest.webmanifest', type: 'application/manifest+json'},
  '/sw.js': {file: 'sw.js', type: 'text/javascript; charset=utf-8'}, '/icon-512.png': {file: '', type: 'image/png', icon: true},
};
const MIME: Record<string, string> = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', json: 'application/json', woff2: 'font/woff2'};

export function createRemoteServer(deps: ServerDeps) {
  const now = deps.now ?? Date.now;
  const general = new RateLimiter(deps.limits?.general ?? 300, 60_000, now), pairLimit = new RateLimiter(deps.limits?.pair ?? 10, 60_000, now);
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const streams = new Map<ServerResponse, string>(); // fluxo SSE → aparelho
  let allowedHosts = new Set<string>(['localhost', '127.0.0.1']);
  let pending = false, heartbeat: ReturnType<typeof setInterval> | undefined;
  const lastTouch = new Map<string, number>();

  const send = (res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string | string[]> = {}) => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, {...HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra});
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}) => send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', {'Cache-Control': 'no-store', ...extra});
  const fail = (res: ServerResponse, status: number, message: string, extra: Record<string, string | string[]> = {}) => json(res, status, {error: message}, extra);

  function cookieToken(req: IncomingMessage): {id: string; secret: string} | null {
    const raw = req.headers.cookie;
    if (!raw || raw.length > 2048) return null;
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k !== COOKIE) continue;
      const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(v.join('='));
      return m ? {id: m[1]!, secret: m[2]!} : null;
    }
    return null;
  }
  /** Aparelho autenticado pelo cookie: o id acha a linha e o hash é comparado em tempo constante. */
  function authenticate(req: IncomingMessage): DeviceRow | null {
    const token = cookieToken(req);
    if (!token) return null;
    const stored = deps.store.tokenHashOf(token.id);
    if (!stored || !safeEqualHex(sha(token.secret), stored)) return null;
    const device = deps.store.getDevice(token.id);
    if (device && now() - (lastTouch.get(device.id) ?? 0) > 60_000) { lastTouch.set(device.id, now()); try { deps.store.touch(device.id, new Date(now()).toISOString()); } catch { /* só informativo */ } }
    return device;
  }
  const audit = (deviceId: string | null, action: string, detail: string | null = null) => { try { deps.store.audit(deviceId, action, detail, new Date(now()).toISOString()); } catch { /* auditoria não derruba a requisição */ } };

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | 'big' | null> {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return null;
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY) return 'big';
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_BODY) return 'big'; chunks.push(chunk as Buffer); }
    try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
  }

  async function pair(req: IncomingMessage, res: ServerResponse, ip: string) {
    const body = await readJson(req);
    if (body === 'big') return fail(res, 413, MSG.big);
    if (!body || typeof body.code !== 'string') return fail(res, 400, MSG.json);
    if (pending) return fail(res, 409, MSG.busy);
    if (!deps.pairing.active) { deps.pairing.attempt(body.code); return fail(res, 403, MSG.pairOff); }
    const result = deps.pairing.attempt(body.code);
    if (result !== 'ok') { audit(null, 'pareamento_codigo_errado', `${ip} (${result})`); return fail(res, 403, MSG.code); }
    if (deps.store.countDevices() >= MAX_DEVICES) return fail(res, 403, MSG.limit);
    const name = sanitizeName(body.deviceName) || deviceNameFromUA(req.headers['user-agent']);
    pending = true;
    let accepted: boolean;
    try { audit(null, 'pareamento_pedido', `${name} (${ip})`); accepted = await deps.confirmPair({name, ip}); } catch { accepted = false; } finally { pending = false; }
    if (!accepted) { audit(null, 'pareamento_negado', `${name} (${ip})`); return fail(res, 403, MSG.denied); }
    const id = randomUUID(), secret = randomBytes(32).toString('base64url'); // 256 bits; token novo a cada pareamento
    deps.store.addDevice({id, name, tokenHash: sha(secret), now: new Date(now()).toISOString()});
    audit(id, 'pareamento_aceito', `${name} (${ip})`);
    json(res, 200, {ok: true, name}, {'Set-Cookie': `${COOKIE}=${id}.${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`});
  }

  function events(req: IncomingMessage, res: ServerResponse, device: DeviceRow) {
    const mine = [...streams.values()].filter(id => id === device.id).length;
    if (streams.size >= SSE_MAX || mine >= SSE_PER_DEVICE) return fail(res, 429, MSG.rate);
    res.writeHead(200, {...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write(`retry: 5000\nevent: state\ndata: ${JSON.stringify({accounts: deps.api.accounts()})}\n\n`);
    streams.set(res, device.id);
    req.on('close', () => streams.delete(res));
  }

  async function route(req: IncomingMessage, res: ServerResponse, ip: string) {
    const url = new URL(req.url ?? '/', 'https://x'), path = url.pathname, method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') return fail(res, 405, MSG.method, {Allow: 'GET, POST'});
    if (method === 'POST') { // anti-CSRF: Origin tem de ser exatamente este servidor (e a requisição precisa de JSON)
      if (req.headers.origin !== `https://${req.headers.host}`) return fail(res, 403, MSG.origin);
      if (path === '/api/pair' && !pairLimit.hit(ip)) return fail(res, 429, MSG.rate, {'Retry-After': '60'});
      if (path === '/api/pair') return pair(req, res, ip);
    }
    if (method === 'GET') {
      if ((path === '/ca.crt' || path === '/ca.mobileconfig')) {
        if (!deps.pairing.active) return fail(res, 404, MSG.notFound); // a CA só é baixada com o modo de pareamento ligado
        const der = deps.certs().caDer;
        return path === '/ca.crt' ? send(res, 200, der, 'application/x-x509-ca-cert', {'Content-Disposition': 'attachment; filename="pokehub-ca.crt"', 'Cache-Control': 'no-store'})
          : send(res, 200, mobileconfig(der), 'application/x-apple-aspen-config', {'Content-Disposition': 'attachment; filename="pokehub.mobileconfig"', 'Cache-Control': 'no-store'});
      }
      const asset = /^\/assets\/([A-Za-z0-9._-]{1,120})$/.exec(path);
      const entry = STATIC[path];
      if (entry || asset) {
        try {
          const data = entry ? await readFile(entry.icon ? deps.iconPath : join(deps.uiDir, entry.file)) : await readFile(join(deps.uiDir, 'assets', asset![1]!));
          const type = entry?.type ?? MIME[asset![1]!.split('.').pop() ?? ''] ?? 'application/octet-stream';
          return send(res, 200, data, type, {'Cache-Control': path === '/sw.js' || path === '/' ? 'no-cache' : 'public, max-age=3600', ...(path === '/sw.js' ? {'Service-Worker-Allowed': '/'} : {})});
        } catch { return fail(res, 404, MSG.notFound); }
      }
    }
    if (!path.startsWith('/api/')) return fail(res, 404, MSG.notFound);
    const device = authenticate(req);
    if (!device) return fail(res, 401, MSG.auth);
    if (method === 'POST') {
      if (path === '/api/logout') { deps.store.revokeDevice(device.id); audit(device.id, 'saiu', device.name); closeStreams(device.id); return json(res, 200, {ok: true}, {'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`}); }
      if (path === '/api/pin/check') {
        const body = await readJson(req);
        if (body === 'big') return fail(res, 413, MSG.big);
        if (!body) return fail(res, 400, MSG.json);
        const check = deps.pin.check(device.id, body.pin);
        if (check.ok) return json(res, 200, {ok: true});
        if (check.reason === 'locked') return fail(res, 429, 'PIN bloqueado por alguns minutos.', {'Retry-After': String(Math.ceil((check.retryAfterMs ?? 0) / 1000))});
        return fail(res, check.reason === 'no-pin' ? 409 : 403, check.reason === 'no-pin' ? 'Defina um PIN no PC.' : MSG.pin);
      }
      return fail(res, 404, MSG.notFound);
    }
    const idMatch = /^\/api\/(hunt|market)\/([\w-]{1,64})$/.exec(path);
    if (path === '/api/me') return json(res, 200, {name: device.name, canAct: device.canAct, pinSet: deps.store.getPinHash() !== null});
    if (path === '/api/state') return json(res, 200, {accounts: deps.api.accounts()});
    if (path === '/api/diag') return json(res, 200, deps.api.diag());
    if (path === '/api/events') return events(req, res, device);
    if (idMatch) {
      const id = idMatch[2]!;
      if (!deps.api.accounts().some(a => a.id === id)) return fail(res, 404, MSG.notFound);
      if (idMatch[1] === 'hunt') return json(res, 200, await deps.api.hunt(id, url.searchParams.get('todas') !== '1'));
      const focus = url.searchParams.get('foco');
      return json(res, 200, await deps.api.market(id, focus === 'qualidade' || focus === 'desconto' ? focus : 'equilibrado'));
    }
    return fail(res, 404, MSG.notFound);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const ip = unmapIPv4(req.socket.remoteAddress);
      if (!isAllowedRemote(ip)) { req.socket.destroy(); return; }
      const host = hostOnly(req.headers.host);
      if (!host || !allowedHosts.has(host)) return fail(res, 421, MSG.host); // proteção contra DNS rebinding
      if (!general.hit(ip)) return fail(res, 429, MSG.rate, {'Retry-After': '60'});
      await route(req, res, ip);
    } catch { try { fail(res, 500, MSG.fail); } catch { res.destroy(); } } // erro interno: nada do erro real sai
  }
  function closeStreams(deviceId: string) { for (const [res, id] of streams) if (id === deviceId) { streams.delete(res); res.end(); } }

  return {
    /** Abre um listener por endereço (só IPs privados/loopback). Com `port` 0 usa uma porta livre (testes). Devolve a porta. */
    async listen(addresses: readonly string[], port: number): Promise<number> {
      if (servers.length) throw new Error('Já está escutando');
      const bind = [...new Set(addresses)].filter(isAllowedRemote);
      if (!bind.length) throw new Error('Sem endereço de rede');
      allowedHosts = new Set(['localhost', ...bind]);
      const certs = deps.certs();
      let chosen = port;
      try {
        for (const address of bind) {
          const server = createServer({cert: certs.leafCert, key: certs.leafKey, minVersion: 'TLSv1.2', maxHeaderSize: 8192, handshakeTimeout: 10_000} as never, (req, res) => { void handle(req, res); });
          server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxConnections = 64;
          server.on('connection', (raw) => { const socket = raw as Socket; if (!isAllowedRemote(socket.remoteAddress)) { socket.destroy(); return; } sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
          server.on('tlsClientError', (_error, socket) => socket.destroy());
          await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(chosen, address, () => { server.off('error', reject); resolve(); }); });
          servers.push(server);
          if (chosen === 0) chosen = (server.address() as {port: number}).port;
        }
      } catch (error) { await this.close(); throw error; }
      heartbeat = setInterval(() => {
        for (const [res, id] of streams) { if (!deps.store.getDevice(id)) { closeStreams(id); continue; } try { res.write(': \n\n'); } catch { streams.delete(res); } }
      }, HEARTBEAT_MS);
      heartbeat.unref();
      return chosen;
    },
    /** Fecha todos os listeners e conexões (a porta deixa de responder). */
    async close(): Promise<void> {
      clearInterval(heartbeat); heartbeat = undefined;
      for (const res of streams.keys()) { try { res.end(); } catch { /* já fechada */ } }
      streams.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    },
    publish(event: string, data: unknown): void {
      if (!/^[a-z-]{1,20}$/.test(event)) return;
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of streams.keys()) { try { res.write(frame); } catch { streams.delete(res); } }
    },
    /** Revogação: apaga o aparelho e derruba na hora os fluxos SSE dele. */
    revoke(deviceId: string): boolean { const ok = deps.store.revokeDevice(deviceId); closeStreams(deviceId); lastTouch.delete(deviceId); return ok; },
    streamCount: () => streams.size,
    listening: () => servers.length > 0 && servers.every(server => server.listening),
  };
}
export type RemoteServer = ReturnType<typeof createRemoteServer>;
