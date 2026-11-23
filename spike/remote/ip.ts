// Endereços: só IPv4 privado (10/8, 172.16/12, 192.168/16) e loopback chegam ao servidor remoto. Puro, sem I/O.
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
const VIRTUAL = /^(vEthernet|VirtualBox|VMware|docker|br-|veth|virbr|WSL|Hyper-V|Tailscale|ZeroTier|utun|tun|tap)/i;
interface Iface { family: string | number; internal: boolean; address: string }
/** IPv4 privados da máquina (adaptadores reais primeiro, virtuais depois). */
export function lanAddresses(source: Record<string, readonly Iface[] | undefined> = networkInterfaces() as Record<string, readonly Iface[] | undefined>): string[] {
  const real: string[] = [], virtual: string[] = [];
  for (const [name, list] of Object.entries(source)) for (const item of list ?? []) {
    if ((item.family !== 'IPv4' && item.family !== 4) || item.internal || !isPrivateIPv4(item.address)) continue;
    (VIRTUAL.test(name) ? virtual : real).push(item.address);
  }
  return [...new Set([...real, ...virtual])];
}
/** Host do cabeçalho Host sem a porta (IPv4 ou nome); `null` se malformado. */
export function hostOnly(header: string | undefined): string | null {
  if (!header || header.length > 100) return null;
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(header);
  return m ? m[1]!.toLowerCase() : null;
}
