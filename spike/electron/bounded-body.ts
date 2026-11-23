export const MAX_SPRITES_BYTES = 64 * 1024;
/** Lê o corpo de uma resposta como JSON contando bytes no fluxo: passou do limite, cancela a leitura (vale mesmo sem content-length). */
export async function readJsonBounded(response: {body: ReadableStream<Uint8Array> | null; headers: {get(name: string): string | null}}, max = MAX_SPRITES_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (!response.body || declared > max) { await response.body?.cancel().catch(() => undefined); throw new Error('resposta grande demais'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => undefined); throw new Error('resposta grande demais'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock?.(); }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
