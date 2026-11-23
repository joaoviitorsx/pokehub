// Valida e localiza a extensão "/hunt for PokeIdle" na pasta do navegador do usuário.
// O PokéHub só carrega a pasta original; nunca copia nem altera o código de terceiros.
import * as nodeFs from 'node:fs';
import { posix, win32 } from 'node:path';

export const HUNT_ID = 'mhnplloljgchpfpcpbhmcokmnefodjnh';
const GAME = 'https://pokeidle.io/';
const MAX_MANIFEST_BYTES = 64 * 1024;
// Qualquer uma destas chaves daria à extensão alcance além dos content scripts do jogo.
const FORBIDDEN = ['background','permissions','host_permissions','optional_permissions','optional_host_permissions','externally_connectable'];

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

/** Caminho da maior versão instalada em qualquer navegador/perfil conhecido, ou null. */
export function findInstalledHunt(machine: Machine, fs: ExtFs = nodeFs): string | null {
  let best: {path: string; parts: number[]} | null = null;
  for (const root of browserRoots(machine)) {
    let profiles: string[];
    try { profiles = fs.readdirSync(root); } catch { continue; }
    for (const profile of profiles) {
      if (profile !== 'Default' && !profile.startsWith('Profile ')) continue;
      const found = latestVersion(pathFor(root).join(root,profile,'Extensions',HUNT_ID),fs);
      if (found && (!best || compareParts(found.parts,best.parts) > 0)) best = found;
    }
  }
  return best?.path ?? null;
}

/** O Chrome apaga a pasta da versão antiga ao atualizar: troca o caminho salvo pela maior versão irmã. */
export function resolveHuntPath(saved: string, fs: ExtFs = nodeFs): string {
  try { if (fs.statSync(saved).isDirectory()) return saved; } catch { /* sumiu: procurar irmã */ }
  const p = pathFor(saved);
  const idDir = p.dirname(saved);
  return p.basename(idDir) === HUNT_ID ? latestVersion(idDir,fs)?.path ?? saved : saved;
}
