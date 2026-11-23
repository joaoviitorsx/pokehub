// CA local própria + certificado do servidor (ECDSA P-256) gerados só com o `crypto` do Node: X.509/DER montado à mão (sem dependência).
// A CA tem restrição de nomes (só as sub-redes /24 fixadas, 127.0.0.1 e localhost; IPv6 excluído), então mesmo vazada reduz o risco: não serve para forjar sites da internet.
// As chaves ficam em userData/remote (0600; no Windows, ACL só do usuário), cifradas com o safeStorage do Electron quando disponível, e nunca são servidas.
import { X509Certificate, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { subnet24 } from './ip';

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

interface Issue { subjectCn: string; subjectKey: KeyObject; issuerCn: string; issuerKey: KeyObject; ca: boolean; from: Date; to: Date; ips?: readonly string[]; dns?: readonly string[]; subnets?: readonly string[] }
/** "192.168.1.0/24" → [IPv4, máscara]; só /8–/32 válidos. */
export function parseCidr(cidr: string): [string, string] | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!m || Number(m[2]) < 8 || Number(m[2]) > 32 || m[1]!.split('.').some(n => Number(n) > 255)) return null;
  const bits = Number(m[2]), mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return [m[1]!, [24, 16, 8, 0].map(s => (mask >>> s) & 255).join('.')];
}
function certificate(i: Issue): Buffer {
  const alg = seq(oid(OID.ecdsaSha256));
  const exts = [
    ext(OID.bc, true, seq(...(i.ca ? [bool(true), small(0)] : []))),
    ext(OID.ku, true, bits(Buffer.from([i.ca ? 0x06 : 0x80]), i.ca ? 1 : 7)), // CA: keyCertSign|cRLSign; folha: digitalSignature
    ext(OID.ski, false, octets(keyId(i.subjectKey))),
    ext(OID.aki, false, seq(tlv(0x80, keyId(i.issuerKey)))),
  ];
  if (i.ca) {
    // só as sub-redes fixadas (/24) + 127.0.0.1 + localhost; IPv6 inteiro excluído. Mesmo vazada, a CA não serve para sites da internet nem de outras redes.
    const ipRange = (ip: string, mask: string) => seq(tlv(0x87, Buffer.concat([ipBytes(ip), ipBytes(mask)])));
    const ranges = [...(i.subnets ?? []).flatMap(c => { const r = parseCidr(c); return r ? [ipRange(r[0], r[1])] : []; }), ipRange('127.0.0.1', '255.255.255.255')];
    const permitted = tlv(0xa0, ...ranges, seq(tlv(0x82, Buffer.from('localhost'))));
    const excluded = tlv(0xa1, seq(tlv(0x87, Buffer.alloc(32)))); // ::/0
    exts.push(ext(OID.nc, true, seq(permitted, excluded)));
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

/** Impressão digital SHA-256 da CA (hex minúsculo) e a forma legível: blocos de 4 em maiúsculas. */
export const caFingerprint = (der: Buffer): string => createHash('sha256').update(der).digest('hex');
export const formatFingerprint = (hex: string): string => (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
/** Cifra de chaves em repouso (Electron `safeStorage` no app; nos testes, uma cifra falsa). Sem ela as chaves ficam só protegidas pela permissão do arquivo. */
export interface SecretBox { encrypt(plain: string): Buffer; decrypt(data: Buffer): string }
const MAGIC = Buffer.from('PHENC1\n');
function sealKey(plain: string, box?: SecretBox): Buffer { return box ? Buffer.concat([MAGIC, box.encrypt(plain)]) : Buffer.from(plain, 'utf8'); }
/** Lê uma chave gravada; `null` se está cifrada e não dá para abrir (outro usuário/máquina) ou ilegível. `upgrade` = estava em texto e há cifra disponível. */
function openKey(file: string, box?: SecretBox): {pem: string; upgrade: boolean} | null {
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file);
    if (raw.subarray(0, MAGIC.length).equals(MAGIC)) return box ? {pem: box.decrypt(raw.subarray(MAGIC.length)), upgrade: false} : null;
    const text = raw.toString('utf8');
    return text.startsWith('-----BEGIN') ? {pem: text, upgrade: box !== undefined} : null;
  } catch { return null; }
}

export interface CertSet { caCert: string; caDer: Buffer; leafCert: string; leafKey: string }
export interface CertResult extends CertSet { created: boolean; caRegenerated: boolean; fingerprint: string; aclOk: boolean }
export function createCa(now = Date.now(), subnets: readonly string[] = []): {cert: string; key: string; der: Buffer} {
  const {privateKey, publicKey} = ec();
  const cn = `PokeHub Local CA ${randomBytes(4).toString('hex')}`;
  const der = certificate({subjectCn: cn, subjectKey: publicKey, issuerCn: cn, issuerKey: privateKey, ca: true, from: new Date(now - DAY), to: new Date(now + CA_DAYS * DAY), subnets});
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
/** SID do usuário atual (`whoami /user /fo csv`, sem shell); null se não deu. */
export function currentSid(run: (file: string, args: string[]) => string = (file, args) => execFileSync(file, args, {encoding: 'utf8', windowsHide: true, timeout: 5000})): string | null {
  try { return /S-1-\d+(?:-\d+)+/.exec(run('whoami', ['/user', '/fo', 'csv', '/nh']))?.[0] ?? null; } catch { return null; }
}
/** Restringe o diretório ao usuário atual: 0700 no POSIX; no Windows `icacls` com o SID (sem shell, argumentos fixos). Devolve false se não conseguiu (o status mostra o aviso). */
export function restrictPermissions(path: string, run: (file: string, args: string[]) => unknown = (file, args) => execFileSync(file, args, {stdio: 'ignore', windowsHide: true, timeout: 10_000}), sid: () => string | null = currentSid): boolean {
  try {
    if (process.platform === 'win32') {
      const id = sid();
      if (!id) return false;
      run('icacls', [path, '/inheritance:r', '/grant:r', `*${id}:(OI)(CI)F`]);
    } else chmodSync(path, 0o700);
    return true;
  } catch { return false; }
}
const KEY_MODE = {mode: 0o600};
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
/**
 * Garante CA e folha em `dir`. A CA é restrita às sub-redes fixadas (`subnets`, /24; por padrão as dos `ips`): se elas mudarem, a CA é REFEITA
 * (o usuário precisa reinstalar o certificado no celular: `caRegenerated`). A folha renova quando faltam IPs ou perto de vencer. Chaves cifradas com `box` quando há.
 */
export function ensureCerts(dir: string, ips: readonly string[], options: {now?: number; restrict?: boolean; box?: SecretBox; subnets?: readonly string[]} = {}): CertResult {
  const now = options.now ?? Date.now(), box = options.box;
  const subnets = [...new Set(options.subnets ?? ips.flatMap(ip => { const s = subnet24(ip); return s ? [s] : []; }))].sort();
  mkdirSync(dir, {recursive: true, mode: 0o700});
  const aclOk = options.restrict === false ? true : restrictPermissions(dir);
  const file = (n: string) => join(dir, n), text = (n: string) => existsSync(file(n)) ? readFileSync(file(n), 'utf8') : null;
  let caCert = text('ca.crt.pem'), created = false, caRegenerated = false;
  const caKeyFile = openKey(file('ca.key.pem'), box);
  let caKey = caKeyFile?.pem ?? null;
  const storedSubnets = (() => { try { const v: unknown = JSON.parse(text('ca.subnets.json') ?? 'null'); return Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : null; } catch { return null; } })();
  const caOk = (() => { try { return Boolean(caCert && caKey && storedSubnets && sameSet(storedSubnets, subnets) && new Date(new X509Certificate(caCert).validTo).getTime() - now > 90 * DAY && new X509Certificate(caCert).publicKey.equals(createPublicKey(createPrivateKey(caKey)))); } catch { return false; } })();
  const leafKeyFile = openKey(file('leaf.key.pem'), box);
  let leafCert = text('leaf.crt.pem'), leafKey = leafKeyFile?.pem ?? null;
  if (!caOk || !caCert || !caKey) {
    caRegenerated = caCert !== null && storedSubnets !== null && !sameSet(storedSubnets, subnets); // havia uma CA instalável e a sub-rede mudou
    const ca = createCa(now, subnets); caCert = ca.cert; caKey = ca.key; created = true;
    writeFileSync(file('ca.key.pem'), sealKey(caKey, box), KEY_MODE); writeFileSync(file('ca.crt.pem'), caCert); writeFileSync(file('ca.subnets.json'), JSON.stringify(subnets));
    leafCert = null;
  } else if (caKeyFile?.upgrade) writeFileSync(file('ca.key.pem'), sealKey(caKey, box), KEY_MODE); // chave antiga em texto: passa a cifrada
  if (!leafCert || !leafKey || !leafUsable(leafCert, caCert, ips, now)) {
    const leaf = createLeaf(caCert, caKey, ips, now); leafCert = leaf.cert; leafKey = leaf.key;
    writeFileSync(file('leaf.key.pem'), sealKey(leafKey, box), KEY_MODE); writeFileSync(file('leaf.crt.pem'), leafCert);
  } else if (leafKeyFile?.upgrade) writeFileSync(file('leaf.key.pem'), sealKey(leafKey, box), KEY_MODE);
  if (process.platform !== 'win32') for (const n of ['ca.key.pem', 'leaf.key.pem']) { try { chmodSync(file(n), 0o600); } catch { /* sem permissão para ajustar */ } }
  const caDer = new X509Certificate(caCert).raw;
  return {caCert, caDer, leafCert, leafKey, created, caRegenerated, fingerprint: caFingerprint(caDer), aclOk}; // a chave da CA nunca sai deste módulo
}
/** Perfil do iOS que instala a CA (o usuário ainda precisa ativar a confiança em Ajustes → Sobre → Confiança de certificados). A descrição traz a impressão digital para conferir com o PC. */
export function mobileconfig(caDer: Buffer): string {
  const b64 = caDer.toString('base64').replace(/(.{64})/g, '$1\n');
  const [a, b] = [randomUUID().toUpperCase(), randomUUID().toUpperCase()], fp = formatFingerprint(caFingerprint(caDer));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>PayloadContent</key><array><dict>\n<key>PayloadCertificateFileName</key><string>pokehub-ca.crt</string>\n<key>PayloadContent</key><data>\n${b64}\n</data>\n<key>PayloadDescription</key><string>Certificado local do PokeHub. Impressão digital SHA-256: ${fp}. Só instale se for igual à que o PC mostra.</string>\n<key>PayloadDisplayName</key><string>PokeHub CA</string>\n<key>PayloadIdentifier</key><string>local.pokehub.ca.cert</string>\n<key>PayloadType</key><string>com.apple.security.root</string>\n<key>PayloadUUID</key><string>${a}</string>\n<key>PayloadVersion</key><integer>1</integer>\n</dict></array>\n<key>PayloadDisplayName</key><string>PokeHub Acesso Remoto</string>\n<key>PayloadIdentifier</key><string>local.pokehub.ca</string>\n<key>PayloadRemovalDisallowed</key><false/>\n<key>PayloadType</key><string>Configuration</string>\n<key>PayloadUUID</key><string>${b}</string>\n<key>PayloadVersion</key><integer>1</integer>\n</dict></plist>\n`;
}
