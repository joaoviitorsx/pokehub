// WebSocket (RFC 6455) mínimo, só do lado do servidor, sem dependência: handshake, quadros mascarados do cliente, texto/binário/ping/pong/close.
// Decisões: SEM extensões (nada de permessage-deflate), SEM fragmentação (mensagem = 1 quadro; fragmento fecha com 1003), payload máximo
// configurável conferido ANTES de acumular (1009), cliente sempre mascarado (1002), RSV ≠ 0 (1002), texto UTF-8 válido (1007).
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const acceptKey = (key: string): string => createHash('sha1').update(key + GUID).digest('base64');
const decoder = new TextDecoder('utf-8', {fatal: true});

/** Subprotocolos oferecidos pelo cliente (`Sec-WebSocket-Protocol: a, b`). */
export const offeredProtocols = (req: Pick<IncomingMessage, 'headers'>): string[] => {
  const raw = req.headers['sec-websocket-protocol'];
  return (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
};
/** Cabeçalhos do upgrade corretos (GET, Upgrade: websocket, Connection: Upgrade, versão 13, chave de 16 bytes)? */
export function validHandshake(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  const h = req.headers, key = h['sec-websocket-key'];
  return req.method === 'GET' && String(h.upgrade ?? '').toLowerCase() === 'websocket' && String(h.connection ?? '').toLowerCase().split(',').some(v => v.trim() === 'upgrade')
    && h['sec-websocket-version'] === '13' && typeof key === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(key);
}

export interface WsOptions { maxPayload: number }
export class WsConnection {
  private buf: Buffer = Buffer.alloc(0); private closed = false; private closeSent = false; private peerCode: number | null = null; private killer: ReturnType<typeof setTimeout> | undefined;
  private messageCb: (data: string | Buffer, binary: boolean) => void = () => undefined;
  private closeCb: (code: number) => void = () => undefined;
  private pongCb: () => void = () => undefined;
  constructor(private socket: Duplex, head: Buffer, private opts: WsOptions) {
    socket.on('data', chunk => this.feed(chunk as Buffer));
    socket.on('close', () => this.finish(1006));
    socket.on('error', () => this.finish(1006));
    if (head.length) queueMicrotask(() => this.feed(head));
  }
  onMessage(cb: (data: string | Buffer, binary: boolean) => void) { this.messageCb = cb; }
  onClose(cb: (code: number) => void) { this.closeCb = cb; }
  onPong(cb: () => void) { this.pongCb = cb; }
  get open(): boolean { return !this.closed && !this.closeSent; }
  /** Bytes ainda não enviados ao celular (contrapressão). */
  buffered(): number { return (this.socket as {writableLength?: number}).writableLength ?? 0; }
  sendText(text: string): boolean { return this.write(0x1, Buffer.from(text, 'utf8')); }
  sendBinary(data: Uint8Array): boolean { return this.write(0x2, Buffer.from(data.buffer, data.byteOffset, data.byteLength)); }
  ping(): boolean { return this.write(0x9, Buffer.alloc(0)); }
  /** Fecha com o código dado (envia o quadro de close e derruba o soquete em até 1 s se o celular não responder). */
  close(code = 1000): void {
    if (this.closed) return;
    if (!this.closeSent) { const p = Buffer.alloc(2); p.writeUInt16BE(code); this.write(0x8, p, true); this.closeSent = true; }
    clearTimeout(this.killer); this.killer = setTimeout(() => this.terminate(), 1000); this.killer.unref();
    try { this.socket.end(); } catch { /* já fechado */ }
  }
  terminate(): void { try { this.socket.destroy(); } catch { /* já fechado */ } this.finish(1006); }
  private write(opcode: number, payload: Buffer, force = false): boolean {
    if (this.closed || (this.closeSent && !force) || !this.socket.writable) return false;
    const n = payload.length, head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    try { this.socket.write(Buffer.concat([head, payload])); return true; } catch { return false; }
  }
  private fail(code: number) { this.close(code); }
  private finish(code: number) { if (this.closed) return; this.closed = true; code = this.peerCode ?? code; clearTimeout(this.killer); this.buf = Buffer.alloc(0); try { this.closeCb(code); } catch { /* ouvinte */ } }
  private feed(chunk: Buffer) {
    if (this.closed || this.closeSent) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = (b[0]! & 0x80) !== 0, rsv = b[0]! & 0x70, opcode = b[0]! & 0x0f, masked = (b[1]! & 0x80) !== 0; let len = b[1]! & 0x7f, off = 2;
      if (rsv !== 0 || !masked) return this.fail(1002); // cliente sem máscara ou bits reservados: violação do protocolo
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(this.opts.maxPayload)) return this.fail(1009); len = Number(big); off = 10; }
      if (len > this.opts.maxPayload) return this.fail(1009); // conferido antes de acumular o corpo
      if (opcode >= 0x8 && (len > 125 || !fin)) return this.fail(1002);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] = data[i]! ^ mask[i & 3]!;
      this.buf = b.subarray(off + 4 + len);
      if (opcode === 0x0 || (!fin && (opcode === 0x1 || opcode === 0x2))) return this.fail(1003); // sem fragmentação
      if (opcode === 0x1) { let text: string; try { text = decoder.decode(data); } catch { return this.fail(1007); } this.messageCb(text, false); }
      else if (opcode === 0x2) this.messageCb(data, true);
      else if (opcode === 0x8) { const c = len >= 2 ? data.readUInt16BE(0) : 1000, ok = c >= 1000 && c < 5000 && c !== 1005 && c !== 1006; this.peerCode = ok ? c : 1000; this.close(this.peerCode); return; }
      else if (opcode === 0x9) this.write(0xa, data);
      else if (opcode === 0xa) this.pongCb();
      else return this.fail(1002);
      if (this.closed || this.closeSent) return;
    }
  }
}

/** Responde o 101 (com o subprotocolo escolhido) e devolve a conexão. O chamador já validou Host, Origin e autenticação. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, protocol: string, maxPayload: number): WsConnection {
  const key = String(req.headers['sec-websocket-key']);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\nSec-WebSocket-Protocol: ${protocol}\r\n\r\n`);
  return new WsConnection(socket, head, {maxPayload});
}
const STATUS: Record<number, string> = {400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 421: 'Misdirected Request', 426: 'Upgrade Required', 429: 'Too Many Requests', 503: 'Service Unavailable'};
/** Recusa o upgrade com uma resposta HTTP simples (sem corpo, sem detalhes) e fecha o soquete. */
export function rejectUpgrade(socket: Duplex, status: number): void {
  try { socket.end(`HTTP/1.1 ${status} ${STATUS[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`); } catch { /* já fechado */ }
  setTimeout(() => { try { socket.destroy(); } catch { /* já fechado */ } }, 500).unref();
}
