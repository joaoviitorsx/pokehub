import { afterAll, describe, expect, it, vi } from 'vitest';
import { X509Certificate, createHash, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { discoverNetwork, parsePhysical, parseProfiles, powershell, sameSubnet, subnet24, VIRTUAL_RE, type IfaceSource, type NetProbe } from '../remote/ip';
import { PAIR_MAX_WRONG_GLOBAL, PAIR_MAX_WRONG_IP, Pairing, PinGuard, hashPin, memoryPinStore, verifyPinHash } from '../remote/guards';
import { caFingerprint, createCa, createLeaf, currentSid, ensureCerts, formatFingerprint, mobileconfig, parseCidr, restrictPermissions, type SecretBox } from '../remote/certs';
import { PairRequest, allowReady } from '../src/remote-section';
import { expectedFingerprint } from '../remote-ui/api';
import { isBackedUp, SSE_BACKLOG } from '../remote/server';
import { RemoteStore } from '../remote/store';
import { openDatabase } from '../electron/database';
import { DatabaseSync } from 'node:sqlite';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'pokehub-sec-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, {recursive: true, force: true}); });

describe('rede: descoberta, categoria Privada e adaptador físico', () => {
  const nic = (address: string, netmask = '255.255.255.0') => [{family: 'IPv4', internal: false, address, netmask}];
  const source: IfaceSource = {
    'Wi-Fi': nic('192.168.1.20'), 'Ethernet 2': nic('10.0.0.5', '255.255.0.0'), 'vEthernet (WSL)': nic('172.20.0.1', '255.255.240.0'), 'OpenVPN TAP-Windows': nic('10.8.0.2'),
    'Local Area Connection* 3': nic('192.168.137.1'), Loopback: [{family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0'}], 'Pública': nic('192.168.5.9'), Internet: nic('8.8.8.8'),
  };
  const probe = (cat: Record<string, 'private' | 'public' | 'domain'>, physical: string[] | null): NetProbe => ({
    profiles: async () => Object.entries(cat).map(([alias, category], i) => ({alias, name: `Rede ${alias}`, category, index: i + 1})),
    physical: async () => physical === null ? null : physical.map((alias, i) => ({alias, index: i + 1})),
  });
  it('Windows: só categoria Privada E adaptador físico; virtual/VPN/Wi-Fi Direct/WSL ficam de fora mesmo se marcados Privados', async () => {
    const all = {'Wi-Fi': 'private', 'Ethernet 2': 'public', 'vEthernet (WSL)': 'private', 'OpenVPN TAP-Windows': 'private', 'Local Area Connection* 3': 'private', Pública: 'public'} as const;
    const sel = await discoverNetwork({source, platform: 'win32', probe: probe({...all}, ['Wi-Fi', 'Ethernet 2', 'Pública'])});
    expect(sel.binds.map(b => b.address)).toEqual(['192.168.1.20']); expect(sel.subnets).toEqual(['192.168.1.0/24']); expect(sel.label).toBe('Rede Wi-Fi'); expect(sel.source).toBe('windows');
  });
  it('lista de adaptadores físicos indisponível: cai no filtro por nome (sem liberar virtuais)', async () => {
    const sel = await discoverNetwork({source, platform: 'win32', probe: probe({'Wi-Fi': 'private', 'vEthernet (WSL)': 'private', 'OpenVPN TAP-Windows': 'private'}, null)});
    expect(sel.binds.map(b => b.address)).toEqual(['192.168.1.20']);
  });
  it('falha do PowerShell no Windows = nenhuma interface (nunca libera tudo) e explica', async () => {
    const sel = await discoverNetwork({source, platform: 'win32', probe: {profiles: async () => null, physical: async () => null}});
    expect(sel.binds).toEqual([]); expect(sel.error).toContain('PowerShell');
  });
  it('o pino muda quando a rede muda (nome do perfil ou sub-rede) e é estável quando não muda', async () => {
    const a = await discoverNetwork({source, platform: 'win32', probe: probe({'Wi-Fi': 'private'}, ['Wi-Fi'])}), b = await discoverNetwork({source, platform: 'win32', probe: probe({'Wi-Fi': 'private'}, ['Wi-Fi'])});
    const moved = await discoverNetwork({source: {'Wi-Fi': nic('192.168.7.20')}, platform: 'win32', probe: probe({'Wi-Fi': 'private'}, ['Wi-Fi'])});
    expect(a.pin).toMatch(/^[0-9a-f]{64}$/); expect(b.pin).toBe(a.pin); expect(moved.pin).not.toBe(a.pin);
  });
  it('fora do Windows: impressão digital da sub-rede (sem virtuais por nome)', async () => {
    const sel = await discoverNetwork({source: {eth0: nic('192.168.1.10'), docker0: nic('172.17.0.1', '255.255.0.0'), tun0: nic('10.9.0.2'), wlan0: nic('192.168.1.11')}, platform: 'linux'});
    expect(sel.binds.map(b => b.name)).toEqual(['eth0', 'wlan0']); expect(sel.source).toBe('subnet'); expect(sel.pin).toMatch(/^[0-9a-f]{64}$/);
    expect((await discoverNetwork({source: {eth0: nic('192.168.2.10')}, platform: 'linux'})).pin).not.toBe(sel.pin);
  });
  it('regex de adaptadores virtuais cobre TAP/OpenVPN/WireGuard/NordLynx/ProtonVPN/AnyConnect/vEthernet/WSL/Docker/Hyper-V/ZeroTier/Tailscale/Hamachi', () => {
    for (const name of ['TAP-Windows Adapter V9', 'OpenVPN Data Channel Offload', 'WireGuard Tunnel', 'NordLynx', 'ProtonVPN', 'Cisco AnyConnect', 'vEthernet (Default Switch)', 'vEthernet (WSL (Hyper-V firewall))', 'Docker', 'ZeroTier One', 'Tailscale', 'Hamachi', 'Local Area Connection* 10', 'tun0', 'tap1', 'veth12', 'virbr0', 'br-1a2b', 'utun3']) expect(VIRTUAL_RE.test(name), name).toBe(true);
    for (const name of ['Wi-Fi', 'Ethernet', 'Ethernet 2', 'Local Area Connection', 'wlan0', 'eth0', 'en0']) expect(VIRTUAL_RE.test(name), name).toBe(false);
  });
  it('JSON do PowerShell é lido com defesa: objeto único, lista, número ou texto na categoria, lixo', () => {
    expect(parseProfiles('{"InterfaceIndex":12,"InterfaceAlias":"Wi-Fi","NetworkCategory":1,"Name":"Casa"}')).toEqual([{alias: 'Wi-Fi', name: 'Casa', category: 'private', index: 12}]);
    expect(parseProfiles('\uFEFF[{"InterfaceAlias":"A","NetworkCategory":"Public","Name":"x"},{"InterfaceAlias":"B","NetworkCategory":2,"Name":"y"},{"InterfaceAlias":"C","NetworkCategory":9}]')!.map(p => p.category)).toEqual(['public', 'domain', 'unknown']);
    for (const bad of ['', 'não é json', 'null', '42', '"x"']) expect(parseProfiles(bad)).toBeNull();
    expect(parsePhysical('[{"InterfaceIndex":3,"Name":"Wi-Fi"}]')).toEqual([{alias: 'Wi-Fi', index: 3}]); expect(parsePhysical('{')).toBeNull();
  });
  it('o PowerShell roda com argumentos fixos, sem shell e timeout de 3 s', async () => {
    const calls: unknown[][] = [];
    const out = await powershell('Get-NetConnectionProfile | Select-Object InterfaceIndex,NetworkCategory,Name | ConvertTo-Json -Compress', (file, args, options, cb) => { calls.push([file, args, options]); cb(null, '[]'); });
    expect(out).toBe('[]'); expect(calls[0]![0]).toBe('powershell'); expect(calls[0]![1]).toEqual(['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('Get-NetConnectionProfile')]); expect(calls[0]![2]).toMatchObject({timeout: 3000, windowsHide: true});
    expect(await powershell('x', (_f, _a, _o, cb) => cb(new Error('timeout'), ''))).toBeNull();
  });
  it('mesma sub-rede por máscara', () => {
    expect(sameSubnet('192.168.1.5', '192.168.1.20', '255.255.255.0')).toBe(true); expect(sameSubnet('192.168.2.5', '192.168.1.20', '255.255.255.0')).toBe(false);
    expect(sameSubnet('10.1.2.3', '10.1.200.9', '255.255.0.0')).toBe(true); expect(sameSubnet('10.2.2.3', '10.1.200.9', '255.255.0.0')).toBe(false); expect(sameSubnet('1.1.1.1', '192.168.1.1', '0.0.0.0')).toBe(true); // máscara 0 = tudo (o chamador nunca usa)
    expect(sameSubnet('x', '192.168.1.1', '255.255.255.0')).toBe(false); expect(sameSubnet('192.168.1.1', '192.168.1.2', 'lixo')).toBe(false);
    expect(subnet24('192.168.1.77')).toBe('192.168.1.0/24'); expect(subnet24('nope')).toBeNull();
  });
});

describe('pareamento: tentativas por IP e no total (B1)', () => {
  it('5 erros bloqueiam só aquele IP; o código segue valido para outro IP; 20 no total matam o código', () => {
    const p = new Pairing(() => 0, 120_000, PAIR_MAX_WRONG_IP, () => 'ABCD1234'); p.start();
    for (let i = 0; i < PAIR_MAX_WRONG_IP - 1; i++) expect(p.attempt('ZZZZZZZZ', '1.1.1.1')).toBe('wrong');
    expect(p.attempt('ZZZZZZZZ', '1.1.1.1')).toBe('locked'); expect(p.attempt('ABCD1234', '1.1.1.1')).toBe('locked'); // nem o certo vale
    expect(p.active).toBe(true); expect(p.info()!.byIp).toEqual([{ip: '1.1.1.1', wrong: 5, left: 0}]); expect(p.info()!.attemptsLeft).toBe(PAIR_MAX_WRONG_GLOBAL - 5);
    expect(p.attempt('abcd-1234', '2.2.2.2')).toBe('ok'); expect(p.attempt('ABCD1234', '2.2.2.2')).toBe('inactive');
  });
  it('20 erros espalhados entre IPs invalidam o código', () => {
    const p = new Pairing(() => 0, 120_000, 5, () => 'ABCD1234'); p.start(); let last = '';
    for (let i = 0; i < PAIR_MAX_WRONG_GLOBAL; i++) last = p.attempt('ZZZZZZZZ', `10.0.0.${i % 10}`);
    expect(last).toBe('locked'); expect(p.active).toBe(false); expect(p.attempt('ABCD1234', '10.0.0.200')).toBe('locked');
  });
  it('código reutilizado enquanto o pedido está aberto (contested) e liberado depois', () => {
    const p = new Pairing(() => 0, 120_000, 5, () => 'ABCD1234'); p.start(); expect(p.reused('ABCD1234')).toBe(false);
    p.attempt('ABCD1234', 'a'); expect(p.reused('abcd-1234')).toBe(true); expect(p.reused('ZZZZ-ZZZZ')).toBe(false); p.release(); expect(p.reused('ABCD1234')).toBe(false);
  });
});

describe('PIN: scrypt assíncrono, parâmetros fixos e bloqueios', () => {
  it('formato e params fixos: N/r/p gravados são ignorados na verificação', async () => {
    const h = await hashPin('123456'); expect(h).toMatch(/^scrypt\$16384\$8\$1\$/); expect(h).not.toContain('123456'); expect(await hashPin('123456')).not.toBe(h);
    expect(await verifyPinHash('123456', h)).toBe(true); expect(await verifyPinHash('123457', h)).toBe(false); expect(await verifyPinHash('123456', null)).toBe(false); expect(await verifyPinHash('123456', 'lixo')).toBe(false);
    const [, , , , salt, hash] = h.split('$'); const weak = `scrypt$2$1$1$${salt}$${hash}`; // adulterado para "enfraquecer"
    expect(await verifyPinHash('123456', weak)).toBe(true); // verificado com os parâmetros fixos (o hash original continua valendo)
    const forged = `scrypt$2$1$1$${salt}$${scryptSync('999999', Buffer.from(salt!, 'base64'), 32, {N: 2, r: 1, p: 1}).toString('base64')}`;
    expect(await verifyPinHash('999999', forged)).toBe(false); // um hash gerado com N=2 não passa
  });
  it('não bloqueia o event loop enquanto o scrypt roda', async () => {
    const h = await hashPin('246810'); let ticks = 0; const timer = setInterval(() => { ticks++; }, 5);
    const guard = new PinGuard(() => h); const t0 = Date.now();
    await Promise.all(Array.from({length: 8}, (_v, i) => guard.check(`d${i}`, '000000')));
    clearInterval(timer); expect(Date.now() - t0).toBeGreaterThan(30); expect(ticks).toBeGreaterThan(4);
  });
  it('escalonamento 15 min → 1 h → 24 h → revoga; acerto zera; sem PIN nada passa', async () => {
    let t = Date.UTC(2026, 0, 1, 12); const h = await hashPin('246810'), events: string[] = [], store = memoryPinStore();
    const g = new PinGuard(() => h, () => t, {onLock: (id, level) => events.push(`lock:${id}:${level}`), onRevoke: id => events.push(`revoke:${id}`)}, store);
    expect(await g.check('a', 'x')).toMatchObject({ok: false, reason: 'wrong', attemptsLeft: 4}); expect(await g.check('a', '246810')).toEqual({ok: true});
    const burn = async () => { for (let i = 0; i < 4; i++) await g.check('a', '000000'); return g.check('a', '000000'); };
    expect(await burn()).toMatchObject({reason: 'locked', retryAfterMs: 15 * 60_000}); g.reset();
    t += 60_000; expect(await g.check('a', '246810')).toMatchObject({reason: 'locked'}); expect(await g.check('b', '246810')).toEqual({ok: true});
    t += 15 * 60_000; expect(await burn()).toMatchObject({reason: 'locked', retryAfterMs: 3_600_000}); g.reset();
    t += 3_600_000; expect(await burn()).toMatchObject({reason: 'locked', retryAfterMs: 86_400_000}); g.reset();
    t += 86_400_000; expect(await burn()).toMatchObject({reason: 'revoked'});
    expect(events).toEqual(['lock:a:1', 'lock:a:2', 'lock:a:3', 'revoke:a']);
    expect(await new PinGuard(() => null).check('a', '123456')).toEqual({ok: false, reason: 'no-pin'});
  });
  it('10 erros no mesmo dia desligam tudo; dia novo zera a contagem; religar limpa', async () => {
    let t = new Date(2026, 0, 1, 23, 0).getTime(); const h = await hashPin('246810'), off: number[] = [], store = memoryPinStore();
    const g = new PinGuard(() => h, () => t, {onDisable: () => off.push(t)}, store);
    for (let i = 0; i < 4; i++) { await g.check('a', '1'); await g.check('b', '1'); } await g.check('c', '0');
    expect(store.actionsDisabled()).toBe(false);
    t += 2 * 3_600_000; await g.check('c', '0'); expect(store.actionsDisabled()).toBe(false); // virou o dia: recomeçou em 1
    for (let i = 0; i < 9; i++) await g.check(`x${i}`, '0');
    expect(store.actionsDisabled()).toBe(true); expect(off).toHaveLength(1); expect(await g.check('a', '246810')).toMatchObject({reason: 'disabled'});
    g.reset(); expect(store.actionsDisabled()).toBe(false); expect(await g.check('a', '246810')).toEqual({ok: true});
  });
});

/** Leitor mínimo de DER só para os testes: acha a extensão e devolve o conteúdo dos GeneralSubtrees. */
function tlv(buf: Buffer, at: number) { const tag = buf[at]!; let len = buf[at + 1]!, head = 2; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]!; head = 2 + n; } return {tag, start: at + head, end: at + head + len}; }
const kids = (buf: Buffer, start: number, end: number) => { const out: {tag: number; start: number; end: number}[] = []; for (let at = start; at < end;) { const t = tlv(buf, at); out.push(t); at = t.end; } return out; };
function nameConstraints(der: Buffer) {
  const cert = tlv(der, 0), tbs = kids(der, cert.start, cert.end)[0]!, wrap = kids(der, tbs.start, tbs.end).find(p => p.tag === 0xa3)!, seq = tlv(der, wrap.start);
  const nc = kids(der, seq.start, seq.end).find(ext => { const f = kids(der, ext.start, ext.end); return der.subarray(f[0]!.start, f[0]!.end).toString('hex') === '551d1e'; })!;
  const f = kids(der, nc.start, nc.end), inner = tlv(der, f[f.length - 1]!.start), groups = kids(der, inner.start, inner.end);
  const subtrees = (tag: number) => { const g = groups.find(x => x.tag === tag); return g ? kids(der, g.start, g.end).map(s => { const [name] = kids(der, s.start, s.end); return {tag: name!.tag, value: der.subarray(name!.start, name!.end)}; }) : []; };
  return {permitted: subtrees(0xa0), excluded: subtrees(0xa1), critical: f.some(x => x.tag === 0x01)};
}
const ipRange = (v: Buffer) => `${[...v.subarray(0, 4)].join('.')}/${[...v.subarray(4, 8)].join('.')}`;

describe('CA: escopo, chaves e impressão digital (M3, A1)', () => {
  it('restrição de nomes: só as /24 fixadas + 127.0.0.1/32 + localhost; IPv6 inteiro excluído; crítica', () => {
    const ca = createCa(Date.now(), ['192.168.1.0/24', '10.5.5.0/24']), nc = nameConstraints(ca.der);
    expect(nc.critical).toBe(true);
    expect(nc.permitted.filter(s => s.tag === 0x87).map(s => ipRange(s.value)).sort()).toEqual(['10.5.5.0/255.255.255.0', '127.0.0.1/255.255.255.255', '192.168.1.0/255.255.255.0']);
    expect(nc.permitted.filter(s => s.tag === 0x82).map(s => s.value.toString())).toEqual(['localhost']);
    expect(nc.excluded).toEqual([{tag: 0x87, value: Buffer.alloc(32)}]);
    for (const wide of ['10.0.0.0/255.0.0.0', '172.16.0.0/255.240.0.0', '192.168.0.0/255.255.0.0']) expect(nc.permitted.map(s => s.tag === 0x87 ? ipRange(s.value) : '')).not.toContain(wide);
  });
  it('sem sub-redes: só loopback/localhost', () => { expect(nameConstraints(createCa(Date.now(), []).der).permitted.filter(s => s.tag === 0x87).map(s => ipRange(s.value))).toEqual(['127.0.0.1/255.255.255.255']); });
  it('parseCidr aceita /8–/32 e recusa o resto', () => { expect(parseCidr('192.168.1.0/24')).toEqual(['192.168.1.0', '255.255.255.0']); expect(parseCidr('1.2.3.4/32')![1]).toBe('255.255.255.255'); for (const bad of ['1.2.3.4/7', '1.2.3.4/33', '1.2.3/24', 'x/24', '300.1.1.1/24']) expect(parseCidr(bad)).toBeNull(); });
  const box: SecretBox = {encrypt: s => Buffer.from(s, 'utf8').reverse(), decrypt: b => Buffer.from(b).reverse().toString('utf8')};
  it('com cifra: o arquivo da chave não começa com -----BEGIN, volta a abrir e a leitura sem a cifra falha para regenerar', () => {
    const dir = tmp(), a = ensureCerts(dir, ['192.168.1.20'], {restrict: false, box});
    for (const f of ['ca.key.pem', 'leaf.key.pem']) { const raw = readFileSync(join(dir, f)); expect(raw.subarray(0, 10).toString('latin1')).not.toContain('-----BEGIN'); expect(raw.toString('latin1')).not.toContain('PRIVATE KEY'); }
    const b = ensureCerts(dir, ['192.168.1.20'], {restrict: false, box}); expect(b.created).toBe(false); expect(b.leafCert).toBe(a.leafCert); expect(b.leafKey).toBe(a.leafKey);
    const lost = ensureCerts(dir, ['192.168.1.20'], {restrict: false}); expect(lost.created).toBe(true); // outro usuário/máquina: não dá para abrir → refaz (e é preciso reinstalar)
  });
  it('chave antiga em texto passa a cifrada quando a cifra aparece, sem trocar a CA', () => {
    const dir = tmp(), a = ensureCerts(dir, ['192.168.1.20'], {restrict: false});
    expect(readFileSync(join(dir, 'ca.key.pem'), 'utf8')).toContain('PRIVATE KEY');
    const b = ensureCerts(dir, ['192.168.1.20'], {restrict: false, box}); expect(b.created).toBe(false); expect(b.caCert).toBe(a.caCert);
    expect(readFileSync(join(dir, 'ca.key.pem')).toString('latin1')).not.toContain('PRIVATE KEY'); expect(readFileSync(join(dir, 'leaf.key.pem')).toString('latin1')).not.toContain('PRIVATE KEY');
  });
  it('a CA é refeita quando a sub-rede muda (caRegenerated) e a impressão digital muda junto; mesma sub-rede com IP novo mantém a CA', () => {
    const dir = tmp(), a = ensureCerts(dir, ['192.168.1.20'], {restrict: false});
    expect(a.caRegenerated).toBe(false);
    const sameNet = ensureCerts(dir, ['192.168.1.21'], {restrict: false}); expect(sameNet.caCert).toBe(a.caCert); expect(sameNet.caRegenerated).toBe(false); expect(sameNet.leafCert).not.toBe(a.leafCert);
    const moved = ensureCerts(dir, ['192.168.9.20'], {restrict: false}); expect(moved.created).toBe(true); expect(moved.caRegenerated).toBe(true); expect(moved.fingerprint).not.toBe(a.fingerprint);
    expect(new X509Certificate(moved.leafCert).subjectAltName).toContain('IP Address:192.168.9.20');
    expect(nameConstraints(moved.caDer).permitted.filter(s => s.tag === 0x87).map(s => ipRange(s.value))).toContain('192.168.9.0/255.255.255.0');
  });
  it('impressão digital: SHA-256 do DER, em blocos de 4 maiúsculos; vai no mobileconfig', () => {
    const ca = createCa(), hex = createHash('sha256').update(ca.der).digest('hex');
    expect(caFingerprint(ca.der)).toBe(hex); expect(formatFingerprint(hex)).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/); expect(formatFingerprint(hex).replace(/ /g, '')).toBe(hex.toUpperCase());
    const plist = mobileconfig(ca.der); expect(plist).toContain(`<key>PayloadDescription</key><string>Certificado local do PokeHub. Impressão digital SHA-256: ${formatFingerprint(hex)}`); expect(plist).not.toContain('continue com o aviso');
  });
  it('um cliente confia na folha emitida por uma CA restrita (handshake dos testes de TLS segue valendo)', () => {
    const ca = createCa(Date.now(), ['192.168.1.0/24']), leaf = createLeaf(ca.cert, ca.key, ['192.168.1.20']);
    expect(new X509Certificate(leaf.cert).verify(new X509Certificate(ca.cert).publicKey)).toBe(true);
  });
  it('SID do usuário via whoami (execFile, CSV) e icacls com *SID; falhas viram false', () => {
    expect(currentSid(() => '"DESKTOP\\joao","S-1-5-21-111-222-333-1001"\r\n')).toBe('S-1-5-21-111-222-333-1001'); expect(currentSid(() => 'sem sid')).toBeNull(); expect(currentSid(() => { throw new Error('x'); })).toBeNull();
    if (process.platform === 'win32') {
      const calls: string[][] = [];
      expect(restrictPermissions('C:\\x', (_f, args) => { calls.push(args); }, () => 'S-1-5-21-1-2-3-1001')).toBe(true);
      expect(calls[0]).toEqual(['C:\\x', '/inheritance:r', '/grant:r', '*S-1-5-21-1-2-3-1001:(OI)(CI)F']);
      expect(restrictPermissions('C:\\x', () => undefined, () => null)).toBe(false); expect(restrictPermissions('C:\\x', () => { throw new Error('icacls'); }, () => 'S-1-5-21-1-2-3-1001')).toBe(false);
    }
  });
});

describe('UI do PC: pedido de pareamento (M2)', () => {
  const request = {name: 'Pixel', nickname: 'Meu "celular" <b>x</b>', ua: 'Pixel 8 · Chrome', ip: '192.168.1.20', sas: '47', contested: false, since: 1000, deciding: false};
  it('"Permitir" só depois de 1,5 s do pedido e de qualquer troca de foco (timers falsos)', () => {
    vi.useFakeTimers(); try {
      vi.setSystemTime(1000); const since = Date.now(); let focusAt = 0;
      expect(allowReady(Date.now(), since, focusAt)).toBe(false);
      vi.advanceTimersByTime(1499); expect(allowReady(Date.now(), since, focusAt)).toBe(false);
      vi.advanceTimersByTime(1); expect(allowReady(Date.now(), since, focusAt)).toBe(true);
      focusAt = Date.now(); expect(allowReady(Date.now(), since, focusAt)).toBe(false); // a janela perdeu/ganhou foco
      vi.advanceTimersByTime(1500); expect(allowReady(Date.now(), since, focusAt)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('mostra o número, o nome do servidor separado do apelido e desliga "Permitir" enquanto não pronto', () => {
    const html = renderToStaticMarkup(createElement(PairRequest, {request, ready: false, onDecide: () => undefined}));
    expect(html).toContain('O celular deve estar mostrando <strong>47</strong>'); expect(html).toContain('Aparelho (lido pelo PC): <strong>Pixel 8 · Chrome</strong>'); expect(html).toContain('Apelido informado pelo celular (não confiável)');
    expect(html).not.toContain('<b>x</b>'); // o apelido é texto, nunca HTML
    expect(html).toMatch(/<button class="primary" disabled="">Aguarde…<\/button>/); expect(html).not.toContain('Atenção');
    const ready = renderToStaticMarkup(createElement(PairRequest, {request, ready: true, onDecide: () => undefined})); expect(ready).toMatch(/<button class="primary">Permitir<\/button>/);
  });
  it('contested avisa e recomenda Recusar; deciding mostra a janela do sistema', () => {
    const html = renderToStaticMarkup(createElement(PairRequest, {request: {...request, contested: true}, ready: true, onDecide: () => undefined}));
    expect(html).toContain('mais de um aparelho'); expect(html).toContain('<strong>Recusar</strong> e gerar um código novo');
    expect(renderToStaticMarkup(createElement(PairRequest, {request: {...request, deciding: true}, ready: true, onDecide: () => undefined}))).toContain('Confirme na janela do sistema');
  });
});

describe('celular, empacotamento e migração', () => {
  it('o QR de bootstrap leva #fp=<sha256> e a página só aceita 64 hex', () => {
    const hex = 'ab'.repeat(32);
    expect(expectedFingerprint(`#fp=${hex}`)).toBe(('AB'.repeat(2) + ' ').repeat(15) + 'ABAB'); expect(expectedFingerprint('')).toBeNull(); expect(expectedFingerprint('#fp=abc')).toBeNull(); expect(expectedFingerprint(`#x=1&fp=${hex}`)).not.toBeNull(); expect(expectedFingerprint(`#fp=${hex}zz`)).toBeNull();
  });
  it('o service worker acrescenta X-PH-SW nas chamadas de pareamento e o texto documenta que é heurística', () => {
    const sw = readFileSync('spike/remote-ui/public/sw.js', 'utf8');
    expect(sw).toContain("'X-PH-SW', '1'"); expect(sw).toContain('/api/pair/wait'); expect(sw).toContain('HEURÍSTICA');
  });
  it('a interface do celular nunca diz "continue com o aviso" sem a verificação da impressão digital', () => {
    for (const f of ['spike/remote-ui/main.tsx', 'spike/src/remote-section.tsx', 'docs/ACESSO-REMOTO.md']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/continuar? (mesmo )?com o aviso|aceite o aviso|ignore o aviso/i);
  });
  it('isBackedUp: acima de 256 KB pendentes derruba o fluxo', () => { expect(SSE_BACKLOG).toBe(256 * 1024); expect(isBackedUp({writableLength: SSE_BACKLOG})).toBe(false); expect(isBackedUp({writableLength: SSE_BACKLOG + 1})).toBe(true); });
  it('vite: dois builds com saídas separadas (dist e dist-remote) e o desktop sem publicDir do celular', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(config).toContain("outDir: 'dist-remote'"); expect(config).toContain('publicDir: false'); expect(config).toContain("input: { main: 'index.html' }");
    for (const f of ['dist/sw.js', 'dist/manifest.webmanifest', 'dist/remote.html']) expect(existsSync(f), f).toBe(false);
    if (existsSync('dist-remote/remote.html')) { expect(existsSync('dist-remote/index.html')).toBe(false); expect(existsSync('dist-remote/sw.js')).toBe(true); }
  });
  it('migração v12/v13 é não destrutiva e as tabelas/colunas novas existem (aceita 0–14)', () => {
    const dir = tmp(), path = join(dir, 'v.sqlite'); openDatabase(path).close();
    const db = new DatabaseSync(path); db.exec("INSERT INTO profiles VALUES ('p1','Conta','e','c','#fff','t','t'); INSERT INTO remote_devices (id, name, token_hash, created_at) VALUES ('d','N','h','t'); DROP TABLE remote_push; DROP TABLE remote_alert_prefs; DROP TABLE remote_alerts; DROP TABLE remote_pin_state; ALTER TABLE remote_devices DROP COLUMN prev_token_hash; ALTER TABLE remote_devices DROP COLUMN prev_valid_until; ALTER TABLE remote_devices DROP COLUMN rotated_at; ALTER TABLE workspace_settings DROP COLUMN remote_net_pin; ALTER TABLE workspace_settings DROP COLUMN remote_net_label; ALTER TABLE workspace_settings DROP COLUMN remote_actions_disabled; PRAGMA user_version=11"); db.close();
    openDatabase(path).close();
    const check = new DatabaseSync(path); expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version: 15});
    expect(check.prepare("SELECT id, rotated_at, prev_valid_until FROM remote_devices").get()).toMatchObject({id: 'd', rotated_at: 0, prev_valid_until: 0});
    expect(check.prepare('SELECT label FROM profiles').get()).toMatchObject({label: 'Conta'}); expect(check.prepare('SELECT remote_net_pin, remote_actions_disabled FROM workspace_settings').get()).toMatchObject({remote_net_pin: null, remote_actions_disabled: 0});
    check.prepare("INSERT INTO remote_pin_state (key, fails) VALUES ('d', 1)").run(); check.close();
    const store = new RemoteStore(path); expect(store.pinState('d')).toMatchObject({fails: 1}); store.setNetPin('abc', 'Casa'); expect(store.getNetPin()).toEqual({pin: 'abc', label: 'Casa'}); store.close();
    writeFileSync(join(dir, 'x'), '');
  });
});
