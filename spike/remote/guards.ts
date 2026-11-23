// Travas do acesso remoto, sem I/O (relógio injetável): código de pareamento, PIN com bloqueio, limite por IP e bloqueio do sono.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// --- Pareamento ---
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIR_TTL_MS = 120_000, PAIR_MAX_WRONG = 5, PAIR_CODE_LEN = 8;
/** Normaliza o que o usuário digitou: maiúsculas, sem separadores; I/L viram 1 e O vira 0 (Crockford). */
export const normalizeCode = (input: string): string => input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').slice(0, 32);
export const generateCode = (): string => Array.from({length: PAIR_CODE_LEN}, () => CROCKFORD[randomInt(32)]).join('');
export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export type PairAttempt = 'ok' | 'wrong' | 'expired' | 'inactive' | 'locked';
export class Pairing {
  private code: string | null = null; private expires = 0; private wrong = 0; private dead: 'expired' | 'locked' | null = null;
  constructor(private now: () => number = Date.now, private ttl = PAIR_TTL_MS, private maxWrong = PAIR_MAX_WRONG, private make: () => string = generateCode) {}
  start(): {code: string; expiresAt: number} { this.code = this.make(); this.expires = this.now() + this.ttl; this.wrong = 0; this.dead = null; return {code: this.code, expiresAt: this.expires}; }
  cancel(): void { this.code = null; this.dead = null; }
  /** Modo de pareamento ativo (código válido e não expirado): é o único momento em que a CA pode ser baixada. */
  get active(): boolean { return this.code !== null && this.now() < this.expires; }
  info(): {code: string; expiresAt: number; attemptsLeft: number} | null { return this.active && this.code ? {code: this.code, expiresAt: this.expires, attemptsLeft: this.maxWrong - this.wrong} : null; }
  /** Confere o código. Certo: consome (uso único). Errado: conta; ao passar do limite o código morre. */
  attempt(input: string): PairAttempt {
    if (this.code === null) return this.dead ?? 'inactive';
    if (this.now() >= this.expires) { this.code = null; this.dead = 'expired'; return 'expired'; }
    if (same(normalizeCode(input), this.code)) { this.code = null; this.dead = null; return 'ok'; }
    if (++this.wrong >= this.maxWrong) { this.code = null; this.dead = 'locked'; return 'locked'; }
    return 'wrong';
  }
}

// --- PIN ---
export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{6}$/.test(pin);
const SCRYPT = {N: 16384, r: 8, p: 1};
export function hashPin(pin: string): string {
  if (!validPin(pin)) throw new Error('PIN inválido');
  const salt = randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${scryptSync(pin, salt, 32, SCRYPT).toString('base64')}`;
}
export function verifyPinHash(pin: string, stored: string | null): boolean {
  if (!stored || !validPin(pin)) return false;
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  try {
    const want = Buffer.from(hash, 'base64'), got = scryptSync(pin, Buffer.from(salt, 'base64'), want.length, {N: Number(n), r: Number(r), p: Number(p)});
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}
export const PIN_MAX_WRONG = 5, PIN_LOCK_MS = 15 * 60_000;
export type PinCheck = {ok: true} | {ok: false; reason: 'no-pin' | 'wrong' | 'locked'; retryAfterMs?: number; attemptsLeft?: number};
/** Verificação do PIN por aparelho: 5 erros bloqueiam o aparelho por 15 min (o contador zera no acerto). Ações (R4) chamam `check` antes de agir. */
export class PinGuard {
  private fails = new Map<string, {n: number; until: number}>();
  constructor(private hash: () => string | null, private now: () => number = Date.now, private onLock: (deviceId: string) => void = () => undefined) {}
  check(deviceId: string, pin: unknown): PinCheck {
    const stored = this.hash();
    if (!stored) return {ok: false, reason: 'no-pin'};
    const state = this.fails.get(deviceId) ?? {n: 0, until: 0};
    if (state.until > this.now()) return {ok: false, reason: 'locked', retryAfterMs: state.until - this.now()};
    if (state.until !== 0) { state.n = 0; state.until = 0; } // bloqueio vencido: recomeça
    if (typeof pin === 'string' && verifyPinHash(pin, stored)) { this.fails.delete(deviceId); return {ok: true}; }
    state.n++;
    if (state.n >= PIN_MAX_WRONG) { state.until = this.now() + PIN_LOCK_MS; this.fails.set(deviceId, state); this.onLock(deviceId); return {ok: false, reason: 'locked', retryAfterMs: PIN_LOCK_MS}; }
    this.fails.set(deviceId, state);
    return {ok: false, reason: 'wrong', attemptsLeft: PIN_MAX_WRONG - state.n};
  }
  reset(deviceId?: string): void { if (deviceId) this.fails.delete(deviceId); else this.fails.clear(); }
}

// --- Limite por IP (janela deslizante) ---
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
/** Mantém o PC acordado só com o acesso remoto ligado e pelo menos uma conta aberta. */
export function createPowerGuard(blocker: Blocker) {
  let id: number | null = null;
  return {
    update(enabled: boolean, running: number): boolean {
      const want = enabled && running > 0;
      if (want && id === null) id = blocker.start('prevent-app-suspension');
      if (!want && id !== null) { try { blocker.stop(id); } finally { id = null; } }
      return id !== null;
    },
    held: () => id !== null,
  };
}
