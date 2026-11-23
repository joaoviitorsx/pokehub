// Política de rede das sessões do jogo: só pokeidle.io, os provedores de login e os hosts aprovados das extensões carregadas.
// Qualquer outro host é registrado (modo 'registrar', padrão) ou cancelado (modo 'bloquear'). Sem banco: JSON em userData.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { domainToASCII } from 'node:url';
import type { NetworkMode, UnknownHost } from '../contracts/network';

/** Dados, não código: entradas exatas ou `*.dominio` (só subdomínios). Derivado do jogo e do login Google/Discord. */
export const BASE_HOSTS = [
  'pokeidle.io','*.pokeidle.io', // o jogo
  'accounts.google.com','accounts.youtube.com','ssl.gstatic.com','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com', // login Google
  'discord.com','cdn.discordapp.com','discordapp.com','static.discord.com', // login Discord
];
/** Esquemas sem host de rede que o Chromium usa por dentro; qualquer outro esquema é cancelado. */
const LOCAL_SCHEMES = ['chrome-extension:','devtools:','data:','blob:','about:','chrome-error:'];
const NET_SCHEMES = ['http:','https:','ws:','wss:'];
const MAX_ALLOWLIST = 200;
const MAX_UNKNOWN = 500;

/** minúsculas, sem ponto final, punycode; `*.dominio` mantém o curinga. null se não for um host válido. */
export function normalizeHost(value: string): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/\.$/,'');
  if (/[\s/\\:@?#%]/.test(text)) return null; // só host puro: sem caminho, porta, usuário nem espaço
  const wild = text.startsWith('*.');
  const ascii = domainToASCII(wild ? text.slice(2) : text);
  if (!ascii || ascii.length > 253 || !/^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/.test(ascii)) return null;
  if (wild && !ascii.includes('.')) return null; // `*.com` não
  return wild ? `*.${ascii}` : ascii;
}
export function hostMatches(host: string, entries: readonly string[]): boolean {
  return entries.some(entry => entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry);
}
export interface NetworkPolicy { mode: NetworkMode; allowlist: readonly string[] }
export type Decision = 'allow' | 'block' | 'record';
/** Função pura: libera esquemas internos, hosts da base, da allowlist do usuário e das extensões; o resto segue o modo. */
export function decide(url: string, policy: NetworkPolicy, approved: readonly string[] = []): Decision {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'block'; }
  if (LOCAL_SCHEMES.includes(parsed.protocol)) return 'allow';
  if (!NET_SCHEMES.includes(parsed.protocol)) return 'block';
  const host = normalizeHost(parsed.hostname.replace(/^\[|\]$/g,'')) ?? parsed.hostname.toLowerCase();
  if (hostMatches(host,BASE_HOSTS) || hostMatches(host,policy.allowlist) || hostMatches(host,approved.map(item => normalizeHost(item) ?? ''))) return 'allow';
  return policy.mode === 'bloquear' ? 'block' : 'record';
}
export const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase() || null; } catch { return null; } };

/** Preferência em `network-policy.json` (escrita atômica). Arquivo ausente/corrompido = padrão. */
export function createNetworkPolicyStore(file: string) {
  let state: {mode: NetworkMode; allowlist: string[]} = {mode:'registrar', allowlist:[]};
  try {
    const raw = JSON.parse(readFileSync(file,'utf8')) as {mode?: unknown; allowlist?: unknown};
    state = {
      mode: raw.mode === 'bloquear' ? 'bloquear' : 'registrar',
      allowlist: Array.isArray(raw.allowlist) ? [...new Set((raw.allowlist as unknown[]).flatMap(item => typeof item === 'string' ? normalizeHost(item) ?? [] : []))].slice(0,MAX_ALLOWLIST) : [],
    };
  } catch { /* primeira execução ou arquivo inválido */ }
  const save = () => {
    mkdirSync(dirname(file),{recursive:true});
    const tmp = `${file}.tmp`;
    writeFileSync(tmp,JSON.stringify({v:1,...state}));
    renameSync(tmp,file); // troca atômica: nunca fica um arquivo pela metade
  };
  return {
    policy: (): NetworkPolicy => state,
    setMode(mode: unknown) { if (mode !== 'registrar' && mode !== 'bloquear') throw new Error('modo inválido'); state = {...state,mode}; save(); },
    allow(host: unknown) {
      const entry = typeof host === 'string' ? normalizeHost(host) : null;
      if (!entry) throw new Error('host inválido');
      if (!state.allowlist.includes(entry)) { if (state.allowlist.length >= MAX_ALLOWLIST) throw new Error('lista cheia'); state = {...state,allowlist:[...state.allowlist,entry].sort()}; save(); }
      return entry;
    },
    disallow(host: unknown) { const entry = typeof host === 'string' ? normalizeHost(host) : null; state = {...state,allowlist:state.allowlist.filter(item => item !== entry)}; save(); },
  };
}

/** Hosts desconhecidos vistos por conta (só em memória, limitado). */
export function createUnknownLog(now: () => number = Date.now) {
  const rows = new Map<string, {host: string; account: string; count: number; firstSeen: number}>();
  return {
    record(account: string, host: string) {
      const key = `${account}\0${host}`, row = rows.get(key);
      if (row) row.count++;
      else if (rows.size < MAX_UNKNOWN) rows.set(key,{host,account,count:1,firstSeen:now()});
    },
    forget(entry: string) { for (const [key,row] of rows) if (hostMatches(row.host,[entry])) rows.delete(key); },
    list(name: (account: string) => string): UnknownHost[] { return [...rows.values()].sort((a,b) => b.count - a.count || a.host.localeCompare(b.host)).map(row => ({...row,accountName:name(row.account)})); },
  };
}
