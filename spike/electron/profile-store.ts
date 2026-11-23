import type { DatabaseSync as Database } from 'node:sqlite';
import { openDatabase } from './database';
import { randomUUID } from 'node:crypto';
import { createProfile, updateProfile, ProfileLimitError, MAX_PROFILES, type Profile, type ProfileInput } from '../domain/profiles';

export class ProfileStore {
  private db: Database;
  constructor(path: string) {
    this.db = openDatabase(path);
  }
  list(): Profile[] {
    const profiles = this.db.prepare('SELECT * FROM profiles ORDER BY createdAt, rowid').all() as unknown as Profile[];
    if (profiles.length > MAX_PROFILES) throw new ProfileLimitError('Número de perfis inválido');
    return profiles;
  }
  create(input: ProfileInput): Profile {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const profile = createProfile(this.list(),input,randomUUID(),new Date().toISOString());
      this.db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run(profile.id,profile.label,profile.emailLabel,profile.characterName,profile.colorToken,profile.createdAt,profile.updatedAt);
      this.db.exec('COMMIT'); return profile;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  update(id: string, input: ProfileInput): Profile {
    const existing = this.list().find(profile => profile.id === id);
    if (!existing) throw new Error('Perfil não encontrado');
    const profile = updateProfile(existing,input,new Date().toISOString());
    this.db.prepare('UPDATE profiles SET label=?, emailLabel=?, characterName=?, colorToken=?, updatedAt=? WHERE id=?').run(profile.label,profile.emailLabel,profile.characterName,profile.colorToken,profile.updatedAt,id);
    return profile;
  }
  remove(id: string): void {
    if (this.db.prepare('DELETE FROM profiles WHERE id=?').run(id).changes !== 1) throw new Error('Perfil não encontrado');
  }
  close(): void { this.db.close(); }
}
