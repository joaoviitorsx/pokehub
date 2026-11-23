// Valida, audita e localiza extensões de terceiros (/hunt, Smart Market...) na pasta do navegador do usuário.
// O PokéHub só carrega a pasta original; nunca copia nem altera o código de terceiros.
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeFsp from 'node:fs/promises';
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

export interface StatLike {isDirectory(): boolean; isSymbolicLink?(): boolean; size: number; mtimeMs?: number; ctimeMs?: number; ino?: number}
export interface ExtFs {
  statSync(path: string): StatLike;
  lstatSync?(path: string): StatLike; // sem ele (fs falso) nada é tratado como link
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
  realpathSync?(path: string): string;
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

/** Id da pasta `.../Extensions/<id>/<versão>` pelo texto do caminho (só para achar a versão irmã; não concede nada). */
function catalogFolderId(path: string): string | null {
  const p = pathFor(path);
  const id = p.basename(p.dirname(path));
  return CATALOG.some(entry => entry.id === id) ? id : null;
}
/**
 * Id do catálogo a que a pasta pertence, ou null. Só vale se o caminho REAL (links resolvidos) estiver em
 * `<pasta de navegador>/<Default|Profile N>/Extensions/<id>/<versão>`: o nome da pasta sozinho não dá privilégio nenhum.
 */
export function catalogIdOf(path: string, machine: Machine, fs: ExtFs = nodeFs): string | null {
  const wanted = catalogFolderId(path);
  if (!wanted || !fs.realpathSync) return null;
  try {
    const real = fs.realpathSync(path), p = pathFor(real);
    for (const root of browserRoots(machine)) {
      let realRoot: string;
      try { realRoot = fs.realpathSync(root); } catch { continue; }
      if (pathFor(realRoot) !== p) continue;
      const rel = p.relative(realRoot,real);
      if (!rel || p.isAbsolute(rel)) continue;
      const [profile,folder,id,version,...rest] = rel.split(/[\\/]/);
      if (rest.length === 0 && version && id === wanted && folder === 'Extensions' && (profile === 'Default' || /^Profile \d+$/.test(profile ?? ''))) return id;
    }
  } catch { /* caminho que não resolve: sem privilégios */ }
  return null;
}

/** O Chrome apaga a pasta da versão antiga ao atualizar: troca o caminho salvo pela maior versão irmã. */
export function resolveExtensionPath(saved: string, fs: ExtFs = nodeFs): string {
  try { if (fs.statSync(saved).isDirectory()) return saved; } catch { /* sumiu: procurar irmã */ }
  return catalogFolderId(saved) !== null ? latestVersion(pathFor(saved).dirname(saved),fs)?.path ?? saved : saved;
}

// Auditoria estática (nada é executado): lê os .js/.css da extensão e relata o que eles fazem com a página e a rede.
// Heurística: confira a origem da extensão. Qualquer coisa que a auditoria não consiga ler/entender vira 'skipped' (bloqueada).
const AUDIT_TOTAL_BYTES = 8 * 1024 * 1024;
const AUDIT_FILE_BYTES = 2 * 1024 * 1024;
const AUDIT_DEPTH = 6;
const AUDIT_ENTRIES = 2000;
// Links de divulgação/doação/namespace: só contam como rede se estiverem dentro de uma chamada de rede.
const LINK_HOSTS = ['chromewebstore.google.com','chrome.google.com','github.com','livepix.gg','www.w3.org','w3.org','developer.mozilla.org','ko-fi.com','buymeacoffee.com','discord.gg'];
const URL_RE = /\b(?:https?|wss?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi;
const CALL_BEFORE_RE = /(?:fetch|WebSocket|EventSource|sendBeacon|importScripts|\bopen|\bimport|\bImage)\s*\(\s*[^()]*$|\.src\s*=\s*['"`]?$/;
// Chamada de rede cujo endereço não é um literal (fetch(url), new WebSocket(base + x), img.src = url, import(x), window['fetch']):
// os endereços escritos como texto no mesmo arquivo (listas, constantes) passam a contar como rede, porque podem ser os usados.
const DYNAMIC_CALL_RE = /(?:(?<![\w$.])fetch|new\s+WebSocket|new\s+EventSource|\bsendBeacon|(?<![\w$.])import)\s*\(\s*(?!['"`\s])|\.open\s*\(\s*['"][A-Za-z]+['"]\s*,\s*(?!['"`\s])|\.src\s*=(?!=)\s*(?!['"`\s])|\[\s*['"`](?:fetch|XMLHttpRequest|WebSocket|sendBeacon)['"`]\s*\]/;
const PATTERNS: {kind: FindingKind; api: string; re: RegExp}[] = [
  {kind:'eval', api:'eval()', re:/(?<![\w$.])eval\s*\(/g},
  {kind:'eval', api:'new Function()', re:/new\s+Function\s*\(/g},
  {kind:'eval', api:'setTimeout/setInterval com texto', re:/(?<![\w$.])(?:setTimeout|setInterval)\s*\(\s*['"`]/g},
  {kind:'eval', api:'.constructor()', re:/(?<!\bthis)\.constructor\s*\(/g},
  {kind:'click', api:'.click()', re:/\.click\s*\(/g},
  {kind:'dispatch', api:'dispatchEvent()', re:/\.dispatchEvent\s*\(/g},
  {kind:'send', api:'.send()', re:/\.send\s*\(/g},
  {kind:'fetch', api:'fetch()', re:/(?<![\w$])fetch\s*\(/g},
  {kind:'fetch', api:'XMLHttpRequest', re:/\bXMLHttpRequest\b/g},
  {kind:'fetch', api:'new WebSocket()', re:/new\s+WebSocket\s*\(/g},
  {kind:'fetch', api:'navigator.sendBeacon()', re:/\bsendBeacon\s*\(/g},
  {kind:'fetch', api:'new Image()', re:/new\s+Image\s*\(/g},
  {kind:'fetch', api:'.src =', re:/\.src\s*=(?!=)/g},
  {kind:'fetch', api:'import()', re:/(?<![\w$.])import\s*\(/g},
  {kind:'fetch', api:"acesso por colchetes (['fetch'])", re:/\[\s*['"`](?:fetch|XMLHttpRequest|WebSocket|sendBeacon)['"`]\s*\]/g},
  {kind:'obfuscation', api:'ofuscação: atob()', re:/(?<![\w$.])atob\s*\(/g},
  {kind:'obfuscation', api:'ofuscação: fromCharCode', re:/\bfromCharCode\b/g},
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
// CSS: `url(http://x)`, `url(//x)` e `@import "http://x"` puxam recursos de fora.
const CSS_URL_RE = /(?:url\(\s*|@import\s+(?:url\(\s*)?)['"]?\s*((?:https?:)?\/\/[^'")\s;]+)/gi;
function cssHost(value: string): string {
  const authority = value.replace(/^(?:https?:)?\/\//i,'').split(/[/?#]/)[0] ?? '';
  return (authority.split('@').pop() ?? '').replace(/:\d+$/,'').toLowerCase();
}
const TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__)\//i;
const TEST_FILE_RE = /\.(?:test|spec)\.(?:m?js|cjs)$/i;
const isTestFile = (file: string) => TEST_DIR_RE.test(file) || TEST_FILE_RE.test(file);
const isJs = (file: string) => /\.(?:m?js|cjs)$/i.test(file);
const isCss = (file: string) => /\.css$/i.test(file);
// Arquivos de mídia inertes que uma extensão pode expor (web_accessible_resources). html/svg/wasm/xml e o resto não: viram 'skipped'.
const MEDIA_RE = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|ogg|wav|json)$/i;

// O mesmo algoritmo roda síncrono (ExtFs) e assíncrono (AsyncExtFs): ele pede operações de disco e o "motor" as executa.
type Op = {op: 'lstat' | 'read' | 'readdir'; path: string};
type Plan<T> = Generator<Op, T, unknown>;
export interface AsyncExtFs {
  stat(path: string): Promise<StatLike>;
  lstat?(path: string): Promise<StatLike>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
}
function runSync<T>(plan: Plan<T>, fs: ExtFs): T {
  let step = plan.next();
  while (!step.done) {
    const {op,path} = step.value;
    let value: unknown, error: unknown, failed = false;
    try { value = op === 'lstat' ? (fs.lstatSync ?? fs.statSync).call(fs,path) : op === 'read' ? fs.readFileSync(path,'utf8') : fs.readdirSync(path); } catch (caught) { failed = true; error = caught; }
    step = failed ? plan.throw(error) : plan.next(value);
  }
  return step.value;
}
async function runAsync<T>(plan: Plan<T>, fs: AsyncExtFs): Promise<T> {
  let step = plan.next();
  while (!step.done) {
    const {op,path} = step.value;
    let value: unknown, error: unknown, failed = false;
    try { value = op === 'lstat' ? await (fs.lstat ?? fs.stat).call(fs,path) : op === 'read' ? await fs.readFile(path,'utf8') : await fs.readdir(path); } catch (caught) { failed = true; error = caught; }
    step = failed ? plan.throw(error) : plan.next(value);
  }
  return step.value;
}

interface Entry { path: string; rel: string; size: number; stamp: string }
const relative = (dir: string, path: string) => path.slice(dir.length).replace(/^[\\/]+/,'').replace(/\\/g,'/');
/** Percorre a pasta com lstat: links (inclusive junções), profundidade e quantidade de entradas além do limite viram problemas. */
function* walk(dir: string): Plan<{files: Entry[]; issues: [string, string][]}> {
  const files: Entry[] = [], issues: [string, string][] = [];
  let count = 0, overflow = false;
  function* visit(path: string, depth: number): Plan<void> {
    if (depth > AUDIT_DEPTH) { issues.push([relative(dir,path),'pasta funda demais para auditar']); return; }
    let names: string[];
    try { names = ((yield {op:'readdir',path}) as string[]).slice().sort(); } catch { issues.push([relative(dir,path),'pasta ilegível']); return; }
    for (const name of names) {
      if (overflow) return;
      if (++count > AUDIT_ENTRIES) { overflow = true; issues.push([relative(dir,path),`mais de ${AUDIT_ENTRIES} itens na extensão: não auditada`]); return; }
      const child = pathFor(path).join(path,name), rel = relative(dir,child);
      let stat: StatLike;
      try { stat = (yield {op:'lstat',path:child}) as StatLike; } catch { issues.push([rel,'item ilegível']); continue; }
      if (stat.isSymbolicLink?.()) { issues.push([rel,'link simbólico ou junção não é permitido']); continue; }
      if (stat.isDirectory()) yield* visit(child,depth + 1);
      else files.push({path:child, rel, size:stat.size, stamp:`${rel}:${stat.size}:${stat.mtimeMs ?? 0}:${stat.ctimeMs ?? 0}:${stat.ino ?? 0}`});
    }
  }
  yield* visit(dir,0);
  return {files, issues};
}
const stampOf = (walked: {files: Entry[]; issues: [string, string][]}) => [...walked.files.map(file => file.stamp),...walked.issues.map(issue => issue.join('!'))].join('|');

/** Acumula os achados de uma auditoria. */
function collector() {
  const found = new Map<string, {finding: AuditFinding; count: number}>();
  const add = (kind: FindingKind, file: string, detail: string) => {
    const key = `${kind}\0${file}\0${detail}`; const entry = found.get(key);
    if (entry) entry.count++; else found.set(key,{finding:{kind,file,detail},count:1});
  };
  const scan = (file: string, raw: string) => {
    const text = stripComments(raw);
    const dynamic = DYNAMIC_CALL_RE.test(text);
    for (const {kind,api,re} of PATTERNS) for (const _ of text.matchAll(re)) add(kind,file,api); // eslint-disable-line @typescript-eslint/no-unused-vars
    for (const match of text.matchAll(URL_RE)) {
      const host = (match[1] ?? '').toLowerCase();
      if (host === 'pokeidle.io') continue;
      const inCall = CALL_BEFORE_RE.test(text.slice(Math.max(0,match.index - 120),match.index));
      add(inCall || (dynamic && !LINK_HOSTS.includes(host)) ? 'network' : 'link',file,host);
    }
  };
  const scanCss = (file: string, raw: string) => {
    for (const match of raw.replace(/\/\*[\s\S]*?\*\//g,' ').matchAll(CSS_URL_RE)) {
      const host = cssHost(match[1] ?? '');
      if (host && host !== 'pokeidle.io') add('network',file,host);
    }
  };
  const result = (): AuditResult => {
    const findings = [...found.values()].map(({finding,count}) => count > 1 && finding.kind !== 'network' && finding.kind !== 'link' && finding.kind !== 'skipped' ? {...finding,detail:`${finding.detail} (${count}×)`} : finding);
    const has = (...kinds: FindingKind[]) => findings.some(finding => kinds.includes(finding.kind));
    const hosts = [...new Set(findings.filter(finding => finding.kind === 'network').map(finding => finding.detail))].sort();
    return {verdict: has('eval','skipped') ? 'bloqueada' : has('network') ? 'externa' : has('click','dispatch','send','obfuscation') ? 'interage' : 'leitura', findings, hosts};
  };
  return {add,scan,scanCss,result};
}

/** Caminho de um arquivo citado no manifest, relativo à pasta; null se escapa dela ou é absoluto/URL. */
function referenced(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\\/g,'/').replace(/^(?:\.\/|\/)+/,'');
  return clean && !/^[a-z][a-z0-9+.-]*:/i.test(clean) && !clean.split('/').includes('..') ? clean : null;
}
const globRe = (glob: string) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')}$`);

/** Roteiro completo da auditoria: percorre, confere os arquivos citados no manifest, lê (com limite) e pontua. */
function* auditPlan(dir: string, scanning: boolean): Plan<{result: AuditResult; hash: string; stamp: string}> {
  const {add,scan,scanCss,result} = collector();
  const walked = yield* walk(dir);
  for (const [file,detail] of walked.issues) add('skipped',file,detail);
  const byRel = new Map(walked.files.map(file => [file.rel,file]));
  const wanted = new Set<string>(); // arquivos que a extensão executa ou expõe: sempre auditados, até os "de teste"
  const need = (value: unknown, accept: (file: string) => boolean, from: string, label: string) => {
    const rel = referenced(value);
    if (!rel) { add('skipped',from,`${label}: caminho inválido`); return; }
    if (!byRel.has(rel)) { add('skipped',rel,`${label}: arquivo citado no manifest não pôde ser lido`); return; }
    if (!accept(rel)) { add('skipped',rel,`${label}: tipo de arquivo não auditável (só .js, .mjs, .cjs e .css)`); return; }
    wanted.add(rel);
  };
  let manifest: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse((yield {op:'read',path:pathFor(dir).join(dir,'manifest.json')}) as string); if (typeof parsed === 'object' && parsed !== null) manifest = parsed as Record<string, unknown>; } catch { add('skipped','manifest.json','manifest.json ilegível'); }
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts as unknown[] : [];
  for (const entry of scripts) {
    const script = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    for (const file of Array.isArray(script.js) ? script.js as unknown[] : []) need(file,isJs,'manifest.json','content_scripts.js');
    for (const file of Array.isArray(script.css) ? script.css as unknown[] : []) need(file,isCss,'manifest.json','content_scripts.css');
    if (script.world === 'MAIN') add('info','manifest.json','content script com world "MAIN": roda no contexto da página, sem isolamento');
  }
  const exposed = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources as unknown[] : [];
  for (const entry of exposed) {
    const list = typeof entry === 'string' ? [entry] : (typeof entry === 'object' && entry !== null && Array.isArray((entry as Record<string, unknown>).resources) ? (entry as {resources: unknown[]}).resources : []);
    for (const resource of list) {
      const rel = referenced(resource);
      const accept = (file: string) => isJs(file) || isCss(file) || MEDIA_RE.test(file);
      if (rel?.includes('*') || rel?.includes('?')) { const re = globRe(rel); for (const file of byRel.keys()) if (re.test(file)) need(file,accept,'manifest.json','web_accessible_resources'); }
      else need(resource,accept,'manifest.json','web_accessible_resources');
    }
  }
  const hash = createHash('sha256');
  let total = 0;
  for (const file of walked.files) {
    if (!isJs(file.rel) && !isCss(file.rel)) continue;
    if (isTestFile(file.rel) && !wanted.has(file.rel)) continue;
    if (file.size > AUDIT_FILE_BYTES || total + file.size > AUDIT_TOTAL_BYTES) { add('skipped',file.rel,'arquivo grande demais para auditar'); hash.update(`${file.stamp}\0`); continue; }
    total += file.size;
    let raw: string;
    try { raw = (yield {op:'read',path:file.path}) as string; } catch { add('skipped',file.rel,'arquivo ilegível'); continue; }
    hash.update(`${file.rel}\0${file.size}\0`); hash.update(raw); hash.update('\0');
    if (scanning) (isCss(file.rel) ? scanCss : scan)(file.rel,raw);
  }
  for (const [file,detail] of walked.issues) hash.update(`!${file}\0${detail}\0`);
  for (const file of walked.files) if (!isJs(file.rel) && !isCss(file.rel)) hash.update(`${file.rel}\0${file.size}\0`); // arquivos que não são lidos: ao menos nome e tamanho
  return {result:result(), hash:hash.digest('hex'), stamp:stampOf(walked)};
}
const unchangedPlan = function* (dir: string): Plan<string> { return stampOf(yield* walk(dir)); };

/**
 * Veredito pelo que o código faz, sem executá-lo, em ordem crescente: 'leitura'; 'interage' (clica, dispara eventos, envia
 * pelo socket ou ofusca texto); 'externa' (chama a rede ou carrega CSS de hosts fora do pokeidle.io: precisa de aprovação dos
 * hosts); 'bloqueada' (eval/new Function/setTimeout com texto, arquivo citado que não dá para auditar, link simbólico, pasta
 * funda demais ou grande demais). Comentários, arquivos de teste e endereços escritos como texto fora de chamadas de rede só
 * geram 'link'. É heurística: a ofuscação pode escapar.
 */
export function auditExtension(dir: string, fs: ExtFs = nodeFs): AuditResult { return runSync(auditPlan(dir,true),fs).result; }
export async function auditExtensionAsync(dir: string, fs: AsyncExtFs = nodeFsp): Promise<AuditResult> { return (await runAsync(auditPlan(dir,true),fs)).result; }
/**
 * Cache da auditoria por (pasta, versão do manifest). Sem `verify` um resultado guardado vale sem tocar no disco (toggle/remover);
 * com `verify` os arquivos são relidos e comparados por sha256 do CONTEÚDO (tamanho/data iguais não bastam) e a varredura de
 * código só roda se algo mudou. `unchanged` é a checagem barata (só lstat) feita logo antes de carregar a extensão.
 * `forget` (Detectar, Adicionar) obriga a reler. Mudar a versão ou o caminho cria outra entrada.
 */
export function createAuditCache(fs: AsyncExtFs = nodeFsp) {
  const entries = new Map<string, {dir: string; hash: string; stamp: string; result: AuditResult}>();
  const keyOf = (dir: string, version: string | null) => `${dir}\0${version ?? ''}`;
  return {
    async get(dir: string, version: string | null, verify = false): Promise<AuditResult> {
      const key = keyOf(dir,version), hit = entries.get(key);
      if (hit && !verify) return hit.result;
      if (hit) {
        const snapshot = await runAsync(auditPlan(dir,false),fs);
        if (snapshot.hash === hit.hash) { hit.stamp = snapshot.stamp; return hit.result; }
      }
      const audit = await runAsync(auditPlan(dir,true),fs);
      for (const [other,entry] of entries) if (entry.dir === dir) entries.delete(other); // versão antiga da mesma pasta
      entries.set(key,{dir,hash:audit.hash,stamp:audit.stamp,result:audit.result});
      return audit.result;
    },
    /** A pasta continua igual ao que foi auditado (nomes, tamanhos, datas, ctime, inode, sem links)? Só lstat. */
    async unchanged(dir: string, version: string | null): Promise<boolean> {
      const hit = entries.get(keyOf(dir,version));
      return Boolean(hit) && hit?.stamp === await runAsync(unchangedPlan(dir),fs);
    },
    forget(dir: string) { for (const [key,entry] of entries) if (entry.dir === dir) entries.delete(key); },
    prune(keep: readonly string[]) { for (const [key,entry] of entries) if (!keep.includes(entry.dir)) entries.delete(key); },
    get size() { return entries.size; },
  };
}
