// Ponte com o navegador para notificações: permissão, assinatura Web Push e registro no PC. Só roda por toque do usuário (exceto reassinar, que não pede permissão).
import { get, post } from './api';
import { detectIos, pushState, subscriptionBody, urlBase64ToUint8Array, type PushEnv, type PushState } from './push-helpers';

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('tempo esgotado')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e instanceof Error ? e : new Error('falha')); }); });
const isStandalone = () => (navigator as Navigator & {standalone?: boolean}).standalone === true || matchMedia('(display-mode: standalone)').matches;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
  try { return await withTimeout(navigator.serviceWorker.ready, 5000); } catch { return null; }
}
export async function readPushEnv(): Promise<PushEnv> {
  const hasNotification = 'Notification' in window, hasSw = window.isSecureContext && 'serviceWorker' in navigator;
  let subscribed = false;
  if (hasSw && 'PushManager' in window) { try { const reg = await navigator.serviceWorker.getRegistration('/'); subscribed = !!(await reg?.pushManager.getSubscription()); } catch { /* sem leitura */ } }
  return {secure: window.isSecureContext, hasSw, hasPush: 'PushManager' in window, hasNotification, permission: hasNotification ? Notification.permission : 'unsupported', subscribed, ios: detectIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), standalone: isStandalone()};
}
export const readPushState = async (): Promise<PushState> => pushState(await readPushEnv());

export type Outcome = {ok: true; sent?: number} | {ok: false; error: string};
/** Chamar SÓ dentro do toque em "Ativar notificações": a permissão é a primeira coisa pedida. */
export async function enablePush(): Promise<Outcome> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return {ok: false, error: permission === 'denied' ? 'As notificações foram bloqueadas. Libere nas configurações do navegador para este site.' : 'Você não permitiu as notificações.'};
    const reg = await registration(); if (!reg) return {ok: false, error: 'O app ainda não foi ativado neste navegador (certificado do PokéHub).'};
    const {publicKey} = await get<{publicKey: string}>('/api/push/key');
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey)});
    const body = subscriptionBody(sub.toJSON()); if (!body) { await sub.unsubscribe().catch(() => false); return {ok: false, error: 'O navegador devolveu uma assinatura inválida.'}; }
    const sent = await post('/api/push/subscribe', body);
    if (!sent.ok) { await sub.unsubscribe().catch(() => false); return {ok: false, error: sent.error ?? 'O PC não aceitou a assinatura.'}; }
    return {ok: true};
  } catch { return {ok: false, error: 'Não foi possível ativar agora. Confira a conexão e tente de novo.'}; }
}
export async function disablePush(): Promise<Outcome> {
  try {
    const reg = await registration(), sub = await reg?.pushManager.getSubscription();
    if (sub) { await post('/api/push/unsubscribe', {endpoint: sub.endpoint}); await sub.unsubscribe(); }
    return {ok: true};
  } catch { return {ok: false, error: 'Não foi possível desativar agora.'}; }
}
export async function sendTest(): Promise<Outcome> {
  try {
    const r = await post('/api/push/test', {}); if (!r.ok) return {ok: false, error: r.error ?? 'O PC não conseguiu enviar o teste.'};
    const sent = (r.data as {sent?: unknown} | null)?.sent; return {ok: true, sent: typeof sent === 'number' ? sent : 0};
  } catch { return {ok: false, error: 'Sem conexão com o PC.'}; }
}
/** O navegador trocou a assinatura (ou o PC perdeu a nossa): reenvia a atual, sem pedir permissão. */
export async function resyncPush(): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await registration(), sub = await reg?.pushManager.getSubscription(), body = subscriptionBody(sub?.toJSON());
    if (body) await post('/api/push/subscribe', body);
  } catch { /* sem rede: tenta na próxima abertura */ }
}
