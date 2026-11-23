// Tela ao vivo e modo Controlar (R5), sem Electron: tudo entra por `deps` (alvo de captura falso nos testes).
// Regras: só captura o `webContents` da conta (nunca a janela do hub: `forbidden`), só com a URL em https://pokeidle.io e sem campo de senha com foco;
// 1 espectador por conta e 2 no total; ver exige "pode agir" OU "pode controlar" (1 sessão por aparelho; ≤ 6 novas por minuto).
// Controlar = controle TOTAL da conta (sem teto, Market, venda/troca): exige a permissão SEPARADA "pode controlar" (só liberada no PC) + PIN DEDICADO (não é a elevação de compras), vale 10 min, sem renovar sem o PIN, 2 min de ociosidade.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CONTROL_IDLE_MS, CONTROL_TTL_MS, SCREEN_MAX_INBOUND, SCREEN_ORIGIN, SCREEN_PROTOCOL, encodeFrame, type ClientMsg, type ControlDenied, type ControlEndReason, type PauseReason, type RemoteScreenSession, type ScreenState, type ServerMsg } from '../contracts/screen';
import type { PinCheck } from './guards';
import { InputLimiter, sanitizeInput, type SendInput } from './screen-input';
import { acceptWebSocket, offeredProtocols, validHandshake, type WsConnection } from './ws';

export interface ScreenFrame { width: number; height: number; hash: string; jpeg(): Buffer }
export interface ScreenTarget {
  /** Identidade do que é capturado (o `webContents` da conta). Nunca pode ser a janela do hub. */
  key: unknown;
  url(): string; alive(): boolean; size(): {width: number; height: number};
  /** Há um campo de senha com foco na página? (falha = true: na dúvida, não mostra) */
  passwordFocused(): Promise<boolean>;
  /** `null` = quadro vazio (view oculta). */
  capture(opts: {maxWidth: number; quality: number}): Promise<ScreenFrame | null>;
  input(event: SendInput): void;
  /** Mantém a captura funcionando enquanto alguém assiste (view/janela oculta); devolve quem restaura exatamente o que foi mudado. */
  hold?(): () => void;
}
export interface ScreenDeps {
  accounts(): readonly {id: string; label: string; suspended: boolean}[];
  target(profileId: string): ScreenTarget | null;
  /** Alvos que NUNCA podem ser capturados (a janela do hub). */
  forbidden?(): readonly unknown[];
  device(id: string): {id: string; name: string; canAct: boolean; canControl: boolean} | null;
  pinSet(): boolean; actionsDisabled(): boolean;
  checkPin(deviceId: string, pin: unknown): Promise<PinCheck>;
  audit(deviceId: string | null, action: string, detail: string): void;
  /** Aviso no PC (notificação nativa + piscar a janela) quando um celular começa a ver/controlar. */ notify?(kind: 'tela' | 'controle', device: string, account: string): void;
  now?(): number; onChange?(): void; /** nº de sessões em controle mudou (atalho global do PC). */ onControl?(active: number): void;
  timing?: Partial<ScreenTiming>;
}
export interface ScreenTiming { frameMs: number; idleFrameMs: number; ackTimeoutMs: number; controlTtlMs: number; controlIdleMs: number; pingMs: number; deadMs: number; pausedMaxMs: number; tickMs: number; captureTimeoutMs: number; statsMs: number; maxWidth: number; quality: number; inFlight: number }
export const DEFAULT_TIMING: ScreenTiming = {frameMs: 500, idleFrameMs: 1000, ackTimeoutMs: 10_000, controlTtlMs: CONTROL_TTL_MS, controlIdleMs: CONTROL_IDLE_MS, pingMs: 20_000, deadMs: 60_000, pausedMaxMs: 10 * 60_000, tickMs: 1000, captureTimeoutMs: 2500, statsMs: 2000, maxWidth: 1280, quality: 60, inFlight: 2};
export const MAX_VIEWERS_TOTAL = 2, MAX_JSON = 4096, BACKLOG = 256 * 1024, MAX_STARTS_PER_MIN = 6, COALESCE_MS = 60_000;
/** Texto para o celular: se o soquete não escoa (celular parado), derruba a conexão em vez de acumular memória. */
export function guardedSend(ws: Pick<WsConnection, 'buffered' | 'sendText' | 'terminate'>, text: string): boolean {
  if (ws.buffered() > BACKLOG * 2) { ws.terminate(); return false; }
  return ws.sendText(text);
}

