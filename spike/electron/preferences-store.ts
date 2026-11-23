import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database';
import type { StartupMode } from '../contracts/preferences';

export interface ExtensionRow { id: string; path: string; enabled: boolean; approvedHosts: string[] }
const parseHosts = (value: unknown): string[] => {
  try { const list: unknown = JSON.parse(String(value ?? '[]')); return Array.isArray(list) ? [...new Set(list.filter((host): host is string => typeof host === 'string' && host !== '' && host.length <= 253))].sort() : []; } catch { return []; }
};

export class PreferencesStore {
  private db: DatabaseSync;
  constructor(path: string) { this.db = openDatabase(path); }
  getStartupMode(): StartupMode {
    const value = this.db.prepare('SELECT startup_mode FROM workspace_settings WHERE id=1').get()?.startup_mode;
    if (value !== 'grid' && value !== 'focus-first') throw new Error('Preferência inválida');
    return value;
  }
  setStartupMode(value: unknown): StartupMode {
    if (value !== 'grid' && value !== 'focus-first') throw new Error('Preferência inválida');
    if (this.db.prepare('UPDATE workspace_settings SET startup_mode=? WHERE id=1').run(value).changes !== 1) throw new Error('Preferência ausente');
    return value;
  }
  getAutoUpdateCheck(): boolean { return this.db.prepare('SELECT auto_update_check FROM workspace_settings WHERE id=1').get()?.auto_update_check !== 0; }
  setAutoUpdateCheck(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Preferência inválida');
    if (this.db.prepare('UPDATE workspace_settings SET auto_update_check=? WHERE id=1').run(value ? 1 : 0).changes !== 1) throw new Error('Preferência ausente');
    return value;
  }
  listExtensions(): ExtensionRow[] {
    return this.db.prepare('SELECT id, path, enabled, approved_hosts FROM extensions ORDER BY rowid').all().map(row => ({id:String(row.id), path:String(row.path), enabled:row.enabled === 1, approvedHosts:parseHosts(row.approved_hosts)}));
  }
  addExtension(row: Omit<ExtensionRow,'approvedHosts'>): void {
    if (typeof row.id !== 'string' || row.id === '' || row.id.length > 64 || typeof row.path !== 'string' || row.path === '' || row.path.length > 4096) throw new Error('Extensão inválida');
    if (this.db.prepare('INSERT INTO extensions (id, path, enabled, added_at) VALUES (?, ?, ?, ?)').run(row.id,row.path,row.enabled ? 1 : 0,new Date().toISOString()).changes !== 1) throw new Error('Extensão inválida');
  }
  setExtensionPath(id: string, path: string): void {
    if (typeof path !== 'string' || path === '' || path.length > 4096 || this.db.prepare('UPDATE extensions SET path=? WHERE id=?').run(path,id).changes !== 1) throw new Error('Extensão inválida');
  }
  setApprovedHosts(id: unknown, hosts: unknown): void {
    if (typeof id !== 'string' || !Array.isArray(hosts) || hosts.length > 64 || hosts.some(host => typeof host !== 'string' || host === '' || host.length > 253)) throw new Error('Extensão inválida');
    if (this.db.prepare('UPDATE extensions SET approved_hosts=? WHERE id=?').run(JSON.stringify([...new Set(hosts as string[])].sort()),id).changes !== 1) throw new Error('Extensão inválida');
  }
  setExtensionEnabled(id: string, enabled: unknown): void {
    if (typeof id !== 'string' || typeof enabled !== 'boolean' || this.db.prepare('UPDATE extensions SET enabled=? WHERE id=?').run(enabled ? 1 : 0,id).changes !== 1) throw new Error('Extensão inválida');
  }
  removeExtension(id: unknown): void {
    if (typeof id !== 'string' || this.db.prepare('DELETE FROM extensions WHERE id=?').run(id).changes !== 1) throw new Error('Extensão inválida');
  }
  close(): void { this.db.close(); }
}
