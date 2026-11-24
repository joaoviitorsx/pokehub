import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database';
import { isProfileId } from '../domain/profiles';
import { PLATFORMS } from '../domain/streams';
import type { StreamPlatform } from '../contracts/twitch';

/** Vínculo Twitch de um perfil: a linha existe desde "Vincular" até "Desvincular" (ou até o perfil ser apagado, em cascata). */
export interface TwitchLink { profileId: string; enabled: boolean; autoClaim: boolean; sound: boolean }
export type TwitchLinkPatch = Partial<Omit<TwitchLink,'profileId'>>;
const FIELDS = [['enabled','enabled'],['autoClaim','auto_claim'],['sound','sound']] as const;

/** Vínculos e canal de uma plataforma (Twitch: `twitch_links`/`twitch_channel`; Kick: `kick_links`/`kick_channel`). Nomes fixos, nunca do usuário. */
export class TwitchStore {
  private db: DatabaseSync;
  private table: 'twitch_links' | 'kick_links';
  private column: 'twitch_channel' | 'kick_channel';
  private normalizeChannel: (value: unknown) => string | null;
  constructor(path: string, platform: StreamPlatform = 'twitch') {
    this.db = openDatabase(path);
    this.table = platform === 'kick' ? 'kick_links' : 'twitch_links';
    this.column = platform === 'kick' ? 'kick_channel' : 'twitch_channel';
    this.normalizeChannel = PLATFORMS[platform].normalizeChannel;
  }
  channel(): string {
    const value = this.db.prepare(`SELECT ${this.column} AS channel FROM workspace_settings WHERE id=1`).get()?.channel;
    return typeof value === 'string' ? this.normalizeChannel(value) ?? '' : '';
  }
  /** Aceita o nome ou a URL do canal; '' desliga. Lança para nome inválido. */
  setChannel(value: unknown): string {
    const channel = this.normalizeChannel(value);
    if (channel === null) throw new Error('Canal inválido');
    if (this.db.prepare(`UPDATE workspace_settings SET ${this.column}=? WHERE id=1`).run(channel).changes !== 1) throw new Error('Preferência ausente');
    return channel;
  }
  list(): TwitchLink[] {
    return this.db.prepare(`SELECT profile_id, enabled, auto_claim, sound FROM ${this.table} ORDER BY rowid`).all().map(row => ({profileId:String(row.profile_id), enabled:row.enabled !== 0, autoClaim:row.auto_claim === 1, sound:row.sound === 1}));
  }
  get(profileId: string): TwitchLink | null { return this.list().find(link => link.profileId === profileId) ?? null; }
  /** Cria o vínculo (ligado, sem coleta automática, mudo) se ainda não existe. O perfil precisa existir (chave estrangeira). */
  link(profileId: unknown): TwitchLink {
    if (!isProfileId(profileId)) throw new Error('Perfil inválido');
    this.db.prepare(`INSERT OR IGNORE INTO ${this.table} (profile_id, enabled, auto_claim, sound, updated_at) VALUES (?, 1, 0, 0, ?)`).run(profileId,new Date().toISOString());
    const link = this.get(profileId);
    if (!link) throw new Error('Perfil inválido');
    return link;
  }
  /** Só os campos booleanos presentes; valida tudo antes de gravar. */
  update(profileId: unknown, patch: unknown): TwitchLink {
    if (!isProfileId(profileId) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error('Vínculo inválido');
    const input = patch as Record<string, unknown>;
    if (FIELDS.some(([key]) => input[key] !== undefined && typeof input[key] !== 'boolean')) throw new Error('Vínculo inválido');
    for (const [key,column] of FIELDS) {
      if (input[key] === undefined) continue;
      if (this.db.prepare(`UPDATE ${this.table} SET ${column}=?, updated_at=? WHERE profile_id=?`).run(input[key] ? 1 : 0,new Date().toISOString(),profileId).changes !== 1) throw new Error('Vínculo inválido');
    }
    const link = this.get(profileId);
    if (!link) throw new Error('Vínculo inválido');
    return link;
  }
  unlink(profileId: unknown): void {
    if (!isProfileId(profileId)) throw new Error('Perfil inválido');
    this.db.prepare(`DELETE FROM ${this.table} WHERE profile_id=?`).run(profileId);
  }
  close(): void { this.db.close(); }
}
