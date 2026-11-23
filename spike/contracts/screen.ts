// Protocolo da tela ao vivo e do modo Controlar (R5): WebSocket `/api/screen/:profileId`, subprotocolo `ph.v1`.
// Isomórfico (hub e celular). NUNCA carrega emailLabel, URL, token de sessão do jogo nem nada além do que está escrito aqui.
export const SCREEN_PROTOCOL = 'ph.v1';
export const SCREEN_ORIGIN = 'https://pokeidle.io';
export const SCREEN_MAX_INBOUND = 64 * 1024; // maior mensagem aceita do celular (RFC 6455: payload)
export const CONTROL_TTL_MS = 10 * 60_000, CONTROL_IDLE_MS = 2 * 60_000;

/** `streaming` = quadros chegando; `protected` = a conta não está em pokeidle.io (login do Google/Discord etc.); `password` = campo de senha com foco; `hidden` = o hub não conseguiu capturar. */
export type ScreenState = 'starting' | 'streaming' | 'paused' | 'protected' | 'password' | 'hidden' | 'unavailable';
export type PauseReason = 'usuario' | 'oculto' | 'sem-ack';
export type ControlEndReason = 'encerrado' | 'expirou' | 'ocioso' | 'pc' | 'permissao' | 'sessao' | 'pausado' | 'navegacao';
export type ControlDenied = 'sem-permissao' | 'sem-pin' | 'desligado' | 'pin' | 'bloqueado' | 'revogado' | 'ocupado' | 'indisponivel';

/** Entrada que o celular pode pedir. Tudo é revalidado no PC (lista fechada); coordenadas em pixels da imagem do último quadro. */
export type InputEvent =
  | {k: 'md' | 'mu'; x: number; y: number; n?: 1 | 2}
  | {k: 'mm'; x: number; y: number; down?: boolean}
  | {k: 'wh'; x: number; y: number; dx: number; dy: number}
  | {k: 'kd' | 'ku'; key: string; m?: string[]}
  | {k: 'ch'; text: string};

export type ClientMsg =
  | {t: 'ack'; seq: number}
  | {t: 'pause'; why?: 'usuario' | 'oculto'}
  | {t: 'resume'}
  | {t: 'control'; pin: string}
  | {t: 'end-control'}
  | {t: 'in'; token: string; e: InputEvent};

export interface ScreenHello { t: 'hello'; v: 1; profileId: string; label: string; canAct: boolean; /** R5: tem a permissão separada de controlar (PC) */ canControl: boolean; pinSet: boolean; maxWidth: number; ttlMs: number; idleMs: number }
export type ServerMsg =
  | ScreenHello
  | {t: 'status'; state: ScreenState; reason?: PauseReason}
  | {t: 'stats'; fps: number; kbps: number; rtt: number | null}
  | {t: 'control'; on: true; token: string; expiresAt: number; idleMs: number}
  | {t: 'control'; on: false; reason: ControlEndReason}
  | {t: 'denied'; code: ControlDenied; attemptsLeft?: number; retryAfterMs?: number}
  | {t: 'limit'}
  | {t: 'bye'; reason: string};

/** Cabeçalho de um quadro (JPEG). `at` é o relógio do PC em ms (só para a latência). */
export interface FrameHeader { seq: number; w: number; h: number; at: number }
/** Quadro = mensagem binária: [4 bytes: tamanho do cabeçalho JSON, big-endian][cabeçalho JSON][bytes do JPEG]. */
export function encodeFrame(header: FrameHeader, jpeg: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header)), out = new Uint8Array(4 + head.length + jpeg.length);
  new DataView(out.buffer).setUint32(0, head.length); out.set(head, 4); out.set(jpeg, 4 + head.length);
  return out;
}
export function decodeFrame(data: ArrayBuffer | Uint8Array): {header: FrameHeader; jpeg: Uint8Array} | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 6) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (n < 2 || n > 512 || 4 + n >= bytes.length) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n))) as FrameHeader;
    if (![header.seq, header.w, header.h, header.at].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    return {header, jpeg: bytes.subarray(4 + n)};
  } catch { return null; }
}

/** O que o PC mostra no banner ("Celular X está vendo Y"). Sem token, sem e-mail. */
export interface RemoteScreenSession { deviceId: string; device: string; account: string; profileId: string; control: boolean; since: number; controlUntil: number | null }
