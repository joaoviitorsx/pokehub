import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrindolinoStore } from '../electron/grindolino-store';
import { GrindolinoError } from '../domain/grindolino';
import { ProfileStore } from '../electron/profile-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const profile = {label:'Conta',emailLabel:'a@example.com',characterName:'',colorToken:'#d4a65f'};
const V2 = "CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); CREATE TABLE workspace_settings (id INTEGER PRIMARY KEY CHECK (id = 1), startup_mode TEXT NOT NULL CHECK (startup_mode IN ('grid', 'focus-first'))); INSERT INTO workspace_settings VALUES (1, 'focus-first');";
function withDir(run: (path: string) => void) {
 const dir = mkdtempSync(join(tmpdir(),'pokehub-grindolino-'));
 try { run(join(dir,'app.sqlite')); } finally { rmSync(dir,{recursive:true,force:true}); }
}
const count = (path: string, table: string) => { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count; } finally { db.close(); } };

describe('armazenamento do Grindolino', () => {
 it('cria, edita, mede, classifica e remove em cascata', () => withDir(path => {
  const profiles = new ProfileStore(path); const store = new GrindolinoStore(path);
  const first = profiles.create(profile), second = profiles.create(profile);
  const cave = store.createHunt({name:' Caverna ',region:'Kanto',requiredTrainerLevel:10});
  const forest = store.createHunt({name:'Floresta',region:'',requiredTrainerLevel:null});
  expect(store.listHunts()).toEqual([cave,forest]);
  expect(store.updateHunt(cave.id,{name:'Caverna funda',region:'Kanto',requiredTrainerLevel:20})).toEqual({...cave,name:'Caverna funda',requiredTrainerLevel:20});
  store.addForecast({accountId:first.id,huntId:cave.id,xpPerHour:1000,coinsPerHour:null});
  store.addForecast({accountId:first.id,huntId:forest.id,xpPerHour:5000,coinsPerHour:10});
  const old = store.addMeasurement({accountId:first.id,huntId:cave.id,minutes:30,xpGained:600,coinsGained:null});
  const recent = store.addMeasurement({accountId:first.id,huntId:cave.id,minutes:30,xpGained:900,coinsGained:50});
  store.addMeasurement({accountId:second.id,huntId:cave.id,minutes:60,xpGained:1,coinsGained:1});
  expect(store.listMeasurements(first.id)).toEqual([recent,old]);
  const rows = store.rank({accountId:first.id,objective:'xp',trainerLevel:30});
  expect(rows.map(row => [row.hunt.name,row.sortValue,row.sortSource])).toEqual([['Floresta',5000,'forecast'],['Caverna funda',1500,'observed']]);
  expect(rows[1]?.deltaRatio).toBeCloseTo(0.5);
  expect(store.compare({objective:'xp'}).map(row => [row.hunt.name,row.cells.map(cell => [cell.accountId,cell.forecastPerHour,cell.observedPerHour]),row.bestAccountId,row.missingAccountIds])).toEqual([
   ['Caverna funda',[[first.id,1000,1500],[second.id,null,1]],first.id,[]],
   ['Floresta',[[first.id,5000,null],[second.id,null,null]],first.id,[second.id]],
  ]);
  store.removeMeasurement(old.id);
  expect(store.listMeasurements(first.id)).toEqual([recent]);
  expect(() => store.removeMeasurement(old.id)).toThrow();
  profiles.remove(first.id); // conexão diferente: a cascata vem da FK
  expect(count(path,'grindolino_forecasts')).toBe(0);
  expect(count(path,'grindolino_measurements')).toBe(1);
  store.removeHunt(cave.id);
  expect(count(path,'grindolino_measurements')).toBe(0);
  expect(store.listHunts()).toEqual([forest]);
  store.close(); profiles.close();
 }));
 it('recusa entradas inválidas e referências inexistentes sem gravar', () => withDir(path => {
  const profiles = new ProfileStore(path); const store = new GrindolinoStore(path);
  const account = profiles.create(profile); const hunt = store.createHunt({name:'Caverna',region:'',requiredTrainerLevel:null});
  const missing = '550e8400-e29b-41d4-a716-446655440000';
  expect(() => store.createHunt({name:'x'.repeat(5000),region:'',requiredTrainerLevel:null})).toThrow();
  expect(() => store.updateHunt(missing,{name:'Outra',region:'',requiredTrainerLevel:null})).toThrow();
  expect(() => store.removeHunt(missing)).toThrow();
  expect(() => store.removeHunt("' OR 1=1 --")).toThrow();
  const thrown = (run: () => unknown) => { try { run(); } catch (error) { return error; } return null; };
  for (const [run,message] of [
   [() => store.addForecast({accountId:missing,huntId:hunt.id,xpPerHour:1,coinsPerHour:null}),'Conta não encontrada'],
   [() => store.addForecast({accountId:account.id,huntId:missing,xpPerHour:1,coinsPerHour:null}),'Hunt não encontrada'],
   [() => store.addMeasurement({accountId:missing,huntId:hunt.id,minutes:10,xpGained:1,coinsGained:null}),'Conta não encontrada'],
   [() => store.addMeasurement({accountId:account.id,huntId:missing,minutes:10,xpGained:1,coinsGained:null}),'Hunt não encontrada'],
   [() => store.updateHunt(missing,{name:'Outra',region:'',requiredTrainerLevel:null}),'Hunt não encontrada'],
   [() => store.removeHunt(missing),'Hunt não encontrada'],
   [() => store.removeMeasurement(missing),'Medição não encontrada'],
   [() => store.removeHunt("' OR 1=1 --"),'Hunt inválida'],
   [() => store.compare({objective:'gold'}),'Objetivo inválido'],
  ] as const) {
   const error = thrown(run);
   expect(error).toBeInstanceOf(GrindolinoError);
   expect((error as Error).message).toBe(message);
  }
  expect(() => store.addMeasurement({accountId:account.id,huntId:hunt.id,minutes:NaN,xpGained:1,coinsGained:null})).toThrow();
  expect(() => store.rank({accountId:account.id,objective:'gold',trainerLevel:null})).toThrow();
  expect(() => store.listMeasurements('id')).toThrow();
  expect(store.listHunts()).toEqual([hunt]);
  expect(count(path,'grindolino_forecasts')).toBe(0); expect(count(path,'grindolino_measurements')).toBe(0);
  store.close(); profiles.close();
 }));
});

