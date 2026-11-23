// Valida, audita e localiza extensões de terceiros (/hunt, Smart Market...) na pasta do navegador do usuário.
// O PokéHub só carrega a pasta original; nunca copia nem altera o código de terceiros.
import * as nodeFs from 'node:fs';
import { posix, win32 } from 'node:path';
import type { AuditFinding, AuditResult, FindingKind } from '../contracts/extensions';

export const HUNT_ID = 'mhnplloljgchpfpcpbhmcokmnefodjnh';
export const SMART_MARKET_ID = 'lhfeijlnlbglakplddjgbaopgcdfkcmm';
// Extensões conhecidas: aparecem em "Detectar no navegador". Qualquer outra entra por "Adicionar pasta…".
// approvedHosts: sites externos pré-aprovados (só valem quando o id do catálogo bate).
export const CATALOG: {id: string; name: string; store: string; approvedHosts: string[]}[] = [
  {id:HUNT_ID, name:'/hunt for PokeIdle', store:`https://chromewebstore.google.com/detail/${HUNT_ID}`, approvedHosts:['pokeidleguide.io','pokeidle-gg.pages.dev']},
  {id:SMART_MARKET_ID, name:'Smart Market', store:`https://chromewebstore.google.com/detail/${SMART_MARKET_ID}`, approvedHosts:[]},
];
/** Hosts aprovados de uma extensão: os do catálogo (se o id for do catálogo) mais os que o usuário aprovou. */
export function approvedHostsOf(id: string, userApproved: readonly string[]): string[] {
  return [...new Set([...(CATALOG.find(entry => entry.id === id)?.approvedHosts ?? []),...userApproved])].sort();
}
/** A extensão só carrega se todos os hosts auditados estiverem aprovados; um host novo pede aprovação de novo. */
export function hostsCovered(hosts: readonly string[], approved: readonly string[]): boolean {
  return hosts.every(host => approved.includes(host));
}
const GAME = 'https://pokeidle.io/';
const MAX_MANIFEST_BYTES = 64 * 1024;
// Chaves que dariam à extensão alcance além dos content scripts do jogo (lista vazia é aceita).
const FORBIDDEN = ['background','optional_permissions','externally_connectable','chrome_url_overrides','devtools_page','declarative_net_request','chrome_settings_overrides','omnibox','side_panel','sandbox'];
const ALLOWED_PERMISSIONS = ['storage','unlimitedStorage'];
const REMOTE_CSP = /(?:https?|wss?):\/\/(?!pokeidle\.io(?:[/\s;:]|$))|\*/i;

export interface ExtFs {
  statSync(path: string): {isDirectory(): boolean; size: number};
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}
export type ExtensionCheck = {ok: true; name: string; version: string} | {ok: false; error: string};
export interface Machine { platform: string; home: string; localAppData?: string | undefined }

const pathFor = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? win32 : posix;
const fail = (error: string): ExtensionCheck => ({ok:false,error});
const inGame = (matches: unknown) => Array.isArray(matches) && matches.length > 0 && matches.every(match => typeof match === 'string' && match.startsWith(GAME));

