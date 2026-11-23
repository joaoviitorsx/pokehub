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
   const check=new DatabaseSync(path); expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'}); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9}); check.close();
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
   const check=new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9}); expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'}); check.close();
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
 it('migra da versão 8 sem perder dados e aceita bancos 0–9 (colunas com padrão 0)', () => {
  const dir=mkdtempSync(join(tmpdir(),'pokehub-lite-mig-'));
  try {
   const path=join(dir,'app.sqlite'); const seed=new PreferencesStore(path); seed.setStartupMode('focus-first'); seed.close();
   const db=new DatabaseSync(path); db.exec('ALTER TABLE workspace_settings DROP COLUMN lite_mode; ALTER TABLE workspace_settings DROP COLUMN mute_unfocused; PRAGMA user_version=8'); db.close();
   const migrated=new PreferencesStore(path);
   expect(migrated.getStartupMode()).toBe('focus-first'); expect(migrated.getPerformance()).toEqual({lite:false,muteUnfocused:false}); migrated.close();
   const check=new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:9}); check.close();
   const future=new DatabaseSync(path); future.exec('PRAGMA user_version=10'); future.close();
   expect(() => new PreferencesStore(path)).toThrow();
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});
