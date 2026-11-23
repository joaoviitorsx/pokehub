// Cliente da API do PokéHub no celular. Cookie HttpOnly vai sozinho (same-origin); 401 = não pareado.
export class Unauthorized extends Error {}
export interface Account { id: string; label: string; color: string; state: string; suspended: boolean }
export interface Me { name: string; canAct: boolean; pinSet: boolean }
async function parse(res: Response): Promise<unknown> { try { return await res.json(); } catch { return null; } }
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {credentials: 'same-origin', cache: 'no-store'});
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(String((await parse(res) as {error?: string} | null)?.error ?? 'Falha ao consultar o PC.'));
  return await res.json() as T;
}
export async function post(path: string, body: unknown): Promise<{ok: boolean; status: number; error?: string}> {
  const res = await fetch(path, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await parse(res) as {error?: string} | null;
  return {ok: res.ok, status: res.status, error: data?.error};
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
