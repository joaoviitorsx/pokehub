// Envio de Web Push (RFC 8030/8291/8292) com a biblioteca `web-push` SÓ para cifrar e assinar (VAPID); o envio em si é nosso:
// endpoint conferido numa allowlist (anti-SSRF), https:443, sem redirecionamento, 5 s, resposta ignorada. A chave privada VAPID é gerada uma vez
// e guardada cifrada (safeStorage) em <userData>/remote; nunca é servida, logada nem devolvida por IPC.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import webpush from 'web-push';
import type { SecretBox } from './certs';
import { PUSH_URL_PATTERN, type PushPayload } from '../contracts/remote';

/** Assunto do VAPID: genérico de propósito (nunca o e-mail do usuário). Não pode ser localhost: a Apple recusa (BadJwtToken). */
export const VAPID_SUBJECT = 'mailto:pokehub@example.com';
export const PUSH_TIMEOUT_MS = 5000, PUSH_TTL_S = 3600, PUSH_MAX_BYTES = 1024, ENDPOINT_MAX = 1024, FAIL_LIMIT = 5, VAPID_EXP_MAX_S = 12 * 3600;
const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com']);
const HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];

/** Endpoint de push aceito? https, porta 443, sem usuário/senha, host fora de IP literal e dentro da allowlist dos serviços dos navegadores. Devolve a URL normalizada (é ESTA que vai à rede). */
export function validateEndpoint(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > ENDPOINT_MAX || /[\s\p{Cc}\\]/u.test(endpoint)) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443') || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host.startsWith('[') || isIP(host) !== 0 || /^[\d.]+$/.test(host) || host.endsWith('.') || host.includes('..')) return null;
  const ok = EXACT_HOSTS.has(host) || HOST_SUFFIXES.some(suffix => host.length > suffix.length && host.endsWith(suffix));
  return ok ? url : null;
}
export const validPushUrl = (value: unknown): value is string => typeof value === 'string' && PUSH_URL_PATTERN.test(value);
const b64url = /^[A-Za-z0-9_-]+$/;
/** Chaves da assinatura enviadas pelo navegador: p256dh = ponto P-256 não comprimido (65 bytes), auth = 16 bytes. */
export function validKeys(p256dh: unknown, auth: unknown): boolean {
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !b64url.test(p256dh) || !b64url.test(auth)) return false;
  const pub = Buffer.from(p256dh, 'base64url'), secret = Buffer.from(auth, 'base64url');
  return pub.length === 65 && pub[0] === 4 && secret.length === 16;
}
/** Texto do payload (JSON ≤ 1 KB): corta o texto se preciso; recusa url fora da allowlist. */
export function buildPayload(p: PushPayload): string {
  if (!validPushUrl(p.url)) throw new Error('url de push inválida');
  let text = p.text.slice(0, 120);
  for (;;) {
    const body = JSON.stringify({kind: p.kind, label: p.label.slice(0, 40), text, at: p.at, url: p.url});
    if (Buffer.byteLength(body) <= PUSH_MAX_BYTES) return body;
    if (text.length <= 10) throw new Error('payload grande demais');
    text = text.slice(0, Math.floor(text.length / 2));
  }
}