export function checkExtension(dir: string, fs: ExtFs = nodeFs): ExtensionCheck {
  if (typeof dir !== 'string' || dir.length === 0 || dir.length > 4096 || !pathFor(dir).isAbsolute(dir)) return fail('O caminho da extensão precisa ser absoluto.');
  const p = pathFor(dir);
  let manifest: unknown;
  try {
    if (!fs.statSync(dir).isDirectory()) return fail('O caminho da extensão não é uma pasta.');
  } catch { return fail('A pasta da extensão não existe mais. Detecte novamente ou escolha a pasta.'); }
  try {
    const file = p.join(dir,'manifest.json');
    if (fs.statSync(file).size > MAX_MANIFEST_BYTES) return fail('O manifest.json da extensão é grande demais.');
    manifest = JSON.parse(fs.readFileSync(file,'utf8'));
  } catch { return fail('A pasta não contém um manifest.json legível. Escolha a pasta da versão da extensão.'); }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return fail('O manifest.json da extensão é inválido.');
  const m = manifest as Record<string, unknown>;
  if (m.manifest_version !== 3) return fail('A extensão precisa usar Manifest V3.');
  for (const key of FORBIDDEN) {
    const value = m[key];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) return fail(`A extensão declara “${key}”, que o PokéHub não permite. Só scripts de conteúdo do pokeidle.io são aceitos.`);
  }
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) return fail('O manifest.json da extensão é inválido.');
    const extra = (m.permissions as unknown[]).find(permission => typeof permission !== 'string' || !ALLOWED_PERMISSIONS.includes(permission));
    if (extra !== undefined) return fail(`A extensão pede a permissão “${String(extra)}”, que o PokéHub não permite. Só ${ALLOWED_PERMISSIONS.join(' e ')} são aceitas.`);
  }
  for (const key of ['host_permissions','optional_host_permissions']) {
    const value = m[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return fail('O manifest.json da extensão é inválido.');
    const extra = (value as unknown[]).find(host => typeof host !== 'string' || !host.startsWith(GAME));
    if (extra !== undefined) return fail(`A extensão pede acesso a “${String(extra)}” em “${key}”. Só https://pokeidle.io/ é aceito.`);
  }
  if (m.content_security_policy !== undefined && REMOTE_CSP.test(JSON.stringify(m.content_security_policy))) return fail('A extensão declara “content_security_policy” com origens remotas, que o PokéHub não permite.');
  const scripts = m.content_scripts;
  if (!Array.isArray(scripts) || scripts.length === 0) return fail('A extensão não tem scripts de conteúdo para o jogo.');
  for (const script of scripts as unknown[]) {
    if (typeof script !== 'object' || script === null || !inGame((script as Record<string, unknown>).matches)) return fail('A extensão tem scripts que rodam fora de https://pokeidle.io/.');
  }
  const resources = m.web_accessible_resources;
  if (resources !== undefined) {
    if (!Array.isArray(resources)) return fail('O manifest.json da extensão é inválido.');
    for (const entry of resources as unknown[]) {
      const item = entry as Record<string, unknown> | null;
      if (typeof item !== 'object' || item === null || item.extension_ids !== undefined || !inGame(item.matches)) return fail('A extensão expõe arquivos para sites fora de https://pokeidle.io/.');
    }
  }
  if (typeof m.name !== 'string' || typeof m.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(m.version)) return fail('O manifest.json da extensão não informa nome e versão válidos.');
  return {ok:true, name:m.name.slice(0,80), version:m.version};
}

// Pastas de versão do Chrome: "1.0.17_0". Compara cada parte como número (1.0.9 < 1.0.17).
function versionParts(name: string): number[] | null {
  return /^\d+(\.\d+){0,3}_\d+$/.test(name) ? name.split(/[._]/).map(Number) : null;
}
function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length,b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d !== 0) return d; }
  return 0;
}
/** Maior versão VÁLIDA dentro de `<perfil>/Extensions/<id>`. */
export function latestVersion(idDir: string, fs: ExtFs = nodeFs): {path: string; parts: number[]} | null {
  let names: string[];
  try { names = fs.readdirSync(idDir); } catch { return null; }
  let best: {path: string; parts: number[]} | null = null;
  for (const name of names) {
    const parts = versionParts(name);
    if (!parts || (best && compareParts(parts,best.parts) <= 0)) continue;
    const path = pathFor(idDir).join(idDir,name);
    if (checkExtension(path,fs).ok) best = {path,parts};
  }
  return best;
}

export function browserRoots(machine: Machine): string[] {
  if (machine.platform === 'win32') {
    const base = machine.localAppData || win32.join(machine.home,'AppData','Local');
    return [['Google','Chrome'],['Microsoft','Edge'],['BraveSoftware','Brave-Browser']].map(parts => win32.join(base,...parts,'User Data'));
  }
  return ['.config/google-chrome','.config/chromium','.var/app/com.google.Chrome/config/google-chrome','.config/BraveSoftware/Brave-Browser','.config/microsoft-edge'].map(rel => posix.join(machine.home,rel));
}

