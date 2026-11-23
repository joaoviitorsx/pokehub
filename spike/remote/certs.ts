// CA local própria + certificado do servidor (ECDSA P-256) gerados só com o `crypto` do Node: X.509/DER montado à mão
// (sem dependência). A CA tem restrição de nomes (só IPs privados e localhost), então mesmo vazada não serve para
// forjar sites da internet. As chaves ficam em userData/remote (0600; no Windows, ACL só do usuário) e nunca são servidas.
import { X509Certificate, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DAY = 86_400_000;
export const LEAF_DAYS = 397, CA_DAYS = 3650, RENEW_BEFORE_DAYS = 30;
// --- DER ---
const len = (n: number) => n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
const tlv = (tag: number, ...parts: Buffer[]) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p: Buffer[]) => tlv(0x30, ...p);
const set = (...p: Buffer[]) => tlv(0x31, ...p);
const octets = (b: Buffer) => tlv(0x04, b);
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const int = (b: Buffer) => { let x = b; while (x.length > 1 && x[0] === 0 && (x[1]! & 0x80) === 0) x = x.subarray(1); return tlv(0x02, x[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), x]) : x); };
const small = (n: number) => int(Buffer.from([n]));
const bits = (b: Buffer, unused = 0) => tlv(0x03, Buffer.from([unused]), b);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const base128 = (n: number) => { const out = [n & 127]; for (n >>= 7; n > 0; n >>= 7) out.unshift((n & 127) | 128); return out; };
const oid = (s: string) => { const p = s.split('.').map(Number); return tlv(0x06, Buffer.from([p[0]! * 40 + p[1]!, ...p.slice(2).flatMap(base128)])); };
const pad = (n: number) => String(n).padStart(2, '0');
const time = (d: Date) => { const y = d.getUTCFullYear(); const rest = `${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; return y < 2050 ? tlv(0x17, Buffer.from(`${String(y).slice(2)}${rest}`)) : tlv(0x18, Buffer.from(`${y}${rest}`)); };
const OID = {cn: '2.5.4.3', org: '2.5.4.10', ecdsaSha256: '1.2.840.10045.4.3.2', ski: '2.5.29.14', ku: '2.5.29.15', san: '2.5.29.17', bc: '2.5.29.19', nc: '2.5.29.30', aki: '2.5.29.35', eku: '2.5.29.37', serverAuth: '1.3.6.1.5.5.7.3.1'};
const name = (cn: string) => seq(set(seq(oid(OID.org), utf8('PokeHub'))), set(seq(oid(OID.cn), utf8(cn))));
const ext = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const ipBytes = (ip: string) => Buffer.from(ip.split('.').map(Number));
const spkiOf = (key: KeyObject) => (key.type === 'public' ? key : createPublicKey(key)).export({type: 'spki', format: 'der'});
const keyId = (key: KeyObject) => createHash('sha1').update(spkiOf(key).subarray(-65)).digest(); // ponto EC não comprimido

interface Issue { subjectCn: string; subjectKey: KeyObject; issuerCn: string; issuerKey: KeyObject; ca: boolean; from: Date; to: Date; ips?: readonly string[]; dns?: readonly string[] }
function certificate(i: Issue): Buffer {
  const alg = seq(oid(OID.ecdsaSha256));
  const exts = [
    ext(OID.bc, true, seq(...(i.ca ? [bool(true), small(0)] : []))),
    ext(OID.ku, true, bits(Buffer.from([i.ca ? 0x06 : 0x80]), i.ca ? 1 : 7)), // CA: keyCertSign|cRLSign; folha: digitalSignature
    ext(OID.ski, false, octets(keyId(i.subjectKey))),
    ext(OID.aki, false, seq(tlv(0x80, keyId(i.issuerKey)))),
  ];
  if (i.ca) {
    const ipRange = (ip: string, mask: string) => seq(tlv(0x87, Buffer.concat([ipBytes(ip), ipBytes(mask)])));
    const permitted = tlv(0xa0, ipRange('10.0.0.0', '255.0.0.0'), ipRange('172.16.0.0', '255.240.0.0'), ipRange('192.168.0.0', '255.255.0.0'), ipRange('127.0.0.0', '255.0.0.0'), seq(tlv(0x82, Buffer.from('localhost'))));
    exts.push(ext(OID.nc, true, seq(permitted)));
  } else {
    exts.push(ext(OID.eku, false, seq(oid(OID.serverAuth))));
    exts.push(ext(OID.san, false, seq(...(i.ips ?? []).map(ip => tlv(0x87, ipBytes(ip))), ...(i.dns ?? []).map(d => tlv(0x82, Buffer.from(d))))));
  }
  const tbs = seq(tlv(0xa0, small(2)), int(randomBytes(16)), alg, name(i.issuerCn), seq(time(i.from), time(i.to)), name(i.subjectCn), spkiOf(i.subjectKey), tlv(0xa3, seq(...exts)));
  const signature = sign('sha256', tbs, {key: i.issuerKey, dsaEncoding: 'der'});
  return seq(tbs, alg, bits(signature));
}
const pem = (der: Buffer, label = 'CERTIFICATE') => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`;
const ec = () => generateKeyPairSync('ec', {namedCurve: 'prime256v1'});

export interface CertSet { caCert: string; caDer: Buffer; leafCert: string; leafKey: string }
export function createCa(now = Date.now()): {cert: string; key: string; der: Buffer} {
  const {privateKey, publicKey} = ec();
  const cn = `PokeHub Local CA ${randomBytes(4).toString('hex')}`;
  const der = certificate({subjectCn: cn, subjectKey: publicKey, issuerCn: cn, issuerKey: privateKey, ca: true, from: new Date(now - DAY), to: new Date(now + CA_DAYS * DAY)});
  return {cert: pem(der), key: privateKey.export({type: 'pkcs8', format: 'pem'}) as string, der};
}
export function createLeaf(caCert: string, caKey: string, ips: readonly string[], now = Date.now()): {cert: string; key: string} {
  const {privateKey, publicKey} = ec();
  const issuerCn = /CN=(.+)$/m.exec(new X509Certificate(caCert).subject)?.[1] ?? 'PokeHub Local CA';
  const der = certificate({subjectCn: 'PokeHub Remoto', subjectKey: publicKey, issuerCn, issuerKey: createPrivateKey(caKey), ca: false, from: new Date(now - DAY), to: new Date(now + LEAF_DAYS * DAY), ips: [...new Set([...ips, '127.0.0.1'])], dns: ['localhost']});
  return {cert: pem(der), key: privateKey.export({type: 'pkcs8', format: 'pem'}) as string};
}
/** A folha atual serve? Emitida pela CA, com todos os IPs no SAN e mais de 30 dias de validade. */
export function leafUsable(leafPem: string, caPem: string, ips: readonly string[], now = Date.now()): boolean {
  try {
    const leaf = new X509Certificate(leafPem), ca = new X509Certificate(caPem);
    return leaf.checkIssued(ca) && leaf.verify(ca.publicKey) && new Date(leaf.validTo).getTime() - now > RENEW_BEFORE_DAYS * DAY && new Date(leaf.validFrom).getTime() <= now && ['127.0.0.1', ...ips].every(ip => leaf.checkIP(ip) !== undefined);
  } catch { return false; }
}
/** Restringe o diretório ao usuário atual: 0700 no POSIX; no Windows `icacls` (sem shell, argumentos fixos). Devolve false se não conseguiu. */
export function restrictPermissions(path: string): boolean {
  try {
    if (process.platform === 'win32') {
      const user = process.env.USERNAME;
      if (!user || /[^\w .-]/.test(user)) return false;
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], {stdio: 'ignore', windowsHide: true});
    } else chmodSync(path, 0o700);
    return true;
  } catch { return false; }
}
const KEY_MODE = {mode: 0o600};
/** Garante CA e folha em `dir`: gera na primeira vez e renova a folha quando faltam IPs ou ela está perto de vencer. A CA só é refeita se sumir ou estiver vencendo. */
export function ensureCerts(dir: string, ips: readonly string[], options: {now?: number; restrict?: boolean} = {}): CertSet & {created: boolean} {
  const now = options.now ?? Date.now();
  mkdirSync(dir, {recursive: true, mode: 0o700});
  if (options.restrict !== false) restrictPermissions(dir);
  const file = (n: string) => join(dir, n), read = (n: string) => existsSync(file(n)) ? readFileSync(file(n), 'utf8') : null;
  let caCert = read('ca.crt.pem'), caKey = read('ca.key.pem'), created = false;
  const caOk = (() => { try { return Boolean(caCert && caKey && new Date(new X509Certificate(caCert).validTo).getTime() - now > 90 * DAY && new X509Certificate(caCert).publicKey.equals(createPublicKey(createPrivateKey(caKey)))); } catch { return false; } })();
  let leafCert = read('leaf.crt.pem'), leafKey = read('leaf.key.pem');
  if (!caOk || !caCert || !caKey) {
    const ca = createCa(now); caCert = ca.cert; caKey = ca.key; created = true;
    writeFileSync(file('ca.key.pem'), caKey, KEY_MODE); writeFileSync(file('ca.crt.pem'), caCert);
    leafCert = null;
  }
  if (!leafCert || !leafKey || !leafUsable(leafCert, caCert, ips, now)) {
    const leaf = createLeaf(caCert, caKey, ips, now); leafCert = leaf.cert; leafKey = leaf.key;
    writeFileSync(file('leaf.key.pem'), leafKey, KEY_MODE); writeFileSync(file('leaf.crt.pem'), leafCert);
  }
  if (process.platform !== 'win32') for (const n of ['ca.key.pem', 'leaf.key.pem']) { try { chmodSync(file(n), 0o600); } catch { /* sem permissão para ajustar */ } }
  return {caCert, caDer: new X509Certificate(caCert).raw, leafCert, leafKey, created}; // a chave da CA nunca sai deste módulo
}
/** Perfil do iOS que instala a CA (o usuário ainda precisa ativar a confiança em Ajustes → Sobre → Confiança de certificados). */
export function mobileconfig(caDer: Buffer): string {
  const b64 = caDer.toString('base64').replace(/(.{64})/g, '$1\n');
  const [a, b] = [randomUUID().toUpperCase(), randomUUID().toUpperCase()];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>PayloadContent</key><array><dict>\n<key>PayloadCertificateFileName</key><string>pokehub-ca.crt</string>\n<key>PayloadContent</key><data>\n${b64}\n</data>\n<key>PayloadDescription</key><string>Certificado local do PokeHub (acesso remoto na sua rede)</string>\n<key>PayloadDisplayName</key><string>PokeHub CA</string>\n<key>PayloadIdentifier</key><string>local.pokehub.ca.cert</string>\n<key>PayloadType</key><string>com.apple.security.root</string>\n<key>PayloadUUID</key><string>${a}</string>\n<key>PayloadVersion</key><integer>1</integer>\n</dict></array>\n<key>PayloadDisplayName</key><string>PokeHub Acesso Remoto</string>\n<key>PayloadIdentifier</key><string>local.pokehub.ca</string>\n<key>PayloadRemovalDisallowed</key><false/>\n<key>PayloadType</key><string>Configuration</string>\n<key>PayloadUUID</key><string>${b}</string>\n<key>PayloadVersion</key><integer>1</integer>\n</dict></plist>\n`;
}
