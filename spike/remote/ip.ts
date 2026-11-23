// Endereços e redes: só IPv4 privado (10/8, 172.16/12, 192.168/16) e loopback chegam ao servidor remoto, e só de interfaces da rede
// doméstica (Windows: categoria "Privada" e adaptador físico; outros sistemas: impressão digital da sub-rede). Sem Electron.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const octets = (ip: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n <= 255) ? parts : null;
};
/** Remove o prefixo IPv4-mapeado (::ffff:a.b.c.d) que o Node usa em sockets duplos. */
export const unmapIPv4 = (ip: string | undefined): string => (ip ?? '').replace(/^::ffff:/i, '');
export function isPrivateIPv4(ip: string): boolean {
  const o = octets(ip);
  if (!o) return false;
  const [a = 0, b = 0] = o;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export const isLoopback = (ip: string): boolean => { const o = octets(ip); return o !== null && o[0] === 127; };
/** Origem aceita: IPv4 privado ou loopback (IPv6 só o ::1). Qualquer outra coisa é recusada. */
export function isAllowedRemote(address: string | undefined): boolean {
  const ip = unmapIPv4(address);
  return ip === '::1' || isPrivateIPv4(ip) || isLoopback(ip);
}
const toInt = (ip: string): number | null => { const o = octets(ip); return o ? ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0 : null; };
/** `a` e `b` estão na mesma sub-rede segundo a máscara (ex.: 255.255.255.0)? Máscara inválida → false. */
export function sameSubnet(a: string, b: string, netmask: string): boolean {
  const x = toInt(a), y = toInt(b), m = toInt(netmask);
  if (x === null || y === null || m === null) return false;
  return ((x & m) >>> 0) === ((y & m) >>> 0);
}
/** Prefixo de 24 bits ("192.168.1.0/24") de um IPv4: é o que a restrição de nomes da CA usa. */
export const subnet24 = (ip: string): string | null => { const o = octets(ip); return o ? `${o[0]}.${o[1]}.${o[2]}.0/24` : null; };

/** Adaptadores virtuais ou de VPN (por nome), recusados por padrão. */
export const VIRTUAL_RE = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|Tailscale|ZeroTier|Hamachi|OpenVPN|TAP-|TAP |WireGuard|NordLynx|ProtonVPN|AnyConnect|Cisco|Local Area Connection\*|Bluetooth|Loopback)|^(br-|veth|virbr|utun|tun|tap|wg\d|ppp|vnet|lo$)/i;
export interface Iface { family: string | number; internal: boolean; address: string; netmask?: string; mac?: string }
export type IfaceSource = Record<string, readonly Iface[] | undefined>;
export interface Candidate { name: string; address: string; netmask: string }
function candidates(source: IfaceSource): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, list] of Object.entries(source)) for (const item of list ?? []) {
    if ((item.family !== 'IPv4' && item.family !== 4) || item.internal || !isPrivateIPv4(item.address)) continue;
    out.push({name, address: item.address, netmask: item.netmask && toInt(item.netmask) !== null ? item.netmask : '255.255.255.0'});
  }
  return out;
}

