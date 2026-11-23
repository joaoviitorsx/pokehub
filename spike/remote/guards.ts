// Travas do acesso remoto, sem I/O de rede (relógio injetável): código de pareamento, PIN com bloqueios escalonados e persistentes,
// limite por IP e bloqueio do sono.
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { PinStateRow } from './store';

// --- Pareamento ---
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIR_TTL_MS = 120_000, PAIR_MAX_WRONG_IP = 5, PAIR_MAX_WRONG_GLOBAL = 20, PAIR_CODE_LEN = 8;
/** Normaliza o que o usuário digitou: maiúsculas, sem separadores; I/L viram 1 e O vira 0 (Crockford). */
export const normalizeCode = (input: string): string => input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').slice(0, 32);
export const generateCode = (): string => Array.from({length: PAIR_CODE_LEN}, () => CROCKFORD[randomInt(32)]).join('');
export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;
/** Número de 2 dígitos que o celular e o PC mostram juntos (SAS): amarra o pedido da tela do PC ao aparelho que digitou o código. */
export const generateSas = (): string => String(randomInt(100)).padStart(2, '0');
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export type PairAttempt = 'ok' | 'wrong' | 'expired' | 'inactive' | 'locked';
/** Código de pareamento (uso único). Erros contam por IP (5 bloqueiam só aquele IP) e no total (20 matam o código): um vizinho não consegue queimar o código sozinho. */
export class Pairing {
  private code: string | null = null; private expires = 0; private wrong = 0; private byIp = new Map<string, number>(); private dead: 'expired' | 'locked' | null = null; private consumed: string | null = null;
  constructor(private now: () => number = Date.now, private ttl = PAIR_TTL_MS, private maxIp = PAIR_MAX_WRONG_IP, private make: () => string = generateCode, private maxGlobal = PAIR_MAX_WRONG_GLOBAL) {}
  start(): {code: string; expiresAt: number} { this.code = this.make(); this.expires = this.now() + this.ttl; this.wrong = 0; this.byIp.clear(); this.dead = null; this.consumed = null; return {code: this.code, expiresAt: this.expires}; }
  cancel(): void { this.code = null; this.dead = null; this.consumed = null; }
  /** Modo de pareamento ativo (código válido e não expirado): é o único momento em que a CA pode ser baixada. */
  get active(): boolean { return this.code !== null && this.now() < this.expires; }
  info(): {code: string; expiresAt: number; attemptsLeft: number; byIp: {ip: string; wrong: number; left: number}[]} | null {
    return this.active && this.code ? {code: this.code, expiresAt: this.expires, attemptsLeft: this.maxGlobal - this.wrong, byIp: [...this.byIp].map(([ip, wrong]) => ({ip, wrong, left: Math.max(0, this.maxIp - wrong)}))} : null;
  }
  /** Confere o código. Certo: consome (uso único). Errado: conta por IP e no total. */
  attempt(input: string, ip = '?'): PairAttempt {
    if (this.code === null) return this.dead ?? 'inactive';
    if (this.now() >= this.expires) { this.code = null; this.dead = 'expired'; return 'expired'; }
    if ((this.byIp.get(ip) ?? 0) >= this.maxIp) return 'locked'; // este IP já gastou as tentativas (nem o código certo vale)
    if (same(normalizeCode(input), this.code)) { this.consumed = this.code; this.code = null; this.dead = null; return 'ok'; }
    const mine = (this.byIp.get(ip) ?? 0) + 1; this.byIp.set(ip, mine);
    if (++this.wrong >= this.maxGlobal) { this.code = null; this.dead = 'locked'; return 'locked'; }
    return mine >= this.maxIp ? 'locked' : 'wrong';
  }
  /** O código já consumido (pedido ainda pendente no PC) foi digitado de novo? Sinal de que outra pessoa também o conhece. */
  reused(input: string): boolean { return this.consumed !== null && same(normalizeCode(input), this.consumed); }
  release(): void { this.consumed = null; }
}

