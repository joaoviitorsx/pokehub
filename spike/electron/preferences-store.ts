import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database';
import type { StartupMode } from '../contracts/preferences';

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
  getHuntExtensionPath(): string | null {
    const value = this.db.prepare('SELECT hunt_extension_path FROM workspace_settings WHERE id=1').get()?.hunt_extension_path;
    return typeof value === 'string' && value !== '' ? value : null;
  }
  setHuntExtensionPath(value: string | null): void {
    if (value !== null && (typeof value !== 'string' || value === '' || value.length > 4096)) throw new Error('Preferência inválida');
    if (this.db.prepare('UPDATE workspace_settings SET hunt_extension_path=? WHERE id=1').run(value).changes !== 1) throw new Error('Preferência ausente');
  }
  close(): void { this.db.close(); }
}
