// Tela ao vivo FALSA para a prévia do celular (só desenvolvimento): WebSocket `/api/screen/:id` no servidor do Vite, com o mesmo protocolo `ph.v1` do hub.
// Manda um quadro (PNG de um "jogo" de mentira, o navegador identifica o formato pelos bytes) a ~1 fps, confirma `ack`, aceita o PIN 123456 e conta os eventos de entrada.
// GET /__mock/screen?state=streaming|protected|password|hidden troca o estado mostrado; GET /__mock/screen-log devolve os eventos recebidos.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';
import { CONTROL_IDLE_MS, CONTROL_TTL_MS, SCREEN_MAX_INBOUND, SCREEN_PROTOCOL, encodeFrame, type ClientMsg, type ScreenState, type ServerMsg } from '../contracts/screen';
import { acceptWebSocket, offeredProtocols, validHandshake, type WsConnection } from '../remote/ws';

const W = 640, H = 360;
/** PNG (RGBA 8 bits) de um "jogo" de mentira: céu, grama quadriculada, HUD de madeira, um bichinho e um contador que muda a cada quadro. */
export function placeholderPng(tick: number): Uint8Array {
  const px = Buffer.alloc(W * H * 4); const rect = (x: number, y: number, w: number, h: number, c: number) => { for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) { const o = (j * W + i) * 4; px[o] = c >> 16 & 255; px[o + 1] = c >> 8 & 255; px[o + 2] = c & 255; px[o + 3] = 255; } };
  rect(0, 0, W, 200, 0x6ec6ff); rect(0, 200, W, 160, 0x4cae4f);
  for (let y = 200; y < H; y += 32) for (let x = (y / 32) % 2 ? 0 : 32; x < W; x += 64) rect(x, y, 32, 32, 0x439b46);
  rect(0, 0, W, 40, 0x6b4423); rect(0, 36, W, 4, 0x3b2410); rect(10, 8, 120, 24, 0x2b1a0c); rect(14, 12, 60 + tick % 40, 16, 0xf2c14e);
  const bx = 220 + (tick % 8) * 6; rect(bx, 250, 70, 56, 0xf5d142); rect(bx + 8, 238, 14, 16, 0xf5d142); rect(bx + 48, 238, 14, 16, 0xf5d142); rect(bx + 16, 266, 8, 8, 0x222222); rect(bx + 46, 266, 8, 8, 0x222222); rect(bx + 28, 282, 14, 6, 0xd9534f);
  for (let i = 0; i < 6; i++) rect(30 + i * 100, 80 + (i % 2) * 20, 70, 22, 0xffffff);
  rect(250, 120, 140, 50, 0x6b4423); rect(254, 124, 132, 42, 0xfff1c9); for (let i = 0; i < 6; i++) rect(262 + i * 20, 138, 12, 12, tick % 6 === i ? 0xd9534f : 0x6b4423);
  const raw = Buffer.alloc((W * 4 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export const screenMock = {state: 'streaming' as ScreenState, log: [] as unknown[]};
/** Trata o upgrade `/api/screen/:id`; devolve false se não for dele (o HMR do Vite segue). */
export function mockScreenUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const m = /^\/api\/screen\/([\w-]{1,64})$/.exec(new URL(req.url ?? '/', 'http://x').pathname); if (!m) return false;
  if (!validHandshake(req) || !offeredProtocols(req).includes(SCREEN_PROTOCOL)) { socket.destroy(); return true; }
  const ws: WsConnection = acceptWebSocket(req, socket, head, SCREEN_PROTOCOL, SCREEN_MAX_INBOUND), out = (msg: ServerMsg) => ws.sendText(JSON.stringify(msg));
  let seq = 0, tick = 0, token = '', shown: ScreenState | null = null, wrong = 0, pausedBy = false; const sentAt = new Map<number, number>(); let rtt: number | null = null;
  out({t: 'hello', v: 1, profileId: m[1]!, label: 'Principal', canAct: true, canControl: true, pinSet: true, maxWidth: W, ttlMs: CONTROL_TTL_MS, idleMs: CONTROL_IDLE_MS});
  const timer = setInterval(() => {
    if (pausedBy) return;
    if (shown !== screenMock.state) { shown = screenMock.state; out({t: 'status', state: shown}); }
    if (shown !== 'streaming' || sentAt.size >= 2) return;
    const png = placeholderPng(tick++); ws.sendBinary(encodeFrame({seq: ++seq, w: W, h: H, at: Date.now()}, png)); sentAt.set(seq, Date.now());
    if (tick % 2 === 0) out({t: 'stats', fps: 1.2, kbps: Math.round(png.length * 8 / 1000), rtt});
  }, 800);
  ws.onClose(() => clearInterval(timer));
  ws.onMessage(data => {
    let msg: ClientMsg; try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
    if (msg.t === 'ack') { const at = sentAt.get(msg.seq); if (at) rtt = Date.now() - at; sentAt.delete(msg.seq); }
    else if (msg.t === 'pause') { pausedBy = true; shown = 'paused'; out({t: 'status', state: 'paused', reason: msg.why ?? 'usuario'}); }
    else if (msg.t === 'resume') { pausedBy = false; shown = null; }
    else if (msg.t === 'control') {
      if (msg.pin === '123456') { token = 'mock-token'; out({t: 'control', on: true, token, expiresAt: Date.now() + CONTROL_TTL_MS, idleMs: CONTROL_IDLE_MS}); }
      else out({t: 'denied', code: 'pin', attemptsLeft: Math.max(0, 4 - wrong++)});
    } else if (msg.t === 'end-control') { token = ''; out({t: 'control', on: false, reason: 'encerrado'}); }
    else if (msg.t === 'in' && msg.token === token && token) screenMock.log.push(msg.e);
  });
  return true;
}