describe('migração para a versão 5', () => {
 const V4 = `${V2} ALTER TABLE workspace_settings ADD COLUMN hunt_extension_path TEXT; CREATE TABLE grindolino_hunts (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL, required_trainer_level INTEGER, created_at TEXT NOT NULL); INSERT INTO grindolino_hunts VALUES ('h','Caverna','',NULL,'2026');
  CREATE TABLE grindolino_measurements (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, hunt_id TEXT NOT NULL REFERENCES grindolino_hunts(id) ON DELETE CASCADE, minutes INTEGER NOT NULL, xp_gained INTEGER, coins_gained INTEGER, recorded_at TEXT NOT NULL); INSERT INTO grindolino_measurements VALUES ('m','id','h',30,600,NULL,'2026');
  CREATE TABLE grindolino_forecasts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, hunt_id TEXT NOT NULL, xp_per_hour INTEGER, coins_per_hour INTEGER, read_at TEXT NOT NULL);`;
 it('migra a versão 4 preservando as medições e grava abates, shinies e Pokémon', () => withDir(path => {
  const db = new DatabaseSync(path); db.exec(`${V4} PRAGMA user_version=4;`); db.close();
  const profiles = new ProfileStore(path); const store = new GrindolinoStore(path);
  const account = profiles.create(profile); const hunt = store.createHunt({name:'Sunkern',region:'',requiredTrainerLevel:null});
  const typed = store.addMeasurement({accountId:account.id,huntId:hunt.id,minutes:10,xpGained:5,coinsGained:null});
  expect(typed).toMatchObject({killCount:null,shinyCount:null,pokemonKey:null,pokemonName:null,pokemonLevel:null,pokemonLevelEnd:null});
  const live = store.addMeasurement({accountId:account.id,huntId:hunt.id,minutes:10,xpGained:5,coinsGained:7,killCount:40,shinyCount:1,pokemonKey:'77',pokemonName:'Sunflora',pokemonLevel:120,pokemonLevelEnd:121});
  expect(store.listMeasurements(account.id)).toEqual([live,typed]);
  expect(store.rank({accountId:account.id,objective:'xp',trainerLevel:null})[0]?.observed).toMatchObject({killsPerHour:240,shinyPerHour:6});
  store.close(); profiles.close();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:6});
  expect(check.prepare("SELECT minutes, xp_gained, kill_count, pokemon_key FROM grindolino_measurements WHERE id='m'").get()).toMatchObject({minutes:30,xp_gained:600,kill_count:null,pokemon_key:null});
  check.close();
 }));
 it('mantém a versão 4 e os dados se a migração falhar no meio', () => withDir(path => {
  const db = new DatabaseSync(path); db.exec(`${V4} ALTER TABLE grindolino_measurements ADD COLUMN shiny_count INTEGER; PRAGMA user_version=4;`); db.close();
  expect(() => new GrindolinoStore(path)).toThrow();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:4});
  expect(check.prepare("SELECT minutes FROM grindolino_measurements WHERE id='m'").get()).toMatchObject({minutes:30});
  expect(check.prepare("SELECT name FROM pragma_table_info('grindolino_measurements') WHERE name='kill_count'").all()).toEqual([]); // o ALTER anterior foi desfeito
  check.close();
 }));
 it('migra a versão 5 para a 6 criando o índice de histórico sem tocar nas medições', () => withDir(path => {
  new GrindolinoStore(path).close(); // banco atual, rebaixado à forma da versão 5
  const db = new DatabaseSync(path); db.exec(`INSERT INTO profiles VALUES ('id','Conta','a@example.com','','#d4a65f','2026','2026'); INSERT INTO grindolino_hunts VALUES ('h','Caverna','',NULL,'2026'); INSERT INTO grindolino_measurements (id, account_id, hunt_id, minutes, xp_gained, recorded_at) VALUES ('m','id','h',30,600,'2026'); DROP INDEX grindolino_measurements_account_time; PRAGMA user_version=5;`); db.close();
  new GrindolinoStore(path).close();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:6});
  expect(check.prepare("SELECT minutes, xp_gained FROM grindolino_measurements WHERE id='m'").get()).toMatchObject({minutes:30,xp_gained:600});
  expect(String(check.prepare("EXPLAIN QUERY PLAN SELECT * FROM grindolino_measurements WHERE account_id='id' AND recorded_at>='2026'").get()?.detail)).toContain('grindolino_measurements_account_time');
  check.close();
 }));
 it('desfaz a versão 5 inteira se o índice da versão 6 falhar', () => withDir(path => {
  const db = new DatabaseSync(path); db.exec(`${V4} CREATE INDEX grindolino_measurements_account_time ON grindolino_measurements (minutes); PRAGMA user_version=4;`); db.close();
  expect(() => new GrindolinoStore(path)).toThrow();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:4});
  expect(check.prepare("SELECT minutes FROM grindolino_measurements WHERE id='m'").get()).toMatchObject({minutes:30});
  expect(check.prepare("SELECT name FROM pragma_table_info('grindolino_measurements') WHERE name='kill_count'").all()).toEqual([]);
  check.close();
 }));
});

describe('migração para a versão 3', () => {
 it('migra um banco da versão 2 sem perder perfis nem preferências', () => withDir(path => {
  const db = new DatabaseSync(path); db.exec(`${V2} PRAGMA user_version=2;`); db.close();
  const store = new GrindolinoStore(path); expect(store.listHunts()).toEqual([]); store.close();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:6});
  expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
  expect(check.prepare('SELECT startup_mode FROM workspace_settings').get()).toMatchObject({startup_mode:'focus-first'});
  check.close();
  const reopened = new GrindolinoStore(path); reopened.createHunt({name:'Caverna',region:'',requiredTrainerLevel:null}); reopened.close();
  expect(count(path,'grindolino_hunts')).toBe(1);
 }));
 it('mantém a versão 2 e os dados se a migração falhar no meio', () => withDir(path => {
  const db = new DatabaseSync(path); db.exec(`${V2} CREATE TABLE grindolino_measurements (other TEXT); PRAGMA user_version=2;`); db.close();
  expect(() => new GrindolinoStore(path)).toThrow();
  const check = new DatabaseSync(path);
  expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:2});
  expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label:'Conta'});
  expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN ('grindolino_hunts','grindolino_forecasts')").all()).toEqual([]);
  check.close();
 }));
});
