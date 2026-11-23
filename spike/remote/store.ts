// Persistência do acesso remoto (SQLite): preferências, aparelhos pareados (só o hash do token), auditoria, pino da rede e contadores do PIN.
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/database';
import type { AlertKind, AlertPrefs, RemoteAlert } from '../contracts/remote';

export interface DeviceRow { id: string; name: string; createdAt: string; lastSeen: string | null; canAct: boolean; canControl: boolean }
export interface TokenRow { hash: string; prevHash: string | null; prevUntil: number; rotatedAt: number }
export interface PinStateRow { fails: number; level: number; lockedUntil: number; day: string | null }
export interface AuditRow { id: number; at: string; deviceId: string | null; action: string; detail: string | null }
export interface PushRow { id: string; deviceId: string; endpoint: string; p256dh: string; auth: string; createdAt: string; lastOk: string | null; failCount: number }
export interface ConfirmRow { id: string; deviceId: string; planHash: string; planJson: string; createdAt: number; expiresAt: number; used: boolean; idemKey: string | null; resultJson: string | null }
export interface PurchaseRow { id: number; at: string; deviceId: string | null; deviceName: string | null; profileId: string; confirmId: string | null; planHash: string | null; item: string; qty: number; unitPrice: number; total: number; result: string }
export const MAX_CAP_GOLD = 1_000_000_000;
export const DEFAULT_PORT = 47321, MAX_DEVICES = 8, AUDIT_KEEP = 1000, PUSH_PER_DEVICE = 2, ALERTS_KEEP = 1000, ALERTS_MAX_AGE_MS = 7 * 86_400_000;
export const validPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
const clip = (value: string | null | undefined, max: number) => value == null ? null : value.slice(0, max);