export const isGameOrigin = (url: string): boolean => { try { const u = new URL(url); return u.protocol === 'https:' && u.origin === SCREEN_ORIGIN; } catch { return false; } };
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> => new Promise(resolve => { const t = setTimeout(() => resolve('timeout'), ms); t.unref(); p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve('timeout'); }); });

interface Control { token: string; startedAt: number; expiresAt: number; lastInput: number }
interface Session {
  id: number; ws: WsConnection; deviceId: string; deviceName: string; profileId: string; label: string; startedAt: number;
  paused: PauseReason | null; state: ScreenState; seq: number; pending: Map<number, number>; lastHash: string | null; unchanged: number; frame: {w: number; h: number} | null;
  timer: ReturnType<typeof setTimeout> | undefined; stepping: boolean; closed: boolean; release: (() => void) | null; heldKey: unknown;
  lastInbound: number; pausedAt: number; lastPing: number; statsAt: number; frames: number; bytes: number; window: {frames: number; bytes: number}; rtt: number | null; bad: number; limitAt: number;
  control: Control | null; pinBusy: boolean; limiter: InputLimiter; pw: {at: number; on: boolean} | null; pwFlight: Promise<boolean> | null;
}

export function createScreen(deps: ScreenDeps) {
  const now = deps.now ?? Date.now, T: ScreenTiming = {...DEFAULT_TIMING, ...deps.timing};
  const sessions = new Set<Session>(); let ids = 0, sweeper: ReturnType<typeof setInterval> | undefined, lastControlCount = 0;
  const changed = () => { try { deps.onChange?.(); } catch { /* ouvinte */ } };
  const audit = (deviceId: string | null, action: string, detail: string) => { try { deps.audit(deviceId, action, detail); } catch { /* auditoria não derruba a sessão */ } };
  const controlCount = () => [...sessions].filter(s => s.control).length;
  const syncControl = () => { const n = controlCount(); if (n !== lastControlCount) { lastControlCount = n; try { deps.onControl?.(n); } catch { /* ouvinte */ } } };
  const send = (s: Session, msg: ServerMsg) => { if (!s.closed) guardedSend(s.ws, JSON.stringify(msg)); };
  const notify = (kind: 'tela' | 'controle', s: Session) => { try { deps.notify?.(kind, s.deviceName, s.label); } catch { /* aviso é opcional */ } };
  /** Novas sessões por aparelho (janela de 60 s) e linhas de auditoria repetidas (mesmo aparelho+conta em 60 s) viram UMA linha com contagem. */
  const starts = new Map<string, number[]>(), repeats = new Map<string, {at: number; n: number; deviceId: string; action: string; detail: string}>();
  const startAllowed = (deviceId: string) => { const t = now(), list = (starts.get(deviceId) ?? []).filter(x => t - x < 60_000); if (list.length >= MAX_STARTS_PER_MIN) { starts.set(deviceId, list); return false; } list.push(t); starts.set(deviceId, list); return true; };
  const flushRepeats = (all = false) => { const t = now(); for (const [k, e] of [...repeats]) if (all || t - e.at >= COALESCE_MS) { if (e.n > 0) audit(e.deviceId, `${e.action}_repetido`, `${e.detail}; +${e.n} em ${COALESCE_MS / 1000} s`); repeats.delete(k); } };
  const auditOnce = (deviceId: string, action: string, who: string, detail: string) => { flushRepeats(); const k = `${action}|${deviceId}|${who}`, e = repeats.get(k); if (e) { e.n++; return; } repeats.set(k, {at: now(), n: 0, deviceId, action, detail}); audit(deviceId, action, detail); };
  /** Dá a ESTA sessão a janela mantida viva (alvo que aparece depois do aceite ou que foi trocado também entra). */
  const ensureHold = (s: Session, t: ScreenTarget) => { if (s.release && s.heldKey === t.key) return; if (!t.hold) return; try { s.release?.(); } catch { /* restaurar não derruba */ } s.release = null; try { s.release = t.hold(); s.heldKey = t.key; } catch { s.release = null; } };
  const forbiddenTarget = (t: ScreenTarget) => (deps.forbidden?.() ?? []).includes(t.key);
  const secs = (from: number) => Math.max(0, Math.round((now() - from) / 1000));

  function setState(s: Session, state: ScreenState) { if (s.state === state) return; s.state = state; send(s, {t: 'status', state, ...(state === 'paused' && s.paused ? {reason: s.paused} : {})}); changed(); }
  function endControl(s: Session, reason: ControlEndReason) {
    const c = s.control; if (!c) return;
    s.control = null; send(s, {t: 'control', on: false, reason});
    audit(s.deviceId, 'controle_fim', `${s.label}; ${secs(c.startedAt)} s; ${reason}`); syncControl(); changed();
  }
  function end(s: Session, reason: string, code = 1000) {
    if (s.closed) return;
    endControl(s, 'sessao');
    send(s, {t: 'bye', reason}); s.closed = true; clearTimeout(s.timer); sessions.delete(s);
    try { s.release?.(); } catch { /* restaurar não pode derrubar o resto */ } s.release = null;
    auditOnce(s.deviceId, 'tela_fim', s.label, `${s.label}; ${secs(s.startedAt)} s; ${s.frames} quadros; ${reason}`);
    s.ws.close(code); if (!sessions.size) { clearInterval(sweeper); sweeper = undefined; }
    syncControl(); changed();
  }

  async function capture(s: Session): Promise<number> {
    const t = deps.target(s.profileId);
    if (!t || !t.alive() || forbiddenTarget(t)) { setState(s, 'unavailable'); return 2000; }
    ensureHold(s, t);
    if (s.paused) return T.frameMs;
    if (!isGameOrigin(t.url())) { s.lastHash = null; s.frame = null; setState(s, 'protected'); return T.idleFrameMs; } // login do Google/Discord, página de erro, qualquer outra origem
    if (s.pending.size >= T.inFlight) return 100; // espera os `ack` (sem eles em 10 s o sweep pausa)
    if (s.ws.buffered() > BACKLOG) return 200;
    if (await t.passwordFocused().catch(() => true)) { s.lastHash = null; setState(s, 'password'); return 700; }
    const frame = await withTimeout(t.capture({maxWidth: T.maxWidth, quality: T.quality}), T.captureTimeoutMs).catch(() => null);
    if (s.closed || s.paused) return T.frameMs;
    if (frame === 'timeout' || frame === null) { setState(s, 'hidden'); return 1000; }
    // a página pode ter mudado de origem ou focado uma senha enquanto o quadro era feito: confere de novo e descarta
    if (!isGameOrigin(t.url())) { s.lastHash = null; s.frame = null; setState(s, 'protected'); return T.idleFrameMs; }
    if (await t.passwordFocused().catch(() => true)) { s.lastHash = null; setState(s, 'password'); return 700; }
    setState(s, 'streaming');
    if (frame.hash === s.lastHash) { s.unchanged++; return s.unchanged >= 3 ? T.idleFrameMs : T.frameMs; } // só envia se mudou
    s.unchanged = 0; s.lastHash = frame.hash;
    const jpeg = frame.jpeg(), seq = ++s.seq, at = now(), data = encodeFrame({seq, w: frame.width, h: frame.height, at}, jpeg);
    if (!s.ws.sendBinary(data)) return T.frameMs;
    s.pending.set(seq, at); s.frame = {w: frame.width, h: frame.height}; s.frames++; s.bytes += data.length; s.window.frames++; s.window.bytes += data.length;
    return T.frameMs;
  }
  function wake(s: Session, delay = 0) {
    if (s.closed || s.stepping) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { void step(s); }, delay);
  }
  async function step(s: Session) {
    if (s.closed || s.stepping) return;
    s.stepping = true; let next: number;
    try { next = await capture(s); } catch { setState(s, 'unavailable'); next = 2000; }
    s.stepping = false; if (!s.closed) wake(s, next);
  }

  function pause(s: Session, why: PauseReason) { s.paused = why; s.pausedAt = now(); s.pending.clear(); s.state = 'paused'; send(s, {t: 'status', state: 'paused', reason: why}); changed(); }
  function resume(s: Session) { if (!s.paused) return; s.paused = null; s.lastHash = null; s.unchanged = 0; s.state = 'starting'; s.limitAt = 0; wake(s, 0); }
  function denied(s: Session, code: ControlDenied, extra: {attemptsLeft?: number; retryAfterMs?: number} = {}) { send(s, {t: 'denied', code, ...extra}); }

  async function startControl(s: Session, pin: unknown) {
    if (s.pinBusy) return; // uma tentativa de PIN por vez nesta conexão
    const dev = deps.device(s.deviceId);
    if (!dev) return end(s, 'revogado', 1008);
    if (!dev.canControl) return denied(s, 'sem-permissao'); // "pode agir" (compras) NÃO basta: Controlar é controle total, com permissão própria
    if (!deps.pinSet()) return denied(s, 'sem-pin');
    if (deps.actionsDisabled()) return denied(s, 'desligado');
    if ([...sessions].some(o => o !== s && o.profileId === s.profileId && o.control)) return denied(s, 'ocupado'); // um controlador por conta
    if (s.paused || s.state !== 'streaming') return denied(s, 'indisponivel');
    s.pinBusy = true;
    try {
      const r = await deps.checkPin(s.deviceId, pin);
      if (s.closed) return;
      if (!r.ok) {
        audit(s.deviceId, 'controle_pin_recusado', `${s.label}; ${r.reason}`);
        return denied(s, r.reason === 'wrong' ? 'pin' : r.reason === 'locked' ? 'bloqueado' : r.reason === 'revoked' ? 'revogado' : r.reason === 'no-pin' ? 'sem-pin' : 'desligado', {...(r.ok === false && r.attemptsLeft !== undefined ? {attemptsLeft: r.attemptsLeft} : {}), ...(r.ok === false && r.retryAfterMs !== undefined ? {retryAfterMs: r.retryAfterMs} : {})});
      }
      const again = deps.device(s.deviceId); // o PIN é assíncrono: reconfere a permissão no fim
      if (!again?.canControl || deps.actionsDisabled() || !deps.pinSet()) return denied(s, 'sem-permissao');
      if (s.control) endControl(s, 'encerrado'); // renovar = novo PIN e novo token (o antigo morre)
      const t = now(); s.control = {token: randomBytes(16).toString('hex'), startedAt: t, expiresAt: t + T.controlTtlMs, lastInput: t}; s.limiter = new InputLimiter(now);
      audit(s.deviceId, 'controle_inicio', `${s.label}; ${Math.round(T.controlTtlMs / 60_000)} min`);
      send(s, {t: 'control', on: true, token: s.control.token, expiresAt: s.control.expiresAt, idleMs: T.controlIdleMs}); syncControl(); notify('controle', s); changed();
    } finally { s.pinBusy = false; }
  }

  /** Por que o controle não vale mais (permissão, PIN, ações desligadas, 10 min, 2 min parado)? Conferido em CADA entrada e no sweep de 1 s. */
  function controlProblem(s: Session, c: Control): ControlEndReason | null {
    const dev = deps.device(s.deviceId), t = now();
    if (!dev?.canControl || deps.actionsDisabled() || !deps.pinSet()) return 'permissao';
    if (t >= c.expiresAt) return 'expirou';
    if (t - c.lastInput >= T.controlIdleMs) return 'ocioso';
    return null;
  }
  /** Há campo de senha com foco? `fresh` (texto) = sempre confere de novo; só UMA conferência por vez na sessão (`'busy'` = descarta o texto). */
  async function passwordCheck(s: Session, t: ScreenTarget, fresh: boolean): Promise<boolean | 'busy'> {
    if (s.pwFlight) return fresh ? 'busy' : s.pwFlight;
    if (!fresh && s.pw && now() - s.pw.at <= 250) return s.pw.on;
    const p = t.passwordFocused().catch(() => true); s.pwFlight = p;
    try { const on = await p; s.pw = {at: now(), on}; return on; } finally { s.pwFlight = null; }
  }
  async function handleInput(s: Session, token: unknown, raw: unknown) {
    const c = s.control;
    if (!c || typeof token !== 'string' || !same(token, c.token)) return; // sem token de controle válido a entrada é ignorada
    const bad = controlProblem(s, c); if (bad) { endControl(s, bad); return; } // não espera o sweep de 1 s
    const t = deps.target(s.profileId);
    if (s.paused || s.state !== 'streaming' || !t || !t.alive() || forbiddenTarget(t) || !isGameOrigin(t.url())) return; // pausado, protegido ou fora do jogo: nada entra
    const r = sanitizeInput(raw, s.frame, t.size());
    if (!r.ok) return;
    if (r.text) { // teclado e texto: nunca dentro de campo de senha (a senha do jogo não passa por aqui)
      const pw = await passwordCheck(s, t, r.events[0]?.type === 'char');
      if (pw === 'busy') return; // sem conferência pronta, nenhum caractere sai
      if (pw) { setState(s, 'password'); return; }
    }
    if (s.closed || s.control !== c) return;
    if (controlProblem(s, c)) return;
    if (!s.limiter.allow(r.chars)) { if (now() - s.limitAt > 1000) { s.limitAt = now(); send(s, {t: 'limit'}); } return; }
    c.lastInput = now();
    for (const e of r.events) { try { t.input(e); } catch { /* alvo fechando */ } }
    if (r.events.some(e => e.type === 'mouseDown' || e.type === 'mouseUp' || e.type === 'keyDown')) s.pw = null; // clique/Tab mudam o foco: o resultado guardado não vale mais
  }

  function onMessage(s: Session, data: string | Buffer, binary: boolean) {
    s.lastInbound = now();
    if (binary || typeof data !== 'string') return end(s, 'protocolo', 1003);
    if (data.length > MAX_JSON) return end(s, 'mensagem grande', 1009);
    let m: ClientMsg;
    try { m = JSON.parse(data) as ClientMsg; } catch { if (++s.bad > 10) end(s, 'protocolo', 1008); return; }
    if (typeof m !== 'object' || m === null) return;
    switch (m.t) {
      case 'ack': { const at = typeof m.seq === 'number' ? s.pending.get(m.seq) : undefined; if (at !== undefined) { s.rtt = now() - at; s.pending.delete(m.seq); for (const q of [...s.pending.keys()]) if (q < m.seq) s.pending.delete(q); } return; }
      case 'pause': pause(s, m.why === 'oculto' ? 'oculto' : 'usuario'); return;
      case 'resume': resume(s); return;
      case 'control': void startControl(s, m.pin).catch(() => denied(s, 'indisponivel')); return;
      case 'end-control': endControl(s, 'encerrado'); return;
      case 'in': void handleInput(s, m.token, m.e).catch(() => undefined); return;
      default: if (++s.bad > 10) end(s, 'protocolo', 1008);
    }
  }

  /** Confere tudo o que vence com o tempo: sem resposta, ack, controle (10 min / 2 min / permissão), ping e estatísticas. */
  function sweep() {
    const t = now(); flushRepeats();
    for (const s of [...sessions]) {
      if (!deps.device(s.deviceId)) { end(s, 'revogado', 1008); continue; }
      if (t - s.lastInbound > T.deadMs) { end(s, 'sem resposta', 1001); continue; } // ping/pong mantém vivo; ninguém respondendo = fecha
      if (s.paused && t - s.pausedAt > T.pausedMaxMs) { end(s, 'ocioso', 1000); continue; }
      if (!s.paused && s.pending.size) { const oldest = Math.min(...s.pending.values()); if (t - oldest > T.ackTimeoutMs) pause(s, 'sem-ack'); } // o celular parou de confirmar quadros
      const c = s.control;
      if (c) { const bad = controlProblem(s, c); if (bad) endControl(s, bad); } // 10 min (PIN de novo), 2 min parado, permissão/PIN/ações
      if (t - s.lastPing >= T.pingMs) { s.lastPing = t; s.ws.ping(); }
      if (t - s.statsAt >= T.statsMs && s.state === 'streaming') {
        const dt = Math.max(1, t - s.statsAt) / 1000; s.statsAt = t;
        send(s, {t: 'stats', fps: Math.round(s.window.frames / dt * 10) / 10, kbps: Math.round(s.window.bytes * 8 / 1000 / dt), rtt: s.rtt}); s.window = {frames: 0, bytes: 0};
      } else if (t - s.statsAt >= T.statsMs) s.statsAt = t;
    }
  }

  return {
    /** Upgrade já autenticado pelo servidor (Host, Origin e cookie conferidos). `null` = aceito (101 enviado); número = status HTTP a devolver. */
    accept(ctx: {req: IncomingMessage; socket: Duplex; head: Buffer; device: {id: string; name: string}; profileId: string}): number | null {
      const {req, socket, head, device, profileId} = ctx;
      if (!validHandshake(req) || !offeredProtocols(req).includes(SCREEN_PROTOCOL)) return 400;
      const acc = deps.accounts().find(a => a.id === profileId);
      if (!acc) return 404;
      if (acc.suspended) return 409;
      const perm = deps.device(device.id); // ver a tela exige "pode agir" ou "pode controlar": um aparelho recém-pareado só vê o resumo
      if (!perm || (!perm.canAct && !perm.canControl)) { auditOnce(device.id, 'tela_recusada', acc.label, `${acc.label}; sem permissão`); return 403; }
      const olds = [...sessions].filter(s => s.deviceId === device.id), others = [...sessions].filter(s => s.deviceId !== device.id); // 1 sessão por aparelho: a nova substitui a velha
      if (others.some(s => s.profileId === profileId)) return 429; // 1 espectador por conta
      if (others.length >= MAX_VIEWERS_TOTAL) return 429;
      const target = deps.target(profileId);
      if (target && forbiddenTarget(target)) { auditOnce(device.id, 'tela_recusada', acc.label, `${acc.label}; alvo proibido`); return 403; }
      if (!startAllowed(device.id)) return 429; // no máximo 6 sessões novas por minuto por aparelho
      for (const old of olds) end(old, 'substituída', 1000);
      const ws = acceptWebSocket(req, socket, head, SCREEN_PROTOCOL, SCREEN_MAX_INBOUND), t = now();
      const s: Session = {id: ++ids, ws, deviceId: device.id, deviceName: device.name, profileId, label: acc.label, startedAt: t, paused: null, state: 'starting', seq: 0, pending: new Map(), lastHash: null, unchanged: 0, frame: null, timer: undefined, stepping: false, closed: false, release: null,
        lastInbound: t, pausedAt: t, lastPing: t, statsAt: t, frames: 0, bytes: 0, window: {frames: 0, bytes: 0}, rtt: null, bad: 0, limitAt: 0, control: null, pinBusy: false, limiter: new InputLimiter(now), pw: null, pwFlight: null, heldKey: undefined};
      sessions.add(s);
      ws.onMessage((data, binary) => onMessage(s, data, binary));
      ws.onPong(() => { s.lastInbound = now(); });
      ws.onClose(() => { if (!s.closed) end(s, 'conexão encerrada', 1006); });
      if (target) ensureHold(s, target);
      auditOnce(device.id, 'tela_inicio', acc.label, `${acc.label}; ${device.name}`); notify('tela', s);
      send(s, {t: 'hello', v: 1, profileId, label: acc.label, canAct: perm.canAct, canControl: perm.canControl, pinSet: deps.pinSet(), maxWidth: T.maxWidth, ttlMs: T.controlTtlMs, idleMs: T.controlIdleMs});
      sweeper ??= (() => { const i = setInterval(sweep, T.tickMs); i.unref(); return i; })();
      wake(s, 0); syncControl(); changed();
      return null;
    },
    /** Revogação, expiração ou saída do aparelho: fecha tudo dele. */
    closeDevice(deviceId: string, reason = 'revogado'): number { let n = 0; for (const s of [...sessions]) if (s.deviceId === deviceId) { end(s, reason, 1008); n++; } return n; },
    /** Acesso remoto desligado, rede mudou ou o app está saindo. */
    closeAll(reason = 'desligado'): void { for (const s of [...sessions]) end(s, reason, 1001); flushRepeats(true); },
    /** PC: botão "Encerrar controle" e Ctrl+Shift+F12. Sem argumento, de todos. */
    endControl(reason: ControlEndReason = 'pc', profileId?: string): number { let n = 0; for (const s of [...sessions]) if (s.control && (!profileId || s.profileId === profileId)) { endControl(s, reason); n++; } return n; },
    /** PC: "Encerrar tudo" (corta a visualização também). */
    endAll(reason = 'encerrado no PC'): void { for (const s of [...sessions]) end(s, reason, 1000); flushRepeats(true); },
    /** Permissão/PIN mudou para este aparelho: derruba só o controle dele (a visão continua se ele ainda pode ver). */
    endDeviceControl(deviceId: string, reason: ControlEndReason = 'permissao'): number { let n = 0; for (const s of [...sessions]) if (s.deviceId === deviceId && s.control) { endControl(s, reason); n++; } return n; },
    /** A conta está em controle remoto agora? (trava a navegação em pokeidle.io) */
    controlling: (profileId: string): boolean => [...sessions].some(s => s.profileId === profileId && s.control !== null),
    watching: (profileId: string): boolean => [...sessions].some(s => s.profileId === profileId),
    sessions: (): RemoteScreenSession[] => [...sessions].map(s => ({deviceId: s.deviceId, device: s.deviceName, account: s.label, profileId: s.profileId, control: s.control !== null, since: s.startedAt, controlUntil: s.control?.expiresAt ?? null})),
    count: () => sessions.size,
    sweep,
  };
}
export type Screen = ReturnType<typeof createScreen>;
