// Servidor HTTPS do acesso remoto (LAN). Só IPv4 privado/loopback NA MESMA SUB-REDE da interface, Host e Origin conferidos, corpo ≤ 8 KB só JSON,
// cabeçalhos estritos, limites por IP/aparelho/conexão, respostas de erro genéricas e NENHUM log (códigos, tokens, PINs e IPs ficam fora do console).
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostOnly, isAllowedRemote, sameSubnet, unmapIPv4, type Bind } from './ip';
import { deviceNameFromUA, sanitizeName } from './device-name';
import { Pairing, RateLimiter, generateSas, normalizeCode } from './guards';
import { MAX_DEVICES, type DeviceRow, type RemoteStore } from './store';
import { caFingerprint, mobileconfig, type CertSet } from './certs';
import { parsePrefs } from './alerts';
import type { AlertPrefs, RemoteAlert, RemoteCapture } from '../contracts/remote';

export interface RemoteAccount { id: string; label: string; color: string; state: string; suspended: boolean }
export interface RemoteApi {
  accounts(): RemoteAccount[];
  hunt(id: string, soLiberadas: boolean): Promise<unknown>;
  market(id: string, focus: string): Promise<unknown>;
  diag(): unknown;
}
/** Alertas e push (R3). Opcional: sem isto as rotas de alertas respondem 404. */
export interface AlertsApi {
  listCaptures(deviceId: string, q: {profileId?: string; onlyAlerts?: boolean; limit?: number}): RemoteCapture[]; history(limit: number): RemoteAlert[];
  getPrefs(deviceId: string): AlertPrefs; setPrefs(deviceId: string, prefs: AlertPrefs): AlertPrefs; publicKey(): string | null;
  subscribe(deviceId: string, sub: {endpoint: unknown; p256dh: unknown; auth: unknown}): boolean; unsubscribe(deviceId: string, endpoint: unknown): boolean;
  sendTest(deviceId: string): Promise<number | null>;
}
/** O que o PC mostra no pedido: `ua` é o que o servidor leu do User-Agent; `nickname` é o que o celular disse de si (não confiável). */
export interface PairInfo { name: string; nickname: string; ua: string; ip: string; sas: string }
export interface ServerDeps {
  store: RemoteStore; certs: () => Pick<CertSet, 'caDer' | 'leafCert' | 'leafKey'>; api: RemoteApi; pairing: Pairing;
  /** Pede ao PC "Permitir?". `signal` aborta quando o celular desiste (a resposta vale false e nada é guardado). */
  confirmPair(info: PairInfo, signal: AbortSignal): Promise<boolean>;
  /** O mesmo código certo chegou de novo enquanto o pedido está aberto: alguém mais o conhece. */
  onContested?(): void;
  uiDir: string; iconPath: string; now?: () => number; alerts?: AlertsApi;
  /** Abriu/fechou um fluxo SSE ou um aparelho saiu (revogado/expirado): o motor decide se o leitor de capturas precisa ficar ligado. */
  onActivity?(): void;
  limits?: {general?: number; pair?: number; wait?: number; api?: number}; timing?: {waitMs?: number; abandonMs?: number; maxMs?: number};
}
export const COOKIE = '__Host-ph', MAX_BODY = 8192, SSE_MAX = 20, SSE_PER_DEVICE = 4, HEARTBEAT_MS = 25_000;
export const COOKIE_MAX_AGE = 30 * 86_400, ROTATE_MS = 86_400_000, PREV_VALID_MS = 5 * 60_000, IDLE_MAX_MS = 30 * 86_400_000, ABSOLUTE_MAX_MS = 180 * 86_400_000, RENEW_MS = 3_600_000;
export const CONN_PER_IP = 8, SOCKET_TIMEOUT_MS = 30_000, SSE_BACKLOG = 256 * 1024, API_PER_MIN = 10;
export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const MSG = {notFound: 'Não encontrado.', auth: 'Não autorizado.', host: 'Endereço não permitido.', origin: 'Origem não permitida.', json: 'Requisição inválida.', big: 'Requisição grande demais.', rate: 'Muitas requisições. Aguarde um pouco.', fail: 'Não foi possível concluir.', pairOff: 'Pareamento desligado.', code: 'Código inválido ou expirado.', busy: 'Já existe um pedido aguardando no PC.', method: 'Método não permitido.', denied: 'O pedido não foi aceito.', limit: 'Limite de aparelhos atingido.', sw: 'Abra o app pelo endereço do PC e tente de novo.', header: 'Requisição inválida.'};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEqualHex = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookieValue = (id: string, secret: string) => `${COOKIE}=${id}.${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
/** Aparelho vencido? Sem uso por mais de 30 dias ou pareado há mais de 180 (limite absoluto). */
export function deviceExpired(device: Pick<DeviceRow, 'createdAt' | 'lastSeen'>, nowMs: number): 'inativo' | 'limite' | null {
  const created = Date.parse(device.createdAt), seen = device.lastSeen ? Date.parse(device.lastSeen) : NaN;
  if (Number.isFinite(created) && nowMs - created > ABSOLUTE_MAX_MS) return 'limite';
  if (Number.isFinite(seen) && nowMs - seen > IDLE_MAX_MS) return 'inativo';
  return null;
}
/** Fluxo SSE emperrado (celular lento/parado)? Passou do limite de bytes pendentes no soquete. */
export const isBackedUp = (res: {writableLength: number}): boolean => res.writableLength > SSE_BACKLOG;
const STATIC: Record<string, {file: string; type: string; icon?: boolean}> = {
  '/': {file: 'remote.html', type: 'text/html; charset=utf-8'}, '/manifest.webmanifest': {file: 'manifest.webmanifest', type: 'application/manifest+json'},
  '/sw.js': {file: 'sw.js', type: 'text/javascript; charset=utf-8'}, '/icon-512.png': {file: '', type: 'image/png', icon: true},
};
const MIME: Record<string, string> = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', json: 'application/json', woff2: 'font/woff2'};
interface PairResult { accepted: boolean; cookie?: string; name?: string }
interface Pending { id: string; ip: string; code: string; ctrl: AbortController; result: PairResult | null; listeners: Set<() => void>; waiters: number; abandon?: ReturnType<typeof setTimeout>; max?: ReturnType<typeof setTimeout>; name: string }

export function createRemoteServer(deps: ServerDeps) {
  const now = deps.now ?? Date.now;
  const general = new RateLimiter(deps.limits?.general ?? 300, 60_000, now), pairLimit = new RateLimiter(deps.limits?.pair ?? 10, 60_000, now), waitLimit = new RateLimiter(deps.limits?.wait ?? 40, 60_000, now);
  const apiLimit = new RateLimiter(deps.limits?.api ?? API_PER_MIN, 60_000, now); const writeLimit = new RateLimiter(30, 600_000, now); // POSTs de alertas/push: por aparelho
  const activity = () => { try { deps.onActivity?.(); } catch { /* ouvinte */ } }; // por aparelho: hunt e mercado são caros
  const waitMs = deps.timing?.waitMs ?? 25_000, abandonMs = deps.timing?.abandonMs ?? 15_000, maxMs = deps.timing?.maxMs ?? 60_000;
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const perIp = new Map<string, number>();
  const streams = new Map<ServerResponse, string>(); // fluxo SSE → aparelho
  const inflight = new Map<string, Promise<unknown>>(); // consultas caras repetidas dividem o mesmo resultado
  const pendings = new Map<string, Pending>();
  let allowedHosts = new Set<string>(['localhost', '127.0.0.1']), masks = new Map<string, string>();
  let active: Pending | null = null, heartbeat: ReturnType<typeof setInterval> | undefined;
  const lastTouch = new Map<string, number>(), lastRenew = new Map<string, number>();

  const send = (res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string | string[]> = {}) => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, {...HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra});
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}) => send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', {'Cache-Control': 'no-store', ...extra});
  const fail = (res: ServerResponse, status: number, message: string, extra: Record<string, string | string[]> = {}) => json(res, status, {error: message}, extra);
  const audit = (deviceId: string | null, action: string, detail: string | null = null) => { try { deps.store.audit(deviceId, action, detail, new Date(now()).toISOString()); } catch { /* auditoria não derruba a requisição */ } };

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
  function expire(device: DeviceRow, why: string) { deps.store.revokeDevice(device.id); audit(device.id, 'expirado', `${device.name} (${why})`); closeStreams(device.id); lastTouch.delete(device.id); lastRenew.delete(device.id); activity(); }
  /**
   * Aparelho autenticado pelo cookie (hash em tempo constante). Vence por inatividade (30 dias) ou limite absoluto (180);
   * o token roda a cada 24 h (o anterior vale 5 min) e o cookie renova a cada uso (Max-Age 30 dias) pelo `Set-Cookie` da resposta.
   */
  function authenticate(req: IncomingMessage, res: ServerResponse): DeviceRow | null {
    const token = cookieToken(req);
    if (!token) return null;
    const row = deps.store.tokenRow(token.id);
    if (!row) return null;
    const t = now(), h = sha(token.secret);
    const current = safeEqualHex(h, row.hash), previous = !current && row.prevHash !== null && t < row.prevUntil && safeEqualHex(h, row.prevHash);
    if (!current && !previous) return null;
    const device = deps.store.getDevice(token.id);
    if (!device) return null;
    const why = deviceExpired(device, t);
    if (why) { expire(device, why === 'limite' ? 'limite de 180 dias' : 'sem uso por 30 dias'); return null; }
    if (t - (lastTouch.get(device.id) ?? 0) > 60_000) { lastTouch.set(device.id, t); try { deps.store.touch(device.id, new Date(t).toISOString()); } catch { /* só informativo */ } }
    if (current && t - row.rotatedAt > ROTATE_MS) {
      const secret = randomBytes(32).toString('base64url');
      deps.store.rotateToken(device.id, sha(secret), row.hash, t + PREV_VALID_MS, t);
      res.setHeader('Set-Cookie', cookieValue(device.id, secret)); lastRenew.set(device.id, t);
    } else if (current && t - (lastRenew.get(device.id) ?? 0) > RENEW_MS) { res.setHeader('Set-Cookie', cookieValue(device.id, token.secret)); lastRenew.set(device.id, t); }
    return device;
  }
  /** Fecha os aparelhos vencidos (chamado periodicamente: quem nunca mais volta também sai). */
  function sweepExpired(): number {
    let n = 0;
    for (const device of deps.store.listDevices()) { const why = deviceExpired(device, now()); if (why) { expire(device, why === 'limite' ? 'limite de 180 dias' : 'sem uso por 30 dias'); n++; } }
    return n;
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | 'big' | null> {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return null;
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY) return 'big';
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_BODY) return 'big'; chunks.push(chunk as Buffer); }
    try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
  }

  // --- Pareamento: POST devolve 202 + SAS na hora; o celular consulta /api/pair/wait (long-poll) pelo resultado e pelo cookie ---
  function arm(p: Pending) {
    clearTimeout(p.abandon);
    if (p.result || p.waiters > 0) return;
    p.abandon = setTimeout(() => { if (!p.result && p.waiters === 0) { audit(null, 'pareamento_abandonado', p.name); p.ctrl.abort(); } }, abandonMs);
    p.abandon.unref();
  }
  function finish(p: Pending, accepted: boolean, info: PairInfo) {
    clearTimeout(p.abandon); clearTimeout(p.max);
    if (active === p) active = null;
    deps.pairing.release();
    let result: PairResult = {accepted: false};
    if (accepted && !p.ctrl.signal.aborted && deps.store.countDevices() < MAX_DEVICES) {
      const id = randomUUID(), secret = randomBytes(32).toString('base64url'); // 256 bits; token novo a cada pareamento
      deps.store.addDevice({id, name: info.name, tokenHash: sha(secret), now: new Date(now()).toISOString(), nowMs: now()});
      lastTouch.set(id, now()); lastRenew.set(id, now()); // acabou de receber o cookie: sem renovação imediata
      audit(id, 'pareamento_aceito', `${info.name} (${info.ip})`);
      result = {accepted: true, cookie: cookieValue(id, secret), name: info.name};
    } else audit(null, p.ctrl.signal.aborted ? 'pareamento_cancelado' : 'pareamento_negado', `${info.name} (${info.ip})`); // abandonou/expirou/recusou: nada é guardado
    p.result = result;
    for (const wake of [...p.listeners]) wake();
    const cleanup = setTimeout(() => pendings.delete(p.id), 30_000); cleanup.unref();
  }
  async function pair(req: IncomingMessage, res: ServerResponse, ip: string) {
    if (req.headers['x-ph-sw'] !== '1') return fail(res, 403, MSG.sw); // heurística: só o service worker registrado envia; um navegador comum que "clicou em continuar" não pareia
    const body = await readJson(req);
    if (body === 'big') return fail(res, 413, MSG.big);
    if (!body || typeof body.code !== 'string') return fail(res, 400, MSG.json);
    if (active) {
      if (deps.pairing.reused(body.code)) { audit(null, 'pareamento_contestado', ip); try { deps.onContested?.(); } catch { /* ouvinte */ } }
      return fail(res, 409, MSG.busy);
    }
    if (!deps.pairing.active) { deps.pairing.attempt(body.code, ip); return fail(res, 403, MSG.pairOff); }
    const result = deps.pairing.attempt(body.code, ip);
    if (result !== 'ok') { audit(null, 'pareamento_codigo_errado', `${ip} (${result})`); return fail(res, result === 'locked' ? 429 : 403, MSG.code); }
    if (deps.store.countDevices() >= MAX_DEVICES) { deps.pairing.release(); return fail(res, 403, MSG.limit); }
    const ua = deviceNameFromUA(req.headers['user-agent']), nickname = sanitizeName(body.deviceName), name = nickname || ua;
    const info: PairInfo = {name, nickname, ua, ip, sas: generateSas()};
    const p: Pending = {id: randomBytes(16).toString('base64url'), ip, code: normalizeCode(body.code), ctrl: new AbortController(), result: null, listeners: new Set(), waiters: 0, name};
    active = p; pendings.set(p.id, p);
    p.max = setTimeout(() => p.ctrl.abort(), maxMs); p.max.unref(); // no máximo 60 s no total
    audit(null, 'pareamento_pedido', `${name} (${ip})`);
    deps.confirmPair(info, p.ctrl.signal).catch(() => false).then(accepted => finish(p, accepted, info));
    arm(p);
    json(res, 202, {requestId: p.id, sas: info.sas});
  }
  async function pairWait(req: IncomingMessage, res: ServerResponse, ip: string, url: URL) {
    if (req.headers['x-ph-sw'] !== '1') return fail(res, 403, MSG.sw);
    if (!waitLimit.hit(ip)) return fail(res, 429, MSG.rate, {'Retry-After': '10'});
    const id = url.searchParams.get('id') ?? '', p = /^[\w-]{22}$/.test(id) ? pendings.get(id) : undefined;
    if (!p || p.ip !== ip) return fail(res, 404, MSG.notFound);
    p.waiters++; clearTimeout(p.abandon);
    let gone = false;
    if (!p.result) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); p.listeners.delete(done); req.off('close', onClose); resolve(); };
      const onClose = () => { gone = true; done(); };
      const timer = setTimeout(done, waitMs);
      p.listeners.add(done); req.once('close', onClose);
    });
    p.waiters--;
    if (gone) { arm(p); return; } // o celular desligou: sem resposta, e o pedido some se ele não voltar logo
    if (!p.result) { arm(p); return json(res, 202, {pending: true}); }
    pendings.delete(p.id);
    if (!p.result.accepted) return fail(res, 403, MSG.denied);
    json(res, 200, {ok: true, name: p.result.name}, {'Set-Cookie': p.result.cookie!});
  }

  function events(req: IncomingMessage, res: ServerResponse, device: DeviceRow) {
    const mine = [...streams.values()].filter(id => id === device.id).length;
    if (streams.size >= SSE_MAX || mine >= SSE_PER_DEVICE) return fail(res, 429, MSG.rate);
    req.socket.setTimeout(0); // só o SSE fica aberto além do limite de 30 s do soquete
    res.writeHead(200, {...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write(`retry: 5000\nevent: state\ndata: ${JSON.stringify({accounts: deps.api.accounts()})}\n\n`);
    streams.set(res, device.id); activity();
    req.on('close', () => { streams.delete(res); activity(); });
  }
  /** Consulta cara: no máximo 10/min por aparelho e chamadas iguais simultâneas dividem uma só execução. */
  async function expensive(res: ServerResponse, device: DeviceRow, key: string, run: () => Promise<unknown>) {
    if (!apiLimit.hit(device.id)) return fail(res, 429, MSG.rate, {'Retry-After': '30'});
    let work = inflight.get(key);
    if (!work) { work = run().finally(() => inflight.delete(key)); inflight.set(key, work); }
    json(res, 200, await work);
  }

  const INT = /^\d{1,3}$/;
  /** GETs de R3 (X-PH: 1 obrigatório): capturas, histórico de alertas, preferências e a chave pública VAPID. */
  function alertsGet(req: IncomingMessage, res: ServerResponse, device: DeviceRow, path: string, url: URL) {
    const a = deps.alerts!;
    if (req.headers['x-ph'] !== '1') return fail(res, 400, MSG.header);
    const limitRaw = url.searchParams.get('limit');
    if (limitRaw !== null && (!INT.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 200)) return fail(res, 400, MSG.json);
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (path === '/api/captures') {
      const profileId = url.searchParams.get('profileId'), only = url.searchParams.get('onlyAlerts');
      if (profileId !== null && !deps.api.accounts().some(x => x.id === profileId)) return fail(res, 404, MSG.notFound);
      if (only !== null && only !== '1' && only !== '0') return fail(res, 400, MSG.json);
      return json(res, 200, {captures: a.listCaptures(device.id, {...(profileId ? {profileId} : {}), onlyAlerts: only === '1', limit})});
    }
    if (path === '/api/alerts') return json(res, 200, {alerts: a.history(limit)});
    if (path === '/api/alerts/prefs') return json(res, 200, a.getPrefs(device.id));
    const publicKey = a.publicKey(); // só a chave PÚBLICA; a privada nunca sai do hub
    return publicKey ? json(res, 200, {publicKey}) : fail(res, 404, MSG.notFound);
  }
  async function alertsPost(req: IncomingMessage, res: ServerResponse, device: DeviceRow, path: string) {
    const a = deps.alerts!;
    const body = await readJson(req); // JSON obrigatório e corpo ≤ 8 KB em todos os POSTs
    if (body === 'big') return fail(res, 413, MSG.big);
    if (!body) return fail(res, 400, MSG.json);
    if (path === '/api/push/test') {
      const sent = await a.sendTest(device.id); // 3 a cada 10 min por aparelho
      return sent === null ? fail(res, 429, MSG.rate, {'Retry-After': '600'}) : json(res, 200, {sent});
    }
    if (!writeLimit.hit(device.id)) return fail(res, 429, MSG.rate, {'Retry-After': '60'});
    if (path === '/api/alerts/prefs') { const prefs = parsePrefs(body); return prefs ? json(res, 200, a.setPrefs(device.id, prefs)) : fail(res, 400, MSG.json); }
    if (path === '/api/push/unsubscribe') { if (typeof body.endpoint !== 'string') return fail(res, 400, MSG.json); a.unsubscribe(device.id, body.endpoint); return json(res, 200, {ok: true}); }
    const keys = typeof body.keys === 'object' && body.keys !== null && !Array.isArray(body.keys) ? body.keys as Record<string, unknown> : null;
    if (typeof body.endpoint !== 'string' || !keys || !a.subscribe(device.id, {endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth})) return fail(res, 400, MSG.json);
    audit(device.id, 'push_assinado', device.name);
    return json(res, 200, {ok: true});
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
      if (path === '/ca.crt' || path === '/ca.mobileconfig') {
        if (!deps.pairing.active) return fail(res, 404, MSG.notFound); // a CA só é baixada com o modo de pareamento ligado
        const der = deps.certs().caDer, fp6 = caFingerprint(der).slice(0, 6); // a impressão digital vai no nome do arquivo: dá para conferir com o PC
        return path === '/ca.crt' ? send(res, 200, der, 'application/x-x509-ca-cert', {'Content-Disposition': `attachment; filename="pokehub-ca-${fp6}.crt"`, 'Cache-Control': 'no-store'})
          : send(res, 200, mobileconfig(der), 'application/x-apple-aspen-config', {'Content-Disposition': `attachment; filename="pokehub-${fp6}.mobileconfig"`, 'Cache-Control': 'no-store'});
      }
      if (path === '/api/pair/wait') return pairWait(req, res, ip, url);
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
    const device = authenticate(req, res);
    if (!device) return fail(res, 401, MSG.auth);
    if (method === 'POST') {
      if (path === '/api/logout') { deps.store.revokeDevice(device.id); audit(device.id, 'saiu', device.name); closeStreams(device.id); return json(res, 200, {ok: true}, {'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`}); }
      if (deps.alerts && /^\/api\/(alerts\/prefs|push\/(subscribe|unsubscribe|test))$/.test(path)) return alertsPost(req, res, device, path);
      return fail(res, 404, MSG.notFound);
    }
    const idMatch = /^\/api\/(hunt|market)\/([\w-]{1,64})$/.exec(path);
    if (path === '/api/me') return json(res, 200, {name: device.name, canAct: device.canAct, pinSet: deps.store.getPinHash() !== null});
    if (path === '/api/state') return json(res, 200, {accounts: deps.api.accounts()});
    if (path === '/api/diag') return json(res, 200, deps.api.diag());
    if (path === '/api/events') return events(req, res, device);
    if (deps.alerts && /^\/api\/(captures|alerts|alerts\/prefs|push\/key)$/.test(path)) return alertsGet(req, res, device, path, url);
    if (idMatch) {
      if (req.headers['x-ph'] !== '1') return fail(res, 400, MSG.header); // um <img>/<a> de outro site não dispara a consulta
      const id = idMatch[2]!;
      if (!deps.api.accounts().some(a => a.id === id)) return fail(res, 404, MSG.notFound);
      if (idMatch[1] === 'hunt') { const all = url.searchParams.get('todas') !== '1'; return expensive(res, device, `hunt|${id}|${all}`, () => deps.api.hunt(id, all)); }
      const raw = url.searchParams.get('foco'), focus = raw === 'qualidade' || raw === 'desconto' ? raw : 'equilibrado';
      return expensive(res, device, `market|${id}|${focus}`, () => deps.api.market(id, focus));
    }
    return fail(res, 404, MSG.notFound);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const ip = unmapIPv4(req.socket.remoteAddress), local = unmapIPv4(req.socket.localAddress), mask = masks.get(local);
      if (!isAllowedRemote(ip) || !mask || !sameSubnet(ip, local, mask)) { req.socket.destroy(); return; } // fora da sub-rede da interface: some sem resposta
      const host = hostOnly(req.headers.host);
      if (!host || !allowedHosts.has(host)) return fail(res, 421, MSG.host); // proteção contra DNS rebinding
      if (!general.hit(ip)) return fail(res, 429, MSG.rate, {'Retry-After': '60'});
      await route(req, res, ip);
    } catch { try { fail(res, 500, MSG.fail); } catch { res.destroy(); } } // erro interno: nada do erro real sai
  }
  function closeStreams(deviceId: string) { for (const [res, id] of streams) if (id === deviceId) { streams.delete(res); res.end(); } }
  const drop = (res: ServerResponse) => { streams.delete(res); try { res.destroy(); } catch { /* já fechada */ } };

  return {
    /** Abre um listener por interface (só IPv4 privado/loopback). Com `port` 0 usa uma porta livre (testes). Devolve a porta. */
    async listen(binds: readonly Bind[], port: number): Promise<number> {
      if (servers.length) throw new Error('Já está escutando');
      const list = [...new Map(binds.filter(b => isAllowedRemote(b.address)).map(b => [b.address, b])).values()];
      if (!list.length) throw new Error('Sem endereço de rede');
      allowedHosts = new Set(['localhost', ...list.map(b => b.address)]); masks = new Map(list.map(b => [b.address, b.netmask]));
      const certs = deps.certs();
      let chosen = port;
      try {
        for (const bind of list) {
          const server = createServer({cert: certs.leafCert, key: certs.leafKey, minVersion: 'TLSv1.2', maxHeaderSize: 8192, handshakeTimeout: 10_000, connectionsCheckingInterval: 2000} as never, (req, res) => { void handle(req, res); });
          server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxConnections = 64;
          server.on('connection', (raw) => {
            const socket = raw as Socket, ip = unmapIPv4(socket.remoteAddress), mask = masks.get(unmapIPv4(socket.localAddress));
            if (!isAllowedRemote(ip) || !mask || !sameSubnet(ip, unmapIPv4(socket.localAddress), mask)) { socket.destroy(); return; }
            const count = (perIp.get(ip) ?? 0) + 1;
            if (count > CONN_PER_IP) { socket.destroy(); return; } // um único aparelho não esgota as 64 conexões
            perIp.set(ip, count); sockets.add(socket);
            socket.once('close', () => { sockets.delete(socket); const left = (perIp.get(ip) ?? 1) - 1; if (left <= 0) perIp.delete(ip); else perIp.set(ip, left); });
          });
          server.on('secureConnection', tls => { tls.setTimeout(SOCKET_TIMEOUT_MS); tls.on('timeout', () => tls.destroy()); });
          server.on('tlsClientError', (_error, socket) => socket.destroy());
          await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(chosen, bind.address, () => { server.off('error', reject); resolve(); }); });
          servers.push(server);
          if (chosen === 0) chosen = (server.address() as {port: number}).port;
        }
      } catch (error) { await this.close(); throw error; }
      heartbeat = setInterval(() => {
        for (const [res, id] of streams) {
          if (!deps.store.getDevice(id)) { closeStreams(id); continue; }
          if (isBackedUp(res)) { drop(res); continue; }
          try { res.write(': \n\n'); } catch { streams.delete(res); }
        }
      }, HEARTBEAT_MS);
      heartbeat.unref();
      return chosen;
    },
    /** Fecha todos os listeners e conexões (a porta deixa de responder) e cancela os pedidos de pareamento abertos. */
    async close(): Promise<void> {
      clearInterval(heartbeat); heartbeat = undefined;
      for (const res of streams.keys()) { try { res.end(); } catch { /* já fechada */ } }
      streams.clear();
      for (const p of pendings.values()) { clearTimeout(p.abandon); clearTimeout(p.max); if (!p.result) p.ctrl.abort(); }
      for (const socket of sockets) socket.destroy();
      sockets.clear(); perIp.clear();
      await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    },
    publish(event: string, data: unknown, filter?: (deviceId: string) => boolean): void {
      if (!/^[a-z-]{1,20}$/.test(event)) return;
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const [res, deviceId] of [...streams]) { if (filter && !filter(deviceId)) continue; if (isBackedUp(res)) { drop(res); continue; } try { res.write(frame); } catch { streams.delete(res); } } // quem não acompanha é desconectado (contrapressão)
    },
    /** Revogação: apaga o aparelho e derruba na hora os fluxos SSE dele. */
    revoke(deviceId: string): boolean { const ok = deps.store.revokeDevice(deviceId); closeStreams(deviceId); lastTouch.delete(deviceId); lastRenew.delete(deviceId); activity(); return ok; },
    sweepExpired,
    streamCount: () => streams.size,
    connectionCount: () => sockets.size,
    pendingCount: () => [...pendings.values()].filter(p => !p.result).length,
    listening: () => servers.length > 0 && servers.every(server => server.listening),
  };
}
export type RemoteServer = ReturnType<typeof createRemoteServer>;
