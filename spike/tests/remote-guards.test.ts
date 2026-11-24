import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, createPowerGuard } from '../remote/guards';
import { hostOnly, isAllowedRemote, isLoopback, isPrivateIPv4, unmapIPv4 } from '../remote/ip';
import { deviceNameFromUA, sanitizeName } from '../remote/device-name';
import { RemoteStore } from '../remote/store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/database';

describe('filtro de IP privado', () => {
  it('aceita 10/8, 172.16/12, 192.168/16 e loopback; recusa o resto', () => {
    for (const ip of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.10', '192.168.255.1']) expect(isPrivateIPv4(ip)).toBe(true);
    for (const ip of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '8.8.8.8', '100.64.0.1', '169.254.1.1', '1.2.3', '300.1.1.1', '10.0.0.1.5', '', 'abc']) expect(isPrivateIPv4(ip)).toBe(false);
    expect(isLoopback('127.0.0.1')).toBe(true); expect(isLoopback('128.0.0.1')).toBe(false);
  });
  it('remetente: IPv4-mapeado vale, IPv6 só ::1, públicos e ausentes não', () => {
    expect(unmapIPv4('::ffff:192.168.0.5')).toBe('192.168.0.5');
    for (const ok of ['192.168.0.5', '::ffff:10.1.1.1', '127.0.0.1', '::1']) expect(isAllowedRemote(ok)).toBe(true);
    for (const bad of ['8.8.8.8', '::ffff:8.8.8.8', 'fe80::1', '2001:db8::1', undefined, '']) expect(isAllowedRemote(bad)).toBe(false);
  });
  it('hostOnly', () => { expect(hostOnly('192.168.0.5:47321')).toBe('192.168.0.5'); expect(hostOnly('LocalHost')).toBe('localhost'); for (const bad of [undefined, '', 'a b', 'x'.repeat(200), '[::1]:1', 'a:b']) expect(hostOnly(bad)).toBeNull(); });
});

describe('limite por IP', () => {
  it('janela deslizante', () => {
    let t = 0; const r = new RateLimiter(3, 1000, () => t);
    expect([r.hit('ip'), r.hit('ip'), r.hit('ip'), r.hit('ip')]).toEqual([true, true, true, false]);
    expect(r.hit('outro')).toBe(true);
    t = 1001; expect(r.hit('ip')).toBe(true);
  });
});

describe('sono do PC', () => {
  it('segura só com acesso remoto ligado e ≥1 conta aberta; solta nos outros casos', () => {
    const blocker = {start: vi.fn(() => 5), stop: vi.fn()}; const g = createPowerGuard(blocker);
    expect(g.update(false, 2)).toBe(false); expect(g.update(true, 0)).toBe(false); expect(blocker.start).not.toHaveBeenCalled();
    expect(g.update(true, 1)).toBe(true); expect(g.update(true, 3)).toBe(true); expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(g.update(true, 0)).toBe(false); expect(blocker.stop).toHaveBeenCalledWith(5);
    g.update(true, 1); expect(g.update(false, 1)).toBe(false); expect(blocker.stop).toHaveBeenCalledTimes(2);
  });
});

describe('nome do aparelho', () => {
  it('a partir do User-Agent e saneado', () => {
    expect(deviceNameFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceNameFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('Pixel 8 · Chrome');
    expect(deviceNameFromUA(undefined)).toBe('Celular');
    expect(sanitizeName('  a‮b\u0000c   d ')).toBe('a b c d'); expect(sanitizeName('x'.repeat(100))).toHaveLength(40); expect(sanitizeName(5)).toBe('');
  });
});

describe('banco do acesso remoto (migração v11 e store)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pokehub-rs-'));
  it('banco novo: desligado, porta 47321, sem PIN, teto de 200000; tabelas criadas', () => {
    const path = join(dir, 'new.sqlite'); const s = new RemoteStore(path);
    expect(s.getEnabled()).toBe(false); expect(s.getPort()).toBe(47321); expect(s.getPinHash()).toBeNull(); expect(s.getDailyCapGold()).toBe(200000);
    s.close();
    const db = new DatabaseSync(path); expect(db.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 17});
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('remote_devices','remote_audit','remote_spend') ORDER BY name").all().map(r => r.name)).toEqual(['remote_audit', 'remote_devices', 'remote_spend']);
    db.close();
  });
  it('migração a partir da v10 é não destrutiva', () => {
    const path = join(dir, 'v10.sqlite'); openDatabase(path).close();
    const seed = new DatabaseSync(path); seed.exec("INSERT INTO profiles VALUES ('p1','Conta','e','c','#fff','t','t')"); seed.close();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version=10; DROP TABLE remote_push; DROP TABLE remote_alert_prefs; DROP TABLE remote_alerts; DROP TABLE remote_pin_state; DROP TABLE remote_devices; DROP TABLE remote_audit; DROP TABLE remote_spend; ALTER TABLE workspace_settings DROP COLUMN remote_net_pin; ALTER TABLE workspace_settings DROP COLUMN remote_net_label; ALTER TABLE workspace_settings DROP COLUMN remote_actions_disabled; ALTER TABLE workspace_settings DROP COLUMN remote_enabled; ALTER TABLE workspace_settings DROP COLUMN remote_port; ALTER TABLE workspace_settings DROP COLUMN remote_pin_hash; ALTER TABLE workspace_settings DROP COLUMN remote_daily_cap_gold; UPDATE workspace_settings SET startup_mode='focus-first', tray_on_close=0");
    db.close();
    openDatabase(path).close();
    const check = new DatabaseSync(path);
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 17});
    expect(check.prepare('SELECT startup_mode, tray_on_close, remote_enabled, remote_port FROM workspace_settings').get()).toMatchObject({startup_mode: 'focus-first', tray_on_close: 0, remote_enabled: 0, remote_port: 47321});
    expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label: 'Conta'}); check.close();
  });
  it('dispositivos e auditoria (últimos 100, mais novo primeiro; poda)', () => {
    const s = new RemoteStore(join(dir, 'dev.sqlite'));
    s.addDevice({id: 'd1', name: 'X'.repeat(100), tokenHash: 'h1', now: 't0'});
    expect(() => s.addDevice({id: 'd2', name: 'Y', tokenHash: 'h1', now: 't0'})).toThrow(); // hash único
    expect(s.tokenHashOf('d1')).toBe('h1'); expect(s.getDevice('d1')!.name).toHaveLength(60); expect(s.countDevices()).toBe(1);
    for (let i = 0; i < 2100; i++) s.audit('d1', 'acao', `i${i}`, `t${i}`);
    const list = s.listAudit(); expect(list).toHaveLength(100); expect(list[0]!.detail).toBe('i2099');
    const db = new DatabaseSync(join(dir, 'dev.sqlite')); expect(Number(db.prepare('SELECT COUNT(*) n FROM remote_audit').get()!.n)).toBeLessThanOrEqual(2025); db.close();
    expect(s.revokeDevice('d1')).toBe(true); expect(s.revokeDevice('d1')).toBe(false);
    expect(() => s.setPort(80)).toThrow(); s.setPort(50000); expect(s.getPort()).toBe(50000); s.close();
    rmSync(dir, {recursive: true, force: true});
  }, 90_000); // 2.100 inserções no SQLite: folga para o disco lento do runner Windows
});
