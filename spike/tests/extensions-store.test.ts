import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesStore } from '../electron/preferences-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const HUNT = 'mhnplloljgchpfpcpbhmcokmnefodjnh';
// Banco v6 real: perfis, workspace_settings com hunt_extension_path e as tabelas do Grindolino já indexadas.
const V6 = "CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); CREATE TABLE workspace_settings (id INTEGER PRIMARY KEY CHECK (id = 1), startup_mode TEXT NOT NULL CHECK (startup_mode IN ('grid', 'focus-first')), hunt_extension_path TEXT); CREATE TABLE grindolino_measurements (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, minutes INTEGER NOT NULL, recorded_at TEXT NOT NULL); CREATE INDEX grindolino_measurements_account_time ON grindolino_measurements (account_id, recorded_at);";
function withDatabase(setup: string, test: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(),'pokehub-v7-'));
  try { const path = join(dir,'app.sqlite'); const db = new DatabaseSync(path); db.exec(setup); db.close(); test(path); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}

describe('banco v7/v8: extensões, atualização e hosts aprovados', () => {
  it('migra a v6 copiando a pasta /hunt salva como extensão habilitada e mantém a coluna antiga', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'focus-first', '/home/u/ext/1.0.17_0'); PRAGMA user_version=6;`, path => {
      const store = new PreferencesStore(path);
      expect(store.listExtensions()).toEqual([{id:HUNT,path:'/home/u/ext/1.0.17_0',enabled:true,approvedHosts:[]}]);
      expect(store.getStartupMode()).toBe('focus-first'); expect(store.getAutoUpdateCheck()).toBe(true);
      store.close();
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9});
      expect(check.prepare('SELECT hunt_extension_path FROM workspace_settings').get()).toMatchObject({hunt_extension_path:'/home/u/ext/1.0.17_0'});
      expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
      check.close();
    });
  });
  it('migra a v6 sem pasta salva (NULL ou vazia) com a lista vazia', () => {
    for (const saved of ['NULL',"''"]) withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', ${saved}); PRAGMA user_version=6;`, path => {
      const store = new PreferencesStore(path);
      expect(store.listExtensions()).toEqual([]); store.close();
    });
  });
  it('migra de versões antigas direto até a 8, uma vez só, e reabrir não repete a cópia', () => {
    withDatabase(`${V6.replace(', hunt_extension_path TEXT','')} PRAGMA user_version=3;`.replace('CREATE INDEX grindolino_measurements_account_time ON grindolino_measurements (account_id, recorded_at);',"INSERT INTO workspace_settings VALUES (1, 'grid');"), path => {
      new PreferencesStore(path).close();
      const again = new PreferencesStore(path);
      expect(again.listExtensions()).toEqual([]); again.close();
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9}); check.close();
    });
  });
  it('migra a v7 só acrescentando approved_hosts, sem perder as extensões', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', NULL); ALTER TABLE workspace_settings ADD COLUMN auto_update_check INTEGER NOT NULL DEFAULT 1; CREATE TABLE extensions (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, added_at TEXT NOT NULL); INSERT INTO extensions VALUES ('a','/ext/a',1,'2026'); PRAGMA user_version=7;`, path => {
      const store = new PreferencesStore(path);
      expect(store.listExtensions()).toEqual([{id:'a',path:'/ext/a',enabled:true,approvedHosts:[]}]); store.close();
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9}); check.close();
    });
  });
  it('uma v8 já migrada abre sem repetir a migração', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', NULL); PRAGMA user_version=6;`, path => {
      const first = new PreferencesStore(path); first.addExtension({id:'a',path:'/ext/a',enabled:true}); first.setApprovedHosts('a',['x.example.com']); first.close();
      const again = new PreferencesStore(path);
      expect(again.listExtensions()).toEqual([{id:'a',path:'/ext/a',enabled:true,approvedHosts:['x.example.com']}]); again.close();
    });
  });
  it('guarda, ordena e valida os hosts aprovados; JSON estragado vira lista vazia', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', NULL); PRAGMA user_version=6;`, path => {
      const store = new PreferencesStore(path);
      store.addExtension({id:'a',path:'/ext/a',enabled:true});
      store.setApprovedHosts('a',['b.example.com','a.example.com','b.example.com']);
      expect(store.listExtensions()[0]?.approvedHosts).toEqual(['a.example.com','b.example.com']);
      expect(() => store.setApprovedHosts('nada',[])).toThrow(); expect(() => store.setApprovedHosts('a','x')).toThrow(); expect(() => store.setApprovedHosts('a',[1])).toThrow(); expect(() => store.setApprovedHosts('a',[''])).toThrow();
      store.close();
      const raw = new DatabaseSync(path); raw.exec("UPDATE extensions SET approved_hosts='{nao-json'"); raw.close();
      const broken = new PreferencesStore(path); expect(broken.listExtensions()[0]?.approvedHosts).toEqual([]); broken.close();
    });
  });
  it('mantém a v6 e os dados se a migração falhar (rollback)', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', '/p'); CREATE TABLE extensions (x TEXT); PRAGMA user_version=6;`, path => {
      expect(() => new PreferencesStore(path)).toThrow();
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:6});
      expect(check.prepare('SELECT hunt_extension_path FROM workspace_settings').get()).toMatchObject({hunt_extension_path:'/p'});
      expect(() => check.prepare('SELECT auto_update_check FROM workspace_settings').get()).toThrow(); // a coluna nova também foi desfeita
      expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
      check.close();
    });
  });
  it('lista, adiciona, habilita e remove com validação e caminho único', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', NULL); PRAGMA user_version=6;`, path => {
      const store = new PreferencesStore(path);
      store.addExtension({id:'a',path:'/ext/a',enabled:true}); store.addExtension({id:'b',path:'/ext/b',enabled:false});
      expect(() => store.addExtension({id:'c',path:'/ext/a',enabled:true})).toThrow();
      expect(() => store.addExtension({id:'a',path:'/ext/z',enabled:true})).toThrow();
      expect(() => store.addExtension({id:'',path:'/ext/z',enabled:true})).toThrow();
      expect(() => store.addExtension({id:'d',path:'x'.repeat(4097),enabled:true})).toThrow();
      store.setExtensionEnabled('b',true); store.setExtensionPath('a','/ext/a2');
      expect(store.listExtensions()).toEqual([{id:'a',path:'/ext/a2',enabled:true,approvedHosts:[]},{id:'b',path:'/ext/b',enabled:true,approvedHosts:[]}]);
      expect(() => store.setExtensionEnabled('b','sim')).toThrow(); expect(() => store.setExtensionEnabled('nada',true)).toThrow();
      expect(() => store.setExtensionPath('a','/ext/b')).toThrow();
      store.removeExtension('a'); expect(() => store.removeExtension('a')).toThrow(); expect(() => store.removeExtension(1)).toThrow();
      expect(store.listExtensions().map(row => row.id)).toEqual(['b']);
      store.close();
    });
  });
  it('guarda a preferência de verificação automática (padrão ligada)', () => {
    withDatabase(`${V6} INSERT INTO workspace_settings VALUES (1, 'grid', NULL); PRAGMA user_version=6;`, path => {
      const store = new PreferencesStore(path);
      expect(store.getAutoUpdateCheck()).toBe(true); expect(store.setAutoUpdateCheck(false)).toBe(false); expect(() => store.setAutoUpdateCheck('nao')).toThrow();
      store.close();
      const reopened = new PreferencesStore(path); expect(reopened.getAutoUpdateCheck()).toBe(false); reopened.close();
    });
  });
});
