// Persistência do acesso remoto (SQLite): preferências, aparelhos pareados (só o hash do token) e auditoria.
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/database';

export interface DeviceRow { id: string; name: string; createdAt: string; lastSeen: string | null; canAct: boolean }
export interface AuditRow { id: number; at: string; deviceId: string | null; action: string; detail: string | null }
export const DEFAULT_PORT = 47321, MAX_DEVICES = 8, AUDIT_KEEP = 1000;
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
  addDevice(device: {id: string; name: string; tokenHash: string; now: string}): void {
    this.db.prepare('INSERT INTO remote_devices (id, name, token_hash, created_at, last_seen, can_act) VALUES (?, ?, ?, ?, ?, 0)').run(device.id, device.name.slice(0, 60), device.tokenHash, device.now, device.now);
  }
  /** Hash guardado do token do aparelho (para comparação em tempo constante); null se não existe. */
  tokenHashOf(id: string): string | null { const value = this.db.prepare('SELECT token_hash FROM remote_devices WHERE id=?').get(id)?.token_hash; return typeof value === 'string' ? value : null; }
  getDevice(id: string): DeviceRow | null { const row = this.db.prepare('SELECT id, name, created_at, last_seen, can_act FROM remote_devices WHERE id=?').get(id); return row ? this.toDevice(row) : null; }
  listDevices(): DeviceRow[] { return this.db.prepare('SELECT id, name, created_at, last_seen, can_act FROM remote_devices ORDER BY created_at').all().map(row => this.toDevice(row)); }
  countDevices(): number { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM remote_devices').get()?.n ?? 0); }
  touch(id: string, now: string): void { this.db.prepare('UPDATE remote_devices SET last_seen=? WHERE id=?').run(now, id); }
  revokeDevice(id: string): boolean { return this.db.prepare('DELETE FROM remote_devices WHERE id=?').run(id).changes === 1; }
  audit(deviceId: string | null, action: string, detail: string | null, now: string): void {
    this.db.prepare('INSERT INTO remote_audit (at, device_id, action, detail) VALUES (?, ?, ?, ?)').run(now, clip(deviceId, 64), action.slice(0, 40), clip(detail, 200));
    this.db.prepare('DELETE FROM remote_audit WHERE id <= (SELECT MAX(id) FROM remote_audit) - ?').run(AUDIT_KEEP);
  }
  listAudit(limit = 100): AuditRow[] {
    return this.db.prepare('SELECT id, at, device_id, action, detail FROM remote_audit ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(1, limit | 0), 100)).map(row => ({id: Number(row.id), at: String(row.at), deviceId: row.device_id == null ? null : String(row.device_id), action: String(row.action), detail: row.detail == null ? null : String(row.detail)}));
  }
  close(): void { this.db.close(); }
  private toDevice(row: Record<string, unknown>): DeviceRow { return {id: String(row.id), name: String(row.name), createdAt: String(row.created_at), lastSeen: row.last_seen == null ? null : String(row.last_seen), canAct: Number(row.can_act) !== 0}; }
}
