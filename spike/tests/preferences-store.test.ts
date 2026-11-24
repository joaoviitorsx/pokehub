import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesStore } from '../electron/preferences-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

describe('preferências do workspace', () => {
 it('usa grade por padrão, valida e preserva a preferência após reabrir', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-prefs-'));
  try {
   const path=join(dir,'app.sqlite'); const first=new PreferencesStore(path);
   expect(first.getStartupMode()).toBe('grid'); first.setStartupMode('focus-first'); first.close();
   const second=new PreferencesStore(path); expect(second.getStartupMode()).toBe('focus-first');
   expect(() => second.setStartupMode('invalid')).toThrow(); expect(second.getStartupMode()).toBe('focus-first'); second.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('migra um banco da versão 1 sem alterar os perfis', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-migration-'));
  try {
   const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path);
   db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); PRAGMA user_version=1;"); db.close();
   const prefs=new PreferencesStore(path); expect(prefs.getStartupMode()).toBe('grid'); prefs.close();
   const check=new DatabaseSync(path); expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'}); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 18}); check.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});

it('mantém a versão e os perfis se a migração aditiva falhar', () => {
 const dir=mkdtempSync(join(tmpdir(),'pokehub-migration-fail-'));
 try {
  const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path);
  db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); CREATE TABLE workspace_settings (other TEXT); PRAGMA user_version=1;"); db.close();
  expect(() => new PreferencesStore(path)).toThrow();
  const check=new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:1});
  expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
  check.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

const V3 = "CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); CREATE TABLE workspace_settings (id INTEGER PRIMARY KEY CHECK (id = 1), startup_mode TEXT NOT NULL CHECK (startup_mode IN ('grid', 'focus-first'))); INSERT INTO workspace_settings VALUES (1, 'focus-first'); CREATE TABLE grindolino_measurements (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, minutes INTEGER NOT NULL, recorded_at TEXT NOT NULL);"; // um banco v3 real já tem as tabelas do Grindolino, que a v5 altera e a v6 indexa
describe('extensão /hunt (versão 4)', () => {
 it('migra a versão 3 preservando dados, sem extensões', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-v4-'));
  try {
   const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path); db.exec(`${V3} PRAGMA user_version=3;`); db.close();
   const first=new PreferencesStore(path);
   expect(first.getStartupMode()).toBe('focus-first'); expect(first.listExtensions()).toEqual([]); first.close();
   const check=new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 18}); expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'}); check.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('mantém a versão 3 e os dados se a migração falhar', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-v4-fail-'));
  try {
   const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path); db.exec(`${V3} ALTER TABLE workspace_settings ADD COLUMN hunt_extension_path TEXT; PRAGMA user_version=3;`); db.close();
   expect(() => new PreferencesStore(path)).toThrow();
   const check=new DatabaseSync(path);
   expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:3});
   expect(check.prepare('SELECT startup_mode FROM workspace_settings').get()).toMatchObject({startup_mode:'focus-first'});
   expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
   check.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});

