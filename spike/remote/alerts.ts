// Motor de alertas do acesso remoto (R3): recebe capturas novas e mudanças de estado das contas, grava o histórico (7 dias, ≤1000),
// publica `capture`/`alert` por SSE e manda Web Push (agrupado) só para os aparelhos cujas preferências combinam.
// O leitor de capturas só fica ligado enquanto o acesso remoto está de fato escutando E há quem precise (push assinado ou SSE aberto).
import { randomUUID } from 'node:crypto';
import { alertText, alertsOf, type Capture } from '../domain/captures';
import { DEFAULT_ALERT_PREFS, type AlertKind, type AlertPrefs, type RemoteAlert, type RemoteCapture } from '../contracts/remote';
import { RateLimiter } from './guards';
import { FAIL_LIMIT, buildPayload, validKeys, validateEndpoint, type Push, type PushSub } from './push';
import type { RemoteStore } from './store';

export const DOWN_AFTER_MS = 5 * 60_000, GROUP_MS = 2 * 60_000, TEST_LIMIT = 3, TEST_WINDOW_MS = 10 * 60_000, TEXT_MAX = 120;
export interface AlertProfile { id: string; label: string; colorToken: string }
export interface CaptureSource { subscribe(fn: (event: {captures: Capture[]}) => void): () => void; list(query: {profileId?: string; onlyAlerts?: boolean; limit?: number; notaMin?: number | null}): Capture[] }
export interface AlertEngineDeps {
  store: RemoteStore; push: () => Push | null; captures: CaptureSource; profiles(): readonly AlertProfile[];
  /** Acesso remoto escutando de verdade? */ running(): boolean; /** Fluxos SSE abertos. */ streams(): number;
  publish(event: string, data: unknown, filter?: (deviceId: string) => boolean): void;
  now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
}

/** Valida as preferências de alerta (corpo do POST): chaves exatas, booleanos e nota mínima 0–10 ou null. */
export function parsePrefs(value: unknown): AlertPrefs | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>, keys = Object.keys(v).sort().join(',');
  if (keys !== 'contaCaiu,notaMin,p5,recorde,shiny') return null;
  if (typeof v.shiny !== 'boolean' || typeof v.p5 !== 'boolean' || typeof v.recorde !== 'boolean' || typeof v.contaCaiu !== 'boolean') return null;
  if (v.notaMin !== null && (typeof v.notaMin !== 'number' || !Number.isFinite(v.notaMin) || v.notaMin < 0 || v.notaMin > 10)) return null;
  return {shiny: v.shiny, p5: v.p5, recorde: v.recorde, notaMin: v.notaMin, contaCaiu: v.contaCaiu};
}
/** Prefs gravadas → válidas (banco adulterado cai no padrão). */
const prefsOr = (value: AlertPrefs | null): AlertPrefs => parsePrefs(value) ?? {...DEFAULT_ALERT_PREFS};
const PRIORITY: AlertKind[] = ['shiny', 'p5', 'nota', 'recorde'];
const clip = (text: string, max = TEXT_MAX) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const urlFor = (profileId: string) => /^[\w-]{1,64}$/.test(profileId) ? `#conta/${profileId}` : '#contas';
const colorOf = (token: string) => /^#[0-9a-f]{3,8}$/i.test(token) ? token : '#d4a65f';

