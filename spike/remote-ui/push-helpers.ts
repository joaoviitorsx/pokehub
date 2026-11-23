// Funções puras do app do celular para alertas e notificações (testáveis sem navegador).
import type { AlertKind, AlertPrefs, RemoteAlert, RemoteCapture } from './r3-types';

export const ALERT_KINDS: readonly AlertKind[] = ['shiny', 'p5', 'recorde', 'nota', 'conta_caiu', 'conta_voltou'];
export const KIND_TEXT: Record<AlertKind, string> = {shiny: 'Shiny', p5: 'P5', recorde: 'Recorde', nota: 'Nota alta', conta_caiu: 'Conta caiu', conta_voltou: 'Conta voltou'};
/** Mesma regra do service worker: só os destinos conhecidos. */
export const PUSH_URL_RE = /^#(alertas|contas|conta\/[0-9a-f-]{36})$/;
export const safePushUrl = (url: unknown): string => typeof url === 'string' && PUSH_URL_RE.test(url) ? url : '#alertas';
export const NOTA_MAX = 10, NOTA_STEP = .5, NOTA_DEFAULT = 7; // Nota do jogo vai de 0 a 10 (ex.: "N 5,692")
export const DEFAULT_PREFS: AlertPrefs = {shiny: true, p5: true, recorde: false, notaMin: null, contaCaiu: true}; // igual a DEFAULT_ALERT_PREFS do servidor

/** Chave pública VAPID (base64url) → bytes, no formato que `pushManager.subscribe` pede. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded), out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Aceita a resposta do PC ({prefs} ou direto) e devolve preferências válidas; tudo que for estranho cai no padrão. */
export function normalizePrefs(input: unknown): AlertPrefs {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {}, v = o.prefs && typeof o.prefs === 'object' ? o.prefs as Record<string, unknown> : o;
  const flag = (x: unknown, d: boolean) => typeof x === 'boolean' ? x : d;
  const nota = typeof v.notaMin === 'number' && Number.isFinite(v.notaMin) && v.notaMin >= 0 ? Math.min(NOTA_MAX, Math.round(v.notaMin * 2) / 2) : null;
  return {shiny: flag(v.shiny, true), p5: flag(v.p5, true), recorde: flag(v.recorde, false), notaMin: nota, contaCaiu: flag(v.contaCaiu, true)};
}
export const stepNota = (current: number | null, dir: 1 | -1): number => Math.min(NOTA_MAX, Math.max(0, (current ?? NOTA_DEFAULT) + dir * NOTA_STEP));

export type PushEnv = {secure: boolean; hasSw: boolean; hasPush: boolean; hasNotification: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean; ios: boolean; standalone: boolean};
export type PushState = 'install-ios' | 'insecure' | 'unsupported' | 'denied' | 'on' | 'off';
/** Estado da seção "Notificações neste celular". Ordem: iOS fora da tela inicial, sem HTTPS confiável/SW, sem suporte, bloqueado, ligado/desligado. */
export function pushState(e: PushEnv): PushState {
  if (e.ios && !e.standalone) return 'install-ios';
  if (!e.secure || !e.hasSw) return 'insecure';
  if (!e.hasPush || !e.hasNotification) return 'unsupported';
  if (e.permission === 'denied') return 'denied';
  return e.permission === 'granted' && e.subscribed ? 'on' : 'off';
}

export interface PushKeys { endpoint: string; keys: {p256dh: string; auth: string} }
/** Valida o resultado de `subscription.toJSON()` antes de mandar ao PC. */
export function subscriptionBody(json: {endpoint?: string; keys?: Record<string, string>} | null | undefined): PushKeys | null {
  const {endpoint, keys} = json ?? {};
  return typeof endpoint === 'string' && /^https:\/\//.test(endpoint) && keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string' && keys.p256dh && keys.auth ? {endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}} : null;
}

export const captureKey = (c: {profileId: string; name: string; at: string; time: string}) => `${c.profileId}|${c.name}|${c.at}|${c.time}`;
/** Junta capturas novas (ao vivo) com as já lidas, sem repetir, da mais recente para a mais antiga. */
export function mergeCaptures(live: readonly RemoteCapture[], base: readonly RemoteCapture[], max = 200): RemoteCapture[] {
  const seen = new Set<string>(), out: RemoteCapture[] = [];
  for (const c of [...live, ...base]) { const k = captureKey(c); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}
export const mergeAlerts = (incoming: readonly RemoteAlert[], base: readonly RemoteAlert[], max = 200): RemoteAlert[] => {
  const seen = new Set<string>(), out: RemoteAlert[] = [];
  for (const a of [...incoming, ...base]) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
};
/** Conta com alerta de queda ativo = o último aviso de estado dela é "conta_caiu". */
export function downAccounts(alerts: readonly RemoteAlert[]): Set<string> {
  const last = new Map<string, RemoteAlert>();
  for (const a of alerts) if ((a.kind === 'conta_caiu' || a.kind === 'conta_voltou') && (!last.get(a.profileId) || Date.parse(a.at) > Date.parse(last.get(a.profileId)!.at))) last.set(a.profileId, a);
  return new Set([...last].filter(([, a]) => a.kind === 'conta_caiu').map(([id]) => id));
}
export const isAlertKind = (x: unknown): x is AlertKind => typeof x === 'string' && (ALERT_KINDS as readonly string[]).includes(x);
export const isRemoteAlert = (x: unknown): x is RemoteAlert => { const a = x as RemoteAlert | null; return !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.at === 'string' && isAlertKind(a.kind) && typeof a.profileId === 'string' && typeof a.label === 'string' && typeof a.text === 'string'; };
export const isRemoteCapture = (x: unknown): x is RemoteCapture => { const c = x as RemoteCapture | null; return !!c && typeof c === 'object' && typeof c.profileId === 'string' && typeof c.name === 'string' && typeof c.at === 'string' && typeof c.time === 'string' && typeof c.shiny === 'boolean' && typeof c.record === 'boolean'; };
export const detectIos = (ua: string, platform = '', touch = 0) => /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);

export type Tab = 'contas' | 'conta' | 'loja' | 'mercado' | 'alertas';
const LIVE_TABS: readonly string[] = ['contas', 'conta', 'loja', 'mercado', 'alertas'];
/** #alertas, #contas, #conta/<id> (o que o push manda) e os links antigos (#conta, #mercado, #saude). Abas "em breve" caem em Contas. */
export function resolveHash(hash: string): {tab: Tab; account?: string} {
  const h = hash.replace(/^#/, ''), m = /^conta\/(.+)$/.exec(h);
  if (m && /^[0-9a-f-]{36}$/.test(m[1]!)) return {tab: 'conta', account: m[1]};
  return {tab: LIVE_TABS.includes(h) ? h as Tab : 'contas'};
}