/** Maior versão válida de cada extensão do catálogo, em qualquer navegador/perfil conhecido. */
export function findInstalled(machine: Machine, fs: ExtFs = nodeFs): {id: string; path: string}[] {
  const best = new Map<string, {path: string; parts: number[]}>();
  for (const root of browserRoots(machine)) {
    let profiles: string[];
    try { profiles = fs.readdirSync(root); } catch { continue; }
    for (const profile of profiles) {
      if (profile !== 'Default' && !profile.startsWith('Profile ')) continue;
      for (const {id} of CATALOG) {
        const found = latestVersion(pathFor(root).join(root,profile,'Extensions',id),fs);
        const current = best.get(id);
        if (found && (!current || compareParts(found.parts,current.parts) > 0)) best.set(id,found);
      }
    }
  }
  return CATALOG.flatMap(({id}) => { const found = best.get(id); return found ? [{id,path:found.path}] : []; });
}

/** Id do catálogo a que a pasta pertence (`.../Extensions/<id>/<versão>`), ou null. */
export function catalogIdOf(path: string): string | null {
  const p = pathFor(path);
  const id = p.basename(p.dirname(path));
  return CATALOG.some(entry => entry.id === id) ? id : null;
}

/** O Chrome apaga a pasta da versão antiga ao atualizar: troca o caminho salvo pela maior versão irmã. */
export function resolveExtensionPath(saved: string, fs: ExtFs = nodeFs): string {
  try { if (fs.statSync(saved).isDirectory()) return saved; } catch { /* sumiu: procurar irmã */ }
  return catalogIdOf(saved) !== null ? latestVersion(pathFor(saved).dirname(saved),fs)?.path ?? saved : saved;
}

