import { afterAll, describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { createServer, request } from 'node:https';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCa, createLeaf, ensureCerts, leafUsable, mobileconfig } from '../remote/certs';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'pokehub-certs-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, {recursive: true, force: true}); });
const DAY = 86_400_000;

describe('certificados locais', () => {
  it('a CA é uma CA de verdade, restrita a nomes privados, e a folha tem o IP da LAN no SAN', () => {
    const ca = createCa(), leaf = createLeaf(ca.cert, ca.key, ['192.168.1.20', '10.0.0.5']);
    const caX = new X509Certificate(ca.cert), leafX = new X509Certificate(leaf.cert);
    expect(caX.ca).toBe(true);
    expect(leafX.ca).toBe(false);
    expect(leafX.checkIssued(caX)).toBe(true);
    expect(leafX.verify(caX.publicKey)).toBe(true);
    expect(leafX.subjectAltName).toContain('IP Address:192.168.1.20');
    expect(leafX.subjectAltName).toContain('IP Address:10.0.0.5');
    expect(leafX.subjectAltName).toContain('DNS:localhost');
    expect(leafX.checkIP('192.168.1.20')).toBeDefined();
    expect(leafX.checkIP('192.168.1.21')).toBeUndefined();
  });
  it('validade: folha de 397 dias (limite do iOS é 398) e CA de 10 anos', () => {
    const now = Date.now(), ca = createCa(now), leaf = createLeaf(ca.cert, ca.key, ['192.168.0.2'], now);
    const days = (c: string) => (new Date(new X509Certificate(c).validTo).getTime() - now) / DAY;
    expect(days(leaf.cert)).toBeGreaterThan(395); expect(days(leaf.cert)).toBeLessThan(398);
    expect(days(ca.cert)).toBeGreaterThan(3600);
    expect(new Date(new X509Certificate(leaf.cert).validFrom).getTime()).toBeLessThanOrEqual(now);
  });
  it('um cliente que confia só na CA valida a folha por IP (handshake TLS real, inclusive a restrição de nomes)', async () => {
    const ca = createCa(), leaf = createLeaf(ca.cert, ca.key, ['192.168.1.20']);
    const server = createServer({cert: leaf.cert, key: leaf.key}, (_req, res) => res.end('ok'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as {port: number}).port;
    const body = await new Promise<string>((resolve, reject) => {
      request({host: '127.0.0.1', port, ca: ca.cert, path: '/'}, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve(t)); }).on('error', reject).end();
    });
    expect(body).toBe('ok');
    const other = createCa();
    await expect(new Promise((resolve, reject) => request({host: '127.0.0.1', port, ca: other.cert, path: '/'}, resolve).on('error', reject).end())).rejects.toThrow();
    await new Promise(resolve => server.close(resolve));
  });
  it('ensureCerts gera na primeira vez, reaproveita, e renova a folha quando surge um IP novo (mantendo a CA)', () => {
    const dir = tmp(), a = ensureCerts(dir, ['192.168.1.20'], {restrict: false});
    expect(a.created).toBe(true);
    const b = ensureCerts(dir, ['192.168.1.20'], {restrict: false});
    expect(b.created).toBe(false); expect(b.leafCert).toBe(a.leafCert);
    const c = ensureCerts(dir, ['192.168.1.20', '10.1.1.1'], {restrict: false});
    expect(c.caCert).toBe(a.caCert); expect(c.leafCert).not.toBe(a.leafCert);
    expect(new X509Certificate(c.leafCert).subjectAltName).toContain('IP Address:10.1.1.1');
    expect(leafUsable(c.leafCert, c.caCert, ['10.1.1.1'])).toBe(true);
    expect(leafUsable(c.leafCert, c.caCert, ['10.9.9.9'])).toBe(false);
    // perto de vencer: renova
    const late = ensureCerts(dir, ['192.168.1.20', '10.1.1.1'], {restrict: false, now: Date.now() + 380 * DAY});
    expect(late.leafCert).not.toBe(c.leafCert);
  });
  it('chaves privadas ficam em arquivo 0600 (POSIX) e o resultado público não carrega a chave da CA', () => {
    const dir = tmp(), set = ensureCerts(dir, ['192.168.1.20'], {restrict: false});
    if (process.platform !== 'win32') for (const f of ['ca.key.pem', 'leaf.key.pem']) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'ca.key.pem'), 'utf8')).toContain('PRIVATE KEY');
    expect(Object.keys(set).sort()).toEqual(['caCert', 'caDer', 'created', 'leafCert', 'leafKey']);
    expect(set.caCert).not.toContain('PRIVATE KEY');
  });
  it('mobileconfig leva só o certificado público da CA', () => {
    const ca = createCa(), plist = mobileconfig(ca.der);
    expect(plist).toContain('com.apple.security.root');
    expect(plist).toContain(ca.der.toString('base64').slice(0, 40));
    expect(plist).not.toContain('PRIVATE KEY');
  });
});
