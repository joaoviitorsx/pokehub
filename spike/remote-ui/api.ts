// Cliente da API do PokéHub no celular. Cookie HttpOnly vai sozinho (same-origin); 401 = não pareado.
export class Unauthorized extends Error {}
export interface Account { id: string; label: string; color: string; state: string; suspended: boolean }
export interface Me { name: string; canAct: boolean; pinSet: boolean; actions?: import('../contracts/remote').ActionsState }
async function parse(res: Response): Promise<unknown> { try { return await res.json(); } catch { return null; } }
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {credentials: 'same-origin', cache: 'no-store', headers: {'X-PH': '1'}}); // X-PH: as consultas caras exigem o cabeçalho (um <img> de outro site não manda)
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(String((await parse(res) as {error?: string} | null)?.error ?? 'Falha ao consultar o PC.'));
  return await res.json() as T;
}
export async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ok: boolean; status: number; error?: string; data?: unknown}> {
  const res = await fetch(path, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  const data = await parse(res) as {error?: string} | null;
  return {ok: res.ok, status: res.status, error: data?.error, data};
}
/** Impressão digital esperada, vinda do QR (`#fp=<sha256>`), em blocos de 4; null se ausente/inválida. O fragmento nunca vai para o servidor. */
export function expectedFingerprint(hash: string): string | null {
  const m = /(?:^#|&)fp=([0-9a-fA-F]{64})(?:&|$)/.exec(hash);
  return m ? (m[1]!.toUpperCase().match(/.{4}/g) ?? []).join(' ') : null;
}
export interface PairStart { requestId: string; sas: string }
/** Passo 1: manda o código; o PC responde 202 com o número de conferência (SAS) e o id do pedido. */
export async function startPair(code: string, deviceName: string): Promise<{ok: true; start: PairStart} | {ok: false; error: string}> {
  const res = await fetch('/api/pair', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, deviceName})});
  const data = await parse(res) as {error?: string; requestId?: string; sas?: string} | null;
  return res.status === 202 && typeof data?.requestId === 'string' && typeof data.sas === 'string' ? {ok: true, start: {requestId: data.requestId, sas: data.sas}} : {ok: false, error: data?.error ?? 'Não foi possível parear.'};
}
/** Passo 2: consulta longa (o servidor segura até 25 s) até o PC decidir; o cookie vem na resposta 200. Para no máximo 60 s no total. */
export async function waitPair(id: string, signal: AbortSignal, totalMs = 60_000): Promise<{ok: boolean; error?: string}> {
  const end = Date.now() + totalMs;
  while (Date.now() < end && !signal.aborted) {
    const res = await fetch(`/api/pair/wait?id=${encodeURIComponent(id)}`, {credentials: 'same-origin', cache: 'no-store', signal});
    if (res.status === 202) continue;
    const data = await parse(res) as {error?: string} | null;
    return res.ok ? {ok: true} : {ok: false, error: data?.error ?? 'O pedido não foi aceito.'};
  }
  return {ok: false, error: 'O PC não respondeu a tempo. Gere outro código.'};
}
export const STATE_TEXT: Record<string, string> = {ready: 'Pronta', loading: 'Carregando', suspended: 'Suspensa', offline: 'Sem conexão', auth_required: 'Precisa entrar', error: 'Com erro'};
const nf = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1});
export const num = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? nf.format(value) : '—';
export const compact = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1}).format(value) : '—';
export const mb = (kb: number | null | undefined) => typeof kb === 'number' ? `${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0}).format(kb / 1024)} MB` : '—';
export function ago(at: number | null, now: number): string {
  if (at === null) return 'sem dados';
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 10 ? 'agora' : s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.floor(s / 60)} min` : `há ${Math.floor(s / 3600)} h`;
}