const PLAIN = Buffer.from('PHPLAIN1\n'), SEALED = Buffer.from('PHENC1\n');
/** `regenerated`: foi criada agora; `replaced`: já existia uma chave que não deu para abrir e foi trocada (as assinaturas antigas deixam de valer). */
export interface Vapid { publicKey: string; privateKey: string; regenerated: boolean; replaced: boolean }
/** Gera o par VAPID uma vez; a privada fica cifrada com o `box` (safeStorage) quando existe. Se não der para abrir (outro usuário/máquina), refaz (`regenerated`: as assinaturas antigas deixam de valer). */
export function ensureVapid(dir: string, box?: SecretBox): Vapid {
  mkdirSync(dir, {recursive: true});
  let existed = false;
  const pubFile = join(dir, 'vapid.pub'), keyFile = join(dir, 'vapid.key');
  if (existsSync(pubFile) && existsSync(keyFile)) {
    existed = true;
    try {
      const publicKey = readFileSync(pubFile, 'utf8').trim(), raw = readFileSync(keyFile);
      let privateKey: string | null = null;
      if (raw.subarray(0, SEALED.length).equals(SEALED)) privateKey = box ? box.decrypt(raw.subarray(SEALED.length)) : null;
      else if (raw.subarray(0, PLAIN.length).equals(PLAIN)) privateKey = raw.subarray(PLAIN.length).toString('utf8').trim();
      if (privateKey && b64url.test(publicKey) && b64url.test(privateKey) && Buffer.from(privateKey, 'base64url').length === 32) {
        if (box && raw.subarray(0, PLAIN.length).equals(PLAIN)) writeFileSync(keyFile, Buffer.concat([SEALED, box.encrypt(privateKey)]), {mode: 0o600}); // havia só texto e agora há cifra: sobe de nível
        return {publicKey, privateKey, regenerated: false, replaced: false};
      }
    } catch { /* ilegível: refaz */ }
  }
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(keyFile, box ? Buffer.concat([SEALED, box.encrypt(keys.privateKey)]) : Buffer.concat([PLAIN, Buffer.from(keys.privateKey)]), {mode: 0o600});
  writeFileSync(pubFile, keys.publicKey, {mode: 0o600});
  try { chmodSync(keyFile, 0o600); } catch { /* Windows: a pasta já é restrita ao usuário */ }
  return {publicKey: keys.publicKey, privateKey: keys.privateKey, regenerated: true, replaced: existed};
}

export type PushFetch = (url: string, init: {method: string; headers: Record<string, string>; body: Buffer; redirect: 'error'; signal: AbortSignal; credentials: 'omit'}) => Promise<{status: number; body?: {cancel(): Promise<void>} | null}>;
export type SendResult = 'ok' | 'gone' | 'fail' | 'rejected';
export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface PushDeps { dir: string; box?: SecretBox; fetcher?: PushFetch; timeoutMs?: number }

export function createPush(deps: PushDeps) {
  const vapid = ensureVapid(deps.dir, deps.box);
  const fetcher: PushFetch = deps.fetcher ?? ((url, init) => fetch(url, init as RequestInit));
  return {
    publicKey: vapid.publicKey,
    /** Uma chave anterior não pôde ser aberta e foi trocada: assinaturas antigas não servem mais. */
    replaced: vapid.replaced,
    /** Envia um payload (JSON texto ≤ 1 KB) à assinatura. 'rejected' = endpoint fora da allowlist ou dados inválidos (nada vai à rede); 'gone' = 404/410. */
    async send(sub: PushSub, body: string, urgency: 'normal' | 'high' = 'normal'): Promise<SendResult> {
      const url = validateEndpoint(sub.endpoint);
      if (!url || !validKeys(sub.p256dh, sub.auth) || Buffer.byteLength(body) > PUSH_MAX_BYTES) return 'rejected';
      try {
        const details = webpush.generateRequestDetails({endpoint: url.href, keys: {p256dh: sub.p256dh, auth: sub.auth}}, body, {vapidDetails: {subject: VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey}, TTL: PUSH_TTL_S, urgency, contentEncoding: 'aes128gcm'}) as {headers: Record<string, string>; body: Buffer};
        const res = await fetcher(url.href, {method: 'POST', headers: details.headers, body: details.body, redirect: 'error', signal: AbortSignal.timeout(deps.timeoutMs ?? PUSH_TIMEOUT_MS), credentials: 'omit'});
        try { await res.body?.cancel(); } catch { /* resposta ignorada */ }
        if (res.status >= 200 && res.status < 300) return 'ok';
        return res.status === 404 || res.status === 410 ? 'gone' : 'fail';
      } catch { return 'fail'; } // rede, tempo esgotado, redirecionamento: tudo vira falha, sem detalhes
    },
  };
}
export type Push = ReturnType<typeof createPush>;