// --- Categoria de rede e adaptador físico (Windows) ---
export interface NetProfile { alias: string; name: string; category: 'private' | 'public' | 'domain' | 'unknown'; index: number | null }
export interface PhysicalAdapter { alias: string; index: number | null }
export interface NetProbe { profiles(): Promise<NetProfile[] | null>; physical(): Promise<PhysicalAdapter[] | null> }
const asList = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : typeof value === 'object' && value !== null ? [value as Record<string, unknown>] : [];
const parseJson = (text: string): unknown => { try { const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; return JSON.parse(clean.trim() || 'null'); } catch { return null; } };
const category = (v: unknown): NetProfile['category'] => v === 1 || (typeof v === 'string' && /^(1|private)$/i.test(v)) ? 'private' : v === 0 || (typeof v === 'string' && /^(0|public)$/i.test(v)) ? 'public' : v === 2 || (typeof v === 'string' && /^(2|domain)/i.test(v)) ? 'domain' : 'unknown';
const str = (v: unknown, max = 80) => typeof v === 'string' ? v.slice(0, max) : '';
const idx = (v: unknown) => typeof v === 'number' && Number.isInteger(v) ? v : null;
/** Saída do Get-NetConnectionProfile (JSON compacto, objeto único ou lista). Defensivo: lixo → null. */
export function parseProfiles(stdout: string): NetProfile[] | null {
  const json = parseJson(stdout);
  if (json === null || typeof json !== 'object') return null;
  return asList(json).map(row => ({alias: str(row.InterfaceAlias), name: str(row.Name), category: category(row.NetworkCategory), index: idx(row.InterfaceIndex)})).filter(p => p.alias || p.index !== null);
}
export function parsePhysical(stdout: string): PhysicalAdapter[] | null {
  const json = parseJson(stdout);
  if (json === null || typeof json !== 'object') return null;
  return asList(json).map(row => ({alias: str(row.Name), index: idx(row.InterfaceIndex)})).filter(p => p.alias || p.index !== null);
}
type Runner = (file: string, args: string[], options: {timeout: number; windowsHide: boolean; maxBuffer: number}, callback: (error: Error | null, stdout: string) => void) => unknown;
/** PowerShell com argumentos fixos (sem shell, sem entrada do usuário), 3 s de limite. */
export function powershell(command: string, run: Runner = execFile as unknown as Runner): Promise<string | null> {
  return new Promise(resolve => { try { run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {timeout: 3000, windowsHide: true, maxBuffer: 1 << 20}, (error, stdout) => resolve(error ? null : String(stdout))); } catch { resolve(null); } });
}
const PS_PROFILES = 'Get-NetConnectionProfile | Select-Object InterfaceIndex,InterfaceAlias,NetworkCategory,Name | ConvertTo-Json -Compress';
const PS_PHYSICAL = 'Get-NetAdapter -Physical | Select-Object InterfaceIndex,Name | ConvertTo-Json -Compress';
export const windowsProbe = (run?: Runner): NetProbe => ({
  profiles: async () => { const out = await powershell(PS_PROFILES, run); return out === null ? null : parseProfiles(out); },
  physical: async () => { const out = await powershell(PS_PHYSICAL, run); return out === null ? null : parsePhysical(out); },
});

export interface Bind { address: string; netmask: string; name: string }
export interface NetSelection {
  binds: Bind[]; subnets: string[]; /** pino: muda quando a rede doméstica muda */ pin: string; label: string; source: 'windows' | 'subnet'; error?: string;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cidrOf = (c: Candidate) => { const a = toInt(c.address)!, m = toInt(c.netmask)!; return `${[24, 16, 8, 0].map(s => ((a & m) >>> s) & 255).join('.')}/${m.toString(2).replace(/0/g, '').length}`; };
/**
 * Escolhe as interfaces onde o servidor pode escutar. Windows: só categoria Privada e adaptador físico (falha de PowerShell = nenhuma, nunca "libera tudo");
 * outros sistemas: IPv4 privado fora da lista de virtuais, com a impressão digital da sub-rede como pino.
 */
export async function discoverNetwork(options: {source?: IfaceSource; platform?: string; probe?: NetProbe} = {}): Promise<NetSelection> {
  const found = candidates(options.source ?? networkInterfaces() as IfaceSource);
  const platform = options.platform ?? process.platform;
  const finish = (picked: Candidate[], source: NetSelection['source'], names: string[], error?: string): NetSelection => {
    const cidrs = [...new Set(picked.map(cidrOf))].sort();
    return {binds: picked.map(c => ({address: c.address, netmask: c.netmask, name: c.name})), subnets: [...new Set(picked.map(c => subnet24(c.address)!))].sort(), pin: picked.length ? sha(`v1|${source}|${[...new Set(names)].sort().join(',')}|${cidrs.join(',')}`) : '', label: [...new Set(names)].sort().join(', ') || cidrs.join(', '), source, ...(error ? {error} : {})};
  };
  if (platform !== 'win32') { const picked = found.filter(c => !VIRTUAL_RE.test(c.name)); return finish(picked, 'subnet', []); }
  const probe = options.probe ?? windowsProbe();
  const [profiles, physical] = await Promise.all([probe.profiles(), probe.physical()]);
  if (!profiles) return finish([], 'windows', [], 'Não foi possível confirmar que a rede é Privada (PowerShell indisponível).');
  const isPhysical = (name: string) => physical === null ? true : physical.some(p => p.alias === name);
  const names: string[] = [], picked = found.filter(c => {
    const profile = profiles.find(p => p.alias === c.name);
    if (profile?.category !== 'private' || VIRTUAL_RE.test(c.name) || !isPhysical(c.name)) return false;
    names.push(profile.name || c.name); return true;
  });
  return finish(picked, 'windows', names);
}
/** Host do cabeçalho Host sem a porta (IPv4 ou nome); `null` se malformado. */
export function hostOnly(header: string | undefined): string | null {
  if (!header || header.length > 100) return null;
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(header);
  return m ? m[1]!.toLowerCase() : null;
}