export class RemoteStore {
  private db: DatabaseSync;
  constructor(path: string) { this.db = openDatabase(path); }
  getEnabled(): boolean { return Number(this.db.prepare('SELECT remote_enabled FROM workspace_settings WHERE id=1').get()?.remote_enabled ?? 0) !== 0; }
  setEnabled(value: boolean): void { this.db.prepare('UPDATE workspace_settings SET remote_enabled=? WHERE id=1').run(value ? 1 : 0); }
  getPort(): number { const port = Number(this.db.prepare('SELECT remote_port FROM workspace_settings WHERE id=1').get()?.remote_port ?? DEFAULT_PORT); return validPort(port) ? port : DEFAULT_PORT; }
  setPort(port: unknown): void { if (!validPort(port)) throw new Error('Porta inválida'); this.db.prepare('UPDATE workspace_settings SET remote_port=? WHERE id=1').run(port); }
  getPinHash(): string | null { const value = this.db.prepare('SELECT remote_pin_hash FROM workspace_settings WHERE id=1').get()?.remote_pin_hash; return typeof value === 'string' && value ? value : null; }
  setPinHash(hash: string | null): void { this.db.prepare('UPDATE workspace_settings SET remote_pin_hash=? WHERE id=1').run(hash); }
  getDailyCapGold(): number { return Number(this.db.prepare('SELECT remote_daily_cap_gold FROM workspace_settings WHERE id=1').get()?.remote_daily_cap_gold ?? 200000); }
  /** Pino da rede doméstica (hash do perfil + sub-rede) gravado ao ligar; null = ainda não fixada. */
  getNetPin(): {pin: string; label: string} | null { const row = this.db.prepare('SELECT remote_net_pin, remote_net_label FROM workspace_settings WHERE id=1').get(); return typeof row?.remote_net_pin === 'string' && row.remote_net_pin ? {pin: row.remote_net_pin, label: String(row.remote_net_label ?? '')} : null; }
  setNetPin(pin: string | null, label = ''): void { this.db.prepare('UPDATE workspace_settings SET remote_net_pin=?, remote_net_label=? WHERE id=1').run(pin, pin === null ? null : label.slice(0, 80)); }
  /** Ações pelo celular desligadas (10 erros de PIN no dia) até o usuário religar no PC. */
  getActionsDisabled(): boolean { return Number(this.db.prepare('SELECT remote_actions_disabled FROM workspace_settings WHERE id=1').get()?.remote_actions_disabled ?? 0) !== 0; }
  setActionsDisabled(value: boolean): void { this.db.prepare('UPDATE workspace_settings SET remote_actions_disabled=? WHERE id=1').run(value ? 1 : 0); }
  addDevice(device: {id: string; name: string; tokenHash: string; now: string; nowMs?: number}): void {
    this.db.prepare('INSERT INTO remote_devices (id, name, token_hash, created_at, last_seen, can_act, rotated_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(device.id, device.name.slice(0, 60), device.tokenHash, device.now, device.now, device.nowMs ?? (Date.parse(device.now) || 0));
  }
  setCanAct(id: string, value: boolean): boolean { return this.db.prepare('UPDATE remote_devices SET can_act=? WHERE id=?').run(value ? 1 : 0, id).changes === 1; }
  setCanControl(id: string, value: boolean): boolean { return this.db.prepare('UPDATE remote_devices SET can_control=? WHERE id=?').run(value ? 1 : 0, id).changes === 1; }
  /** Hash guardado do token do aparelho (para comparação em tempo constante); null se não existe. */
  tokenHashOf(id: string): string | null { return this.tokenRow(id)?.hash ?? null; }
  tokenRow(id: string): TokenRow | null {
    const row = this.db.prepare('SELECT token_hash, prev_token_hash, prev_valid_until, rotated_at FROM remote_devices WHERE id=?').get(id);
    return row ? {hash: String(row.token_hash), prevHash: typeof row.prev_token_hash === 'string' ? row.prev_token_hash : null, prevUntil: Number(row.prev_valid_until), rotatedAt: Number(row.rotated_at)} : null;
  }
  /** Rotação do token: o hash atual vira o anterior (vale até `prevUntil`) e entra o novo. */
  rotateToken(id: string, hash: string, prevHash: string, prevUntil: number, nowMs: number): void { this.db.prepare('UPDATE remote_devices SET token_hash=?, prev_token_hash=?, prev_valid_until=?, rotated_at=? WHERE id=?').run(hash, prevHash, prevUntil, nowMs, id); }
  getDevice(id: string): DeviceRow | null { const row = this.db.prepare('SELECT id, name, created_at, last_seen, can_act, can_control FROM remote_devices WHERE id=?').get(id); return row ? this.toDevice(row) : null; }
  listDevices(): DeviceRow[] { return this.db.prepare('SELECT id, name, created_at, last_seen, can_act, can_control FROM remote_devices ORDER BY created_at').all().map(row => this.toDevice(row)); }
  countDevices(): number { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM remote_devices').get()?.n ?? 0); }
  touch(id: string, now: string): void { this.db.prepare('UPDATE remote_devices SET last_seen=? WHERE id=?').run(now, id); }
  /** Apaga o aparelho e, junto, o que está ligado a ele (assinaturas de push e preferências de alerta; a FK em cascata também faz isso, aqui é explícito). */
  revokeDevice(id: string): boolean { this.db.prepare('DELETE FROM remote_pin_state WHERE key=?').run(id); this.db.prepare('DELETE FROM remote_confirms WHERE device_id=?').run(id); this.db.prepare('DELETE FROM remote_push WHERE device_id=?').run(id); this.db.prepare('DELETE FROM remote_alert_prefs WHERE device_id=?').run(id); return this.db.prepare('DELETE FROM remote_devices WHERE id=?').run(id).changes === 1; }
  pinState(key: string): PinStateRow | null { const r = this.db.prepare('SELECT fails, level, locked_until, day FROM remote_pin_state WHERE key=?').get(key); return r ? {fails: Number(r.fails), level: Number(r.level), lockedUntil: Number(r.locked_until), day: r.day == null ? null : String(r.day)} : null; }
  setPinState(key: string, s: PinStateRow): void { this.db.prepare('INSERT INTO remote_pin_state (key, fails, level, locked_until, day) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, level=excluded.level, locked_until=excluded.locked_until, day=excluded.day').run(key, s.fails, s.level, s.lockedUntil, s.day); }
  clearPinState(key?: string): void { if (key) this.db.prepare('DELETE FROM remote_pin_state WHERE key=?').run(key); else this.db.exec('DELETE FROM remote_pin_state'); }
  audit(deviceId: string | null, action: string, detail: string | null, now: string): void {
    this.db.prepare('INSERT INTO remote_audit (at, device_id, action, detail) VALUES (?, ?, ?, ?)').run(now, clip(deviceId, 64), action.slice(0, 40), clip(detail, 200));
    this.db.prepare('DELETE FROM remote_audit WHERE id <= (SELECT MAX(id) FROM remote_audit) - ?').run(AUDIT_KEEP);
  }
  listAudit(limit = 100): AuditRow[] {
    return this.db.prepare('SELECT id, at, device_id, action, detail FROM remote_audit ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(1, limit | 0), 100)).map(row => ({id: Number(row.id), at: String(row.at), deviceId: row.device_id == null ? null : String(row.device_id), action: String(row.action), detail: row.detail == null ? null : String(row.detail)}));
  }
  // --- R3: push, preferências e alertas ---
  private toPush(row: Record<string, unknown>): PushRow { return {id: String(row.id), deviceId: String(row.device_id), endpoint: String(row.endpoint), p256dh: String(row.p256dh), auth: String(row.auth), createdAt: String(row.created_at), lastOk: row.last_ok == null ? null : String(row.last_ok), failCount: Number(row.fail_count)}; }
  pushOf(deviceId: string): PushRow[] { return this.db.prepare('SELECT * FROM remote_push WHERE device_id=? ORDER BY rowid').all(deviceId).map(r => this.toPush(r)); }
  pushAll(): PushRow[] { return this.db.prepare('SELECT * FROM remote_push ORDER BY rowid').all().map(r => this.toPush(r)); }
  pushCount(deviceId?: string): number { return Number((deviceId === undefined ? this.db.prepare('SELECT COUNT(*) AS n FROM remote_push').get() : this.db.prepare('SELECT COUNT(*) AS n FROM remote_push WHERE device_id=?').get(deviceId))?.n ?? 0); }
  /** Registra a assinatura do aparelho (no máx. 2: a mais antiga sai). O mesmo endpoint de outro aparelho passa para este (é o mesmo navegador). */
  addPush(deviceId: string, sub: {endpoint: string; p256dh: string; auth: string}, id: string, now: string): void {
    this.db.prepare('DELETE FROM remote_push WHERE endpoint=?').run(sub.endpoint);
    const mine = this.pushOf(deviceId);
    for (const old of mine.slice(0, Math.max(0, mine.length - PUSH_PER_DEVICE + 1))) this.db.prepare('DELETE FROM remote_push WHERE id=?').run(old.id);
    this.db.prepare('INSERT INTO remote_push (id, device_id, endpoint, p256dh, auth, created_at, last_ok, fail_count) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)').run(id, deviceId, sub.endpoint, sub.p256dh, sub.auth, now);
  }
  removePush(deviceId: string, endpoint: string): boolean { return this.db.prepare('DELETE FROM remote_push WHERE device_id=? AND endpoint=?').run(deviceId, endpoint).changes > 0; }
  deletePush(id: string): void { this.db.prepare('DELETE FROM remote_push WHERE id=?').run(id); }
  clearPush(): void { this.db.exec('DELETE FROM remote_push'); }
  pushSucceeded(id: string, now: string): void { this.db.prepare('UPDATE remote_push SET last_ok=?, fail_count=0 WHERE id=?').run(now, id); }
  /** Conta uma falha; devolve o total (o chamador apaga a assinatura ao chegar em 5). */
  pushFailed(id: string): number { this.db.prepare('UPDATE remote_push SET fail_count=fail_count+1 WHERE id=?').run(id); return Number(this.db.prepare('SELECT fail_count FROM remote_push WHERE id=?').get(id)?.fail_count ?? 0); }
  getPrefs(deviceId: string): AlertPrefs | null { const row = this.db.prepare('SELECT json FROM remote_alert_prefs WHERE device_id=?').get(deviceId); if (!row) return null; try { return JSON.parse(String(row.json)) as AlertPrefs; } catch { return null; } }
  setPrefs(deviceId: string, prefs: AlertPrefs): void { this.db.prepare('INSERT INTO remote_alert_prefs (device_id, json) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET json=excluded.json').run(deviceId, JSON.stringify(prefs)); }
  addAlert(alert: RemoteAlert, nowMs: number = Date.now()): void {
    this.db.prepare('INSERT OR IGNORE INTO remote_alerts (id, at, kind, profile_id, label, text) VALUES (?, ?, ?, ?, ?, ?)').run(alert.id, alert.at, alert.kind, alert.profileId, alert.label, alert.text);
    this.db.prepare('DELETE FROM remote_alerts WHERE at < ?').run(new Date(nowMs - ALERTS_MAX_AGE_MS).toISOString());
    this.db.prepare('DELETE FROM remote_alerts WHERE id NOT IN (SELECT id FROM remote_alerts ORDER BY at DESC, rowid DESC LIMIT ?)').run(ALERTS_KEEP);
  }
  listAlerts(limit = 50): RemoteAlert[] {
    return this.db.prepare('SELECT id, at, kind, profile_id, label, text FROM remote_alerts ORDER BY at DESC, rowid DESC LIMIT ?').all(Math.min(Math.max(1, limit | 0), 200)).map(r => ({id: String(r.id), at: String(r.at), kind: String(r.kind) as AlertKind, profileId: String(r.profile_id), label: String(r.label), text: String(r.text)}));
  }
  // --- R4: teto diário, confirmações de compra e histórico de compras do celular ---
  setDailyCapGold(value: number): void { if (!Number.isInteger(value) || value < 0 || value > MAX_CAP_GOLD) throw new Error('Teto inválido'); this.db.prepare('UPDATE workspace_settings SET remote_daily_cap_gold=? WHERE id=1').run(value); }
  spentToday(day: string, profileId: string): number { return Number(this.db.prepare('SELECT gold FROM remote_spend WHERE day=? AND profile_id=?').get(day, profileId)?.gold ?? 0); }
  spendOfDay(day: string): {profileId: string; gold: number}[] { return this.db.prepare('SELECT profile_id, gold FROM remote_spend WHERE day=? ORDER BY profile_id').all(day).map(r => ({profileId: String(r.profile_id), gold: Number(r.gold)})); }
  /** Reserva ATÔMICA do teto: confere e soma na mesma transação (BEGIN IMMEDIATE). false = estouraria o teto do dia desta conta. */
  reserveSpend(day: string, profileId: string, amount: number, cap: number, tz: string): boolean {
    if (!Number.isInteger(amount) || amount < 0) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = Number(this.db.prepare('SELECT gold FROM remote_spend WHERE day=? AND profile_id=?').get(day, profileId)?.gold ?? 0);
      if (current + amount > cap) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare('INSERT INTO remote_spend (day, profile_id, gold, tz) VALUES (?, ?, ?, ?) ON CONFLICT(day, profile_id) DO UPDATE SET gold=gold+excluded.gold, tz=excluded.tz').run(day, profileId, amount, tz.slice(0, 64));
      this.db.exec('COMMIT'); return true;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* já desfeito */ } throw error; }
  }
  /** Devolve parte da reserva (compra que falhou ou custou menos); nunca fica negativo. */
  releaseSpend(day: string, profileId: string, amount: number): void { if (amount > 0) this.db.prepare('UPDATE remote_spend SET gold=MAX(0, gold-?) WHERE day=? AND profile_id=?').run(Math.floor(amount), day, profileId); }
  /** Uma confirmação ativa por aparelho: o plano novo invalida os anteriores ainda não usados. */
  addConfirm(c: ConfirmRow): void {
    this.db.prepare('UPDATE remote_confirms SET used=1 WHERE device_id=? AND used=0').run(c.deviceId);
    this.db.prepare('DELETE FROM remote_confirms WHERE created_at < ?').run(c.createdAt - 86_400_000);
    this.db.prepare('INSERT INTO remote_confirms (id, device_id, plan_hash, plan_json, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, 0)').run(c.id, c.deviceId, c.planHash, c.planJson, c.createdAt, c.expiresAt);
  }
  getConfirm(id: string): ConfirmRow | null {
    const r = this.db.prepare('SELECT id, device_id, plan_hash, plan_json, created_at, expires_at, used, idem_key, result_json FROM remote_confirms WHERE id=?').get(id);
    return r ? {id: String(r.id), deviceId: String(r.device_id), planHash: String(r.plan_hash), planJson: String(r.plan_json), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), used: Number(r.used) !== 0, idemKey: r.idem_key == null ? null : String(r.idem_key), resultJson: r.result_json == null ? null : String(r.result_json)} : null;
  }
  /** Marca como usada de forma atômica (UPDATE condicional): só UM chamador recebe true. */
  markConfirmUsed(id: string, idemKey: string | null): boolean { return this.db.prepare('UPDATE remote_confirms SET used=1, idem_key=? WHERE id=? AND used=0').run(idemKey, id).changes === 1; }
  setConfirmResult(id: string, json: string): void { this.db.prepare('UPDATE remote_confirms SET result_json=? WHERE id=?').run(json.slice(0, 20_000), id); }
  findIdem(deviceId: string, key: string): ConfirmRow | null { const r = this.db.prepare('SELECT id FROM remote_confirms WHERE device_id=? AND idem_key=?').get(deviceId, key); return r ? this.getConfirm(String(r.id)) : null; }
  addPurchase(p: Omit<PurchaseRow, 'id'>): void {
    this.db.prepare('INSERT INTO remote_purchases (at, device_id, device_name, profile_id, confirm_id, plan_hash, item, qty, unit_price, total, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(p.at, clip(p.deviceId, 64), clip(p.deviceName, 60), p.profileId, p.confirmId, p.planHash, p.item.slice(0, 60), p.qty, p.unitPrice, p.total, p.result.slice(0, 120));
  }
  /** Histórico de compras (tabela sem poda); o painel mostra as últimas 50. */
  listPurchases(limit = 50): PurchaseRow[] {
    return this.db.prepare('SELECT id, at, device_id, device_name, profile_id, confirm_id, plan_hash, item, qty, unit_price, total, result FROM remote_purchases ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(1, limit | 0), 50)).map(r => ({id: Number(r.id), at: String(r.at), deviceId: r.device_id == null ? null : String(r.device_id), deviceName: r.device_name == null ? null : String(r.device_name), profileId: String(r.profile_id), confirmId: r.confirm_id == null ? null : String(r.confirm_id), planHash: r.plan_hash == null ? null : String(r.plan_hash), item: String(r.item), qty: Number(r.qty), unitPrice: Number(r.unit_price), total: Number(r.total), result: String(r.result)}));
  }
  countPurchases(): number { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM remote_purchases').get()?.n ?? 0); }
  close(): void { this.db.close(); }
  private toDevice(row: Record<string, unknown>): DeviceRow { return {id: String(row.id), name: String(row.name), createdAt: String(row.created_at), lastSeen: row.last_seen == null ? null : String(row.last_seen), canAct: Number(row.can_act) !== 0, canControl: Number(row.can_control) !== 0}; }
}