export function createAlertEngine(deps: AlertEngineDeps) {
  const now = deps.now ?? Date.now, setT = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)), clearT = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const tests = new RateLimiter(TEST_LIMIT, TEST_WINDOW_MS, now);
  const groups = new Map<string, {at: number; pending: number}>(); // `${aparelho}|${tipo}` → último push e quantos foram suprimidos desde então
  const down = new Map<string, number>(), fell = new Set<string>(); // conta → desde quando está fora; contas com "caiu" já avisado
  let unsubscribe: (() => void) | null = null, timer: unknown = null, closed = false;
  const iso = () => new Date(now()).toISOString();
  const profileOf = (id: string) => deps.profiles().find(p => p.id === id);
  const toRemote = (c: Capture): RemoteCapture | null => {
    const p = profileOf(c.profileId); if (!p) return null;
    const {hints: _hints, ...rest} = c; void _hints; // as dicas internas e o e-mail da conta nunca saem
    return {...rest, label: p.label, color: colorOf(p.colorToken)};
  };
  const devicePrefs = () => deps.store.listDevices().map(d => ({id: d.id, prefs: prefsOr(deps.store.getPrefs(d.id))}));
  /** Tipos de um alerta que este aparelho quer, conforme as preferências dele. */
  type Picker = (prefs: AlertPrefs) => AlertKind[];
  const forCapture = (c: Capture): Picker => prefs => alertsOf(c, {notaMin: prefs.notaMin}).filter(k => k === 'nota' || prefs[k]);
  const forAccount = (kind: AlertKind): Picker => prefs => prefs.contaCaiu ? [kind] : [];

  /** Envia o push do alerta aos aparelhos interessados: no máx. 1 por aparelho e tipo a cada 2 min; o seguinte avisa "+N". */
  async function deliver(alert: RemoteAlert, targets: {id: string}[]): Promise<void> {
    const push = deps.push(); if (!push) return;
    const jobs: Promise<boolean>[] = [];
    for (const device of targets) {
      const subs = deps.store.pushOf(device.id); if (!subs.length) continue;
      const gk = `${device.id}|${alert.kind}`, g = groups.get(gk), t = now();
      if (g && t - g.at < GROUP_MS) { g.pending++; continue; }
      const more = g?.pending ?? 0; groups.set(gk, {at: t, pending: 0});
      const text = more > 0 ? clip(`${alert.text} (+${more})`) : alert.text;
      const url = alert.kind === 'conta_caiu' || alert.kind === 'conta_voltou' ? urlFor(alert.profileId) : '#alertas';
      let body: string; try { body = buildPayload({kind: alert.kind, label: alert.label, text, at: alert.at, url}); } catch { continue; }
      const urgent = alert.kind === 'shiny' || alert.kind === 'p5' ? 'high' : 'normal';
      for (const sub of subs) jobs.push(sendOne(push, sub.id, sub, body, urgent));
    }
    await Promise.all(jobs);
    if (groups.size > 500) for (const [k, g] of groups) if (now() - g.at > GROUP_MS * 5) groups.delete(k);
  }
  async function sendOne(push: Push, id: string, sub: PushSub, body: string, urgency: 'normal' | 'high'): Promise<boolean> {
    let result: Awaited<ReturnType<Push['send']>>;
    try { result = await push.send(sub, body, urgency); } catch { result = 'fail'; }
    try {
      if (result === 'ok') deps.store.pushSucceeded(id, iso());
      else if (result === 'gone' || result === 'rejected') deps.store.deletePush(id);
      else if (deps.store.pushFailed(id) >= FAIL_LIMIT) deps.store.deletePush(id);
    } catch { /* banco fechado */ }
    if (result === 'gone' || result === 'rejected') update();
    return result === 'ok';
  }
  /** Grava, publica por SSE (só para aparelhos com a preferência ligada) e manda push. */
  async function emit(alert: RemoteAlert, pick: Picker): Promise<void> {
    const targets = devicePrefs().filter(d => pick(d.prefs).length > 0); if (!targets.length) return;
    try { deps.store.addAlert(alert, now()); } catch { /* sem banco: segue */ }
    const ids = new Set(targets.map(d => d.id));
    deps.publish('alert', alert, id => ids.has(id));
    await deliver(alert, targets);
  }
  const mkAlert = (kind: AlertKind, profileId: string, label: string, text: string, at: string): RemoteAlert => ({id: randomUUID(), at, kind, profileId, label, text: clip(text)});

  /** Capturas novas (já deduplicadas pelo leitor): SSE `capture` para todos e alertas conforme as preferências. */
  async function onCaptures(fresh: readonly Capture[]): Promise<void> {
    if (closed) return;
    const mapped = fresh.map(toRemote).filter((c): c is RemoteCapture => c !== null);
    if (!mapped.length) return;
    deps.publish('capture', {captures: mapped});
    const minNota = devicePrefs().reduce<number | null>((m, d) => d.prefs.notaMin === null ? m : m === null ? d.prefs.notaMin : Math.min(m, d.prefs.notaMin), null);
    for (const c of fresh.slice(0, 20)) {
      const p = profileOf(c.profileId); if (!p) continue;
      const kinds = alertsOf(c, {notaMin: minNota});
      if (!kinds.length) continue;
      const primary: AlertKind = PRIORITY.find(k => (kinds as AlertKind[]).includes(k)) ?? kinds[0]!;
      await emit(mkAlert(primary, c.profileId, p.label, alertText(c, kinds), c.at), forCapture(c));
    }
  }

  // --- Conta caiu / voltou ---
  function checkDown() {
    clearT(timer); timer = null;
    const t = now(); let next = Infinity;
    for (const [id, since] of down) {
      if (fell.has(id)) continue;
      if (t - since >= DOWN_AFTER_MS) {
        fell.add(id);
        const p = profileOf(id);
        if (p && deps.running()) void emit(mkAlert('conta_caiu', id, p.label, `${p.label} está fora há mais de 5 min.`, iso()), forAccount('conta_caiu'));
      } else next = Math.min(next, since + DOWN_AFTER_MS - t);
    }
    if (next !== Infinity && !closed) { timer = setT(checkDown, Math.max(1000, next)); (timer as {unref?: () => void})?.unref?.(); }
  }
  /** Chamado a cada relatório de estado da conta (main.report). */
  function reportState(id: string, state: string): void {
    if (closed) return;
    if (state === 'error' || state === 'offline') { if (!down.has(id)) { down.set(id, now()); checkDown(); } return; }
    if (state === 'loading') return; // recarregando: o relógio da queda continua
    const was = fell.has(id); down.delete(id); fell.delete(id);
    if (was && state === 'ready') { const p = profileOf(id); if (p && deps.running()) void emit(mkAlert('conta_voltou', id, p.label, `${p.label} voltou.`, iso()), forAccount('conta_voltou')); }
  }

  /** Liga/desliga o leitor de capturas: só com o acesso remoto escutando e (push assinado ou SSE aberto). */
  function update(): void {
    if (closed) return;
    const need = (() => { try { return deps.running() && (deps.store.pushCount() > 0 || deps.streams() > 0); } catch { return false; } })();
    if (need && !unsubscribe) unsubscribe = deps.captures.subscribe(event => { void onCaptures(event.captures).catch(() => undefined); });
    else if (!need && unsubscribe) { unsubscribe(); unsubscribe = null; }
  }
  /** Teste de push deste aparelho: 3 a cada 10 min. Devolve quantos foram aceitos, ou null se passou do limite. */
  async function sendTest(deviceId: string): Promise<number | null> {
    const push = deps.push(); if (!push) return 0;
    if (!tests.hit(deviceId)) return null;
    const body = buildPayload({kind: 'conta_voltou', label: 'PokéHub', text: 'Teste: as notificações deste aparelho estão funcionando.', at: iso(), url: '#alertas'});
    const results = await Promise.all(deps.store.pushOf(deviceId).map(s => sendOne(push, s.id, s, body, 'normal')));
    return results.filter(Boolean).length;
  }
  /** Assina o push do aparelho; false = endpoint fora da allowlist ou chaves inválidas. */
  function subscribe(deviceId: string, sub: {endpoint: unknown; p256dh: unknown; auth: unknown}): boolean {
    const url = validateEndpoint(sub.endpoint);
    if (!url || !validKeys(sub.p256dh, sub.auth)) return false;
    deps.store.addPush(deviceId, {endpoint: url.href, p256dh: sub.p256dh as string, auth: sub.auth as string}, randomUUID(), iso());
    update(); return true;
  }
  function unsubscribeDevice(deviceId: string, endpoint: unknown): boolean {
    const url = validateEndpoint(endpoint); const ok = deps.store.removePush(deviceId, url ? url.href : String(endpoint).slice(0, 1024));
    update(); return ok;
  }
  return {
    reportState, update, onCaptures, sendTest, subscribe, unsubscribe: unsubscribeDevice,
    listCaptures(deviceId: string, q: {profileId?: string; onlyAlerts?: boolean; limit?: number}): RemoteCapture[] {
      const prefs = prefsOr(deps.store.getPrefs(deviceId));
      return deps.captures.list({...q, notaMin: prefs.notaMin}).map(toRemote).filter((c): c is RemoteCapture => c !== null);
    },
    history: (limit: number): RemoteAlert[] => deps.store.listAlerts(limit),
    getPrefs: (deviceId: string): AlertPrefs => prefsOr(deps.store.getPrefs(deviceId)),
    setPrefs(deviceId: string, prefs: AlertPrefs): AlertPrefs { deps.store.setPrefs(deviceId, prefs); return prefs; },
    publicKey: () => deps.push()?.publicKey ?? null,
    watching: () => unsubscribe !== null,
    close(): void { closed = true; unsubscribe?.(); unsubscribe = null; clearT(timer); timer = null; },
  };
}
export type AlertEngine = ReturnType<typeof createAlertEngine>;