describe('Modo leve (migração v9)', () => {
 it('começa desligado, valida e persiste as duas opções de forma independente', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-lite-'));
  try {
   const path=join(dir,'app.sqlite'); const first=new PreferencesStore(path);
   expect(first.getPerformance()).toEqual({lite:false,muteUnfocused:false});
   expect(first.setPerformance({lite:true})).toEqual({lite:true,muteUnfocused:false});
   expect(first.setPerformance({muteUnfocused:true})).toEqual({lite:true,muteUnfocused:true});
   expect(first.setPerformance({lite:false})).toEqual({lite:false,muteUnfocused:true});
   for (const bad of [null,'sim',[],{lite:1},{muteUnfocused:'true'}]) expect(() => first.setPerformance(bad)).toThrow();
   first.close();
   const second=new PreferencesStore(path); expect(second.getPerformance()).toEqual({lite:false,muteUnfocused:true}); second.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('migra da versão 8 sem perder dados e aceita bancos 0–14 (colunas com padrão 0)', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-lite-mig-'));
  try {
   const path=join(dir,'app.sqlite'); const seed=new PreferencesStore(path); seed.setStartupMode('focus-first'); seed.close();
   const db=new DatabaseSync(path); db.exec('DROP TABLE remote_push; DROP TABLE remote_alert_prefs; DROP TABLE remote_alerts; DROP TABLE remote_pin_state; DROP TABLE remote_devices; DROP TABLE remote_audit; DROP TABLE remote_spend; ALTER TABLE workspace_settings DROP COLUMN remote_net_pin; ALTER TABLE workspace_settings DROP COLUMN remote_net_label; ALTER TABLE workspace_settings DROP COLUMN remote_actions_disabled; ALTER TABLE workspace_settings DROP COLUMN remote_enabled; ALTER TABLE workspace_settings DROP COLUMN remote_port; ALTER TABLE workspace_settings DROP COLUMN remote_pin_hash; ALTER TABLE workspace_settings DROP COLUMN remote_daily_cap_gold; ALTER TABLE workspace_settings DROP COLUMN lite_mode; ALTER TABLE workspace_settings DROP COLUMN mute_unfocused; ALTER TABLE workspace_settings DROP COLUMN tray_on_close; ALTER TABLE workspace_settings DROP COLUMN tray_on_minimize; ALTER TABLE workspace_settings DROP COLUMN tray_hint_shown; PRAGMA user_version=8'); db.close();
   const migrated=new PreferencesStore(path);
   expect(migrated.getStartupMode()).toBe('focus-first'); expect(migrated.getPerformance()).toEqual({lite:false,muteUnfocused:false}); migrated.close();
   const check=new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 18}); check.close();
   const future=new DatabaseSync(path); future.exec('PRAGMA user_version=19'); future.close();
   expect(() => new PreferencesStore(path)).toThrow();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});

describe('bandeja (migração v10)', () => {
 it('padrões 1/1/0, valida, persiste e não toca nas outras preferências', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-tray-'));
  try {
   const path=join(dir,'app.sqlite'); const first=new PreferencesStore(path);
   expect(first.getTray()).toEqual({onClose:true,onMinimize:true,hintShown:false});
   expect(first.setTray({onClose:false})).toEqual({onClose:false,onMinimize:true,hintShown:false});
   expect(first.setTray({hintShown:true,onMinimize:false})).toEqual({onClose:false,onMinimize:false,hintShown:true});
   expect(first.setTray({})).toEqual({onClose:false,onMinimize:false,hintShown:true});
   for (const bad of ['x',null,[],{onClose:1},{onMinimize:'sim'},{hintShown:null},{onClose:false,hintShown:0}]) expect(() => first.setTray(bad)).toThrow();
   expect(first.getPerformance()).toEqual({lite:false,muteUnfocused:false}); first.close();
   const second=new PreferencesStore(path); expect(second.getTray()).toEqual({onClose:false,onMinimize:false,hintShown:true}); second.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('migra um banco v9 preservando dados e ligando as opções por padrão', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-tray-v9-'));
  try {
   const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path); db.exec(`${V3} ALTER TABLE workspace_settings ADD COLUMN hunt_extension_path TEXT; ALTER TABLE workspace_settings ADD COLUMN auto_update_check INTEGER NOT NULL DEFAULT 1; ALTER TABLE workspace_settings ADD COLUMN lite_mode INTEGER NOT NULL DEFAULT 0; ALTER TABLE workspace_settings ADD COLUMN mute_unfocused INTEGER NOT NULL DEFAULT 0; UPDATE workspace_settings SET lite_mode=1; CREATE TABLE extensions (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, added_at TEXT NOT NULL, approved_hosts TEXT); PRAGMA user_version=9;`); db.close();
   const store=new PreferencesStore(path);
   expect(store.getTray()).toEqual({onClose:true,onMinimize:true,hintShown:false}); expect(store.getPerformance().lite).toBe(true); expect(store.getStartupMode()).toBe('focus-first'); store.close();
   const check=new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 18}); expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'}); check.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('recusa uma versão futura (19)', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-tray-v14-'));
  try {
   const path=join(dir,'app.sqlite'); const db=new DatabaseSync(path); db.exec('PRAGMA user_version=19;'); db.close();
   expect(() => new PreferencesStore(path)).toThrow('Versão de banco incompatível');
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});
