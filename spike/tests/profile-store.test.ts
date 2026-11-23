import { describe, it, expect } from 'vitest';
import { ProfileStore } from '../electron/profile-store';
const input = {label:'Conta',emailLabel:'a@example.com',characterName:'',colorToken:'#d4a65f'};
describe('armazenamento de perfis', () => {
 it('cria, edita, remove e limita a quatro perfis', () => {
  const store = new ProfileStore(':memory:');
  const first = store.create(input);
  expect(store.list()).toHaveLength(1);
  expect(store.update(first.id,{...input,label:'Alterada'}).label).toBe('Alterada');
  for(let i=0;i<3;i++) store.create(input);
  expect(() => store.create(input)).toThrow();
  store.remove(first.id);
  expect(store.list()).toHaveLength(3);
  store.close();
 });
 it('não aceita exclusão ou edição de identificador desconhecido', () => {
  const store = new ProfileStore(':memory:');
  expect(() => store.remove('invalid')).toThrow();
  expect(() => store.update('invalid',input)).toThrow();
  store.close();
 });
});

it('preserva perfis ao reabrir o banco', async () => {
 const { mkdtempSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const dir = mkdtempSync(join(tmpdir(),'pokehub-test-'));
 try {
  const path = join(dir,'profiles.sqlite');
  const first = new ProfileStore(path); const profile = first.create(input); first.close();
  const reopened = new ProfileStore(path); expect(reopened.list()).toEqual([profile]); reopened.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

it('recusa banco de versão futura sem alterá-lo', async () => {
 const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
 const { mkdtempSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const dir = mkdtempSync(join(tmpdir(),'pokehub-version-'));
 try {
  const path = join(dir,'future.sqlite'); const db = new DatabaseSync(path); db.exec('PRAGMA user_version=9'); db.close();
  expect(() => new ProfileStore(path)).toThrow();
  const check = new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toEqual({user_version:9}); check.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

it('impõe o limite de quatro entre duas conexões ao mesmo banco', async () => {
 const { mkdtempSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const dir = mkdtempSync(join(tmpdir(),'pokehub-limite-'));
 try {
  const path = join(dir,'profiles.sqlite');
  const first = new ProfileStore(path); const second = new ProfileStore(path);
  first.create(input); second.create(input); first.create(input); second.create(input);
  expect(() => first.create(input)).toThrow();
  expect(second.list()).toHaveLength(4);
  second.close(); first.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

it('recusa banco inconsistente com mais de quatro perfis sem apagar dados', async () => {
 const { mkdtempSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
 const dir = mkdtempSync(join(tmpdir(),'pokehub-inconsistente-'));
 try {
  const path=join(dir,'profiles.sqlite'); const store=new ProfileStore(path);
  for(let i=0;i<4;i++) store.create(input);
  store.close();
  const db=new DatabaseSync(path);
  db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run('550e8400-e29b-41d4-a716-446655440000','Quinto','a@example.com','','#d4a65f','2026','2026'); db.close();
  const reopened=new ProfileStore(path);
  expect(() => reopened.list()).toThrow(); reopened.close();
  const check=new DatabaseSync(path); expect(check.prepare('SELECT COUNT(*) AS count FROM profiles').get()).toMatchObject({count:5}); check.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