// --- PIN ---
export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{6}$/.test(pin);
const SCRYPT = {N: 16384, r: 8, p: 1}; // parâmetros fixos: o que vem gravado no hash é ignorado (um banco adulterado não enfraquece a verificação)
const scryptAsync = (pin: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => scrypt(pin, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
export async function hashPin(pin: string): Promise<string> {
  if (!validPin(pin)) throw new Error('PIN inválido');
  const salt = randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${(await scryptAsync(pin, salt)).toString('base64')}`;
}
export async function verifyPinHash(pin: string, stored: string | null): Promise<boolean> {
  if (!stored || !validPin(pin)) return false;
  const [kind, , , , salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  try {
    const want = Buffer.from(hash, 'base64'), got = await scryptAsync(pin, Buffer.from(salt, 'base64'));
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}
export const PIN_MAX_WRONG = 5, PIN_LOCKS_MS = [15 * 60_000, 60 * 60_000, 24 * 60 * 60_000] as const, PIN_LOCK_MS = PIN_LOCKS_MS[0], PIN_GLOBAL_DAILY = 10;
export type PinCheck = {ok: true} | {ok: false; reason: 'no-pin' | 'wrong' | 'locked' | 'disabled' | 'revoked'; retryAfterMs?: number; attemptsLeft?: number};
/** Onde o PIN guarda os contadores: o banco no app (sobrevive a reiniciar o acesso remoto) ou memória nos testes. */
export interface PinStore { get(key: string): PinStateRow | null; set(key: string, state: PinStateRow): void; delete(key: string): void; actionsDisabled(): boolean; setActionsDisabled(value: boolean): void }
export const memoryPinStore = (): PinStore => { const map = new Map<string, PinStateRow>(); let off = false; return {get: k => map.get(k) ?? null, set: (k, s) => { map.set(k, {...s}); }, delete: k => { map.delete(k); }, actionsDisabled: () => off, setActionsDisabled: v => { off = v; }}; };
export interface PinEvents { onLock?(deviceId: string, level: number, untilMs: number): void; onRevoke?(deviceId: string): void; onDisable?(): void }
/** PIN por aparelho: 5 erros bloqueiam (15 min → 1 h → 24 h; o ciclo de 5 erros seguinte REVOGA o aparelho). 10 erros no dia (todos os aparelhos) desligam as ações até religar no PC. Persistente; scrypt assíncrono. */
export class PinGuard {
  constructor(private hash: () => string | null, private now: () => number = Date.now, private events: PinEvents = {}, private store: PinStore = memoryPinStore()) {}
  async check(deviceId: string, pin: unknown): Promise<PinCheck> {
    const stored = this.hash();
    if (!stored) return {ok: false, reason: 'no-pin'};
    if (this.store.actionsDisabled()) return {ok: false, reason: 'disabled'};
    const locked = this.lockLeft(deviceId);
    if (locked > 0) return {ok: false, reason: 'locked', retryAfterMs: locked};
    const good = typeof pin === 'string' && await verifyPinHash(pin, stored);
    const again = this.lockLeft(deviceId); // uma tentativa em paralelo pode ter bloqueado enquanto o scrypt rodava
    if (again > 0) return {ok: false, reason: 'locked', retryAfterMs: again};
    if (good) { this.store.delete(deviceId); return {ok: true}; }
    const t = this.now(), state = this.store.get(deviceId) ?? {fails: 0, level: 0, lockedUntil: 0, day: null};
    if (state.lockedUntil !== 0) { state.fails = 0; state.lockedUntil = 0; } // bloqueio vencido: novo ciclo (o nível continua)
    state.fails++;
    this.countGlobal(t);
    if (this.store.actionsDisabled()) { this.store.set(deviceId, state); return {ok: false, reason: 'disabled'}; }
    if (state.fails < PIN_MAX_WRONG) { this.store.set(deviceId, state); return {ok: false, reason: 'wrong', attemptsLeft: PIN_MAX_WRONG - state.fails}; }
    state.level++; state.fails = 0;
    if (state.level > PIN_LOCKS_MS.length) { this.store.delete(deviceId); this.events.onRevoke?.(deviceId); return {ok: false, reason: 'revoked'}; }
    const ms = PIN_LOCKS_MS[state.level - 1]!; state.lockedUntil = t + ms; this.store.set(deviceId, state); this.events.onLock?.(deviceId, state.level, state.lockedUntil);
    return {ok: false, reason: 'locked', retryAfterMs: ms};
  }
  private lockLeft(deviceId: string): number { const s = this.store.get(deviceId); return s && s.lockedUntil > this.now() ? s.lockedUntil - this.now() : 0; }
  private countGlobal(t: number): void {
    const day = new Date(t).toISOString().slice(0, 10), g = this.store.get('*') ?? {fails: 0, level: 0, lockedUntil: 0, day};
    if (g.day !== day) { g.fails = 0; g.day = day; }
    g.fails++; this.store.set('*', g);
    if (g.fails >= PIN_GLOBAL_DAILY && !this.store.actionsDisabled()) { this.store.setActionsDisabled(true); this.events.onDisable?.(); }
  }
  /** Sem argumento: o usuário religou as ações no PC (ou trocou o PIN) e tudo zera. Com um aparelho: só ele. */
  reset(deviceId?: string): void { if (deviceId) this.store.delete(deviceId); else { this.store.setActionsDisabled(false); this.store.delete('*'); } }
}

// --- Limite por chave (janela deslizante) ---
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}
  /** Registra um uso; false = acima do limite (o chamador responde 429). */
  hit(key: string): boolean {
    const t = this.now(), list = (this.hits.get(key) ?? []).filter(at => t - at < this.windowMs);
    if (list.length >= this.limit) { this.hits.set(key, list); return false; }
    list.push(t); this.hits.set(key, list);
    if (this.hits.size > 2000) for (const [k, v] of this.hits) if (v.every(at => t - at >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}

// --- Sono do PC ---
export interface Blocker { start(type: 'prevent-app-suspension'): number; stop(id: number): void }
/** Mantém o PC acordado só com o servidor realmente escutando e pelo menos uma conta aberta. */
export function createPowerGuard(blocker: Blocker) {
  let id: number | null = null;
  return {
    update(listening: boolean, running: number): boolean {
      const want = listening && running > 0;
      if (want && id === null) id = blocker.start('prevent-app-suspension');
      if (!want && id !== null) { try { blocker.stop(id); } finally { id = null; } }
      return id !== null;
    },
    held: () => id !== null,
  };
}