// Auditoria estática (nada é executado): lê os .js da extensão e relata o que eles fazem com a página e a rede.
const AUDIT_TOTAL_BYTES = 8 * 1024 * 1024;
const AUDIT_FILE_BYTES = 2 * 1024 * 1024;
const AUDIT_DEPTH = 6;
// Links de divulgação/doação/namespace: só contam como rede se estiverem dentro de uma chamada de rede.
const LINK_HOSTS = ['chromewebstore.google.com','chrome.google.com','github.com','livepix.gg','www.w3.org','w3.org','developer.mozilla.org','ko-fi.com','buymeacoffee.com','discord.gg'];
const URL_RE = /\b(?:https?|wss?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi;
const CALL_BEFORE_RE = /(?:fetch|WebSocket|EventSource|sendBeacon|importScripts|\bopen|\bimport)\s*\(\s*[^()]*$/;
// Chamada de rede cujo endereço não é um literal (fetch(url), new WebSocket(base + x)): os endereços escritos como texto no
// mesmo arquivo (listas, constantes) passam a contar como rede, porque podem ser os usados na chamada.
const DYNAMIC_CALL_RE = /(?:(?<![\w$.])fetch|new\s+WebSocket|new\s+EventSource|\bsendBeacon)\s*\(\s*(?!['"`\s])|\.open\s*\(\s*['"][A-Za-z]+['"]\s*,\s*(?!['"`\s])/;
const PATTERNS: {kind: FindingKind; api: string; re: RegExp}[] = [
  {kind:'eval', api:'eval()', re:/(?<![\w$.])eval\s*\(/g},
  {kind:'eval', api:'new Function()', re:/new\s+Function\s*\(/g},
  {kind:'click', api:'.click()', re:/\.click\s*\(/g},
  {kind:'dispatch', api:'dispatchEvent()', re:/\.dispatchEvent\s*\(/g},
  {kind:'send', api:'.send()', re:/\.send\s*\(/g},
  {kind:'fetch', api:'fetch()', re:/(?<![\w$])fetch\s*\(/g},
  {kind:'fetch', api:'XMLHttpRequest', re:/\bXMLHttpRequest\b/g},
  {kind:'fetch', api:'new WebSocket()', re:/new\s+WebSocket\s*\(/g},
  {kind:'fetch', api:'navigator.sendBeacon()', re:/\bsendBeacon\s*\(/g},
];
/**
 * Remove comentários de linha e de bloco sem tocar no texto de strings ('...', "...", `...`): `https://` dentro de string fica.
 * `//` só inicia comentário no começo do arquivo/linha ou depois de espaço, `;`, `{` ou `}`. Regex literais não são entendidos.
 */
export function stripComments(text: string): string {
  let out = '', i = 0, quote = '';
  while (i < text.length) {
    const c = text[i] ?? '', next = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && next !== undefined) { out += next; i += 2; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '*') { const end = text.indexOf('*/',i + 2); out += ' '; i = end < 0 ? text.length : end + 2; continue; }
    if (c === '/' && next === '/' && (i === 0 || /[\s;{}]/.test(text[i - 1] ?? ''))) { const end = text.indexOf('\n',i); i = end < 0 ? text.length : end; continue; }
    out += c; i++;
  }
  return out;
}
const TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__)\//i;
const TEST_FILE_RE = /\.(?:test|spec)\.(?:m?js|cjs)$/i;
function jsFiles(dir: string, fs: ExtFs, depth = 0, out: string[] = []): string[] {
  if (depth > AUDIT_DEPTH) return out;
  let names: string[];
  try { names = fs.readdirSync(dir).slice().sort(); } catch { return out; }
  for (const name of names) {
    const path = pathFor(dir).join(dir,name);
    try {
      if (fs.statSync(path).isDirectory()) jsFiles(path,fs,depth + 1,out);
      else if (/\.(?:m?js|cjs)$/i.test(name)) out.push(path);
    } catch { /* ilegível: ignorado */ }
  }
  return out;
}
/**
 * Veredito pelo que o código faz, sem executá-lo, em ordem crescente: 'leitura'; 'interage' (clica, dispara eventos ou
 * envia pelo socket); 'externa' (chama a rede para hosts fora do pokeidle.io: precisa de aprovação dos hosts);
 * 'bloqueada' (eval/new Function ou arquivo grande demais para auditar). Comentários, arquivos de teste e endereços
 * escritos como texto fora de chamadas de rede só geram 'link'.
 */
export function auditExtension(dir: string, fs: ExtFs = nodeFs): AuditResult {
  const found = new Map<string, {finding: AuditFinding; count: number}>();
  const add = (kind: FindingKind, file: string, detail: string) => {
    const key = `${kind}\0${file}\0${detail}`; const entry = found.get(key);
    if (entry) entry.count++; else found.set(key,{finding:{kind,file,detail},count:1});
  };
  let total = 0;
  for (const path of jsFiles(dir,fs)) {
    const file = path.slice(dir.length).replace(/^[\\/]+/,'').replace(/\\/g,'/');
    if (TEST_DIR_RE.test(file) || TEST_FILE_RE.test(file)) continue;
    let raw: string;
    try {
      const size = fs.statSync(path).size;
      if (size > AUDIT_FILE_BYTES || total + size > AUDIT_TOTAL_BYTES) { add('skipped',file,'arquivo grande demais para auditar'); continue; }
      total += size; raw = fs.readFileSync(path,'utf8');
    } catch { add('skipped',file,'arquivo ilegível'); continue; }
    const text = stripComments(raw);
    const dynamic = DYNAMIC_CALL_RE.test(text);
    for (const {kind,api,re} of PATTERNS) for (const _ of text.matchAll(re)) add(kind,file,api); // eslint-disable-line @typescript-eslint/no-unused-vars
    for (const match of text.matchAll(URL_RE)) {
      const host = (match[1] ?? '').toLowerCase();
      if (host === 'pokeidle.io') continue;
      const inCall = CALL_BEFORE_RE.test(text.slice(Math.max(0,match.index - 120),match.index));
      add(inCall || (dynamic && !LINK_HOSTS.includes(host)) ? 'network' : 'link',file,host);
    }
  }
  const findings = [...found.values()].map(({finding,count}) => count > 1 && finding.kind !== 'network' && finding.kind !== 'link' ? {...finding,detail:`${finding.detail} (${count}×)`} : finding);
  const has = (...kinds: FindingKind[]) => findings.some(finding => kinds.includes(finding.kind));
  const hosts = [...new Set(findings.filter(finding => finding.kind === 'network').map(finding => finding.detail))].sort();
  return {verdict: has('eval','skipped') ? 'bloqueada' : has('network') ? 'externa' : has('click','dispatch','send') ? 'interage' : 'leitura', findings, hosts};
}
