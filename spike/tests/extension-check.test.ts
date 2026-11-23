import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserRoots, checkExtension, findInstalledHunt, HUNT_ID, latestVersion, resolveHuntPath, type ExtFs } from '../electron/extension-check';

const valid = {manifest_version:3, name:'/hunt for PokeIdle', version:'1.0.17', key:'k', update_url:'https://clients2.google.com/service/update2/crx',
  content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js'],world:'MAIN',run_at:'document_start'},{matches:['https://pokeidle.io/*'],js:['b.js']}]};
const manifest = (changes: Record<string, unknown> = {}) => JSON.stringify({...valid,...changes});
// fs falso: só arquivos; as pastas são inferidas. Aceita "/" e "\" para simular Windows no Linux.
function fakeFs(files: Record<string,string>): ExtFs {
  const paths = Object.keys(files);
  const children = (dir: string) => paths.filter(path => path.startsWith(dir) && /^[\\/]/.test(path.slice(dir.length)));
  return {
    statSync(path) {
      const content = files[path];
      if (content !== undefined) return {isDirectory:() => false, size:Buffer.byteLength(content)};
      if (children(path).length === 0) throw new Error('ENOENT');
      return {isDirectory:() => true, size:0};
    },
    readFileSync(path) { const content = files[path]; if (content === undefined) throw new Error('ENOENT'); return content; },
    readdirSync(path) {
      const found = children(path); if (found.length === 0) throw new Error('ENOENT');
      return [...new Set(found.map(child => child.slice(path.length + 1).split(/[\\/]/)[0] ?? ''))];
    },
  };
}
const check = (changes: Record<string, unknown>) => checkExtension('/ext',fakeFs({'/ext/manifest.json':manifest(changes)}));

describe('validação da extensão /hunt', () => {
  it('aceita o manifest MV3 restrito ao jogo', () => {
    expect(check({})).toEqual({ok:true,name:'/hunt for PokeIdle',version:'1.0.17'});
    expect(check({permissions:[],web_accessible_resources:[{resources:['x.png'],matches:['https://pokeidle.io/*']}]}).ok).toBe(true);
  });
  it('recusa manifest que não é MV3', () => {
    expect(check({manifest_version:2})).toEqual({ok:false,error:'A extensão precisa usar Manifest V3.'});
  });
  it.each([
    ['background',{service_worker:'bg.js'}], ['permissions',['storage']], ['host_permissions',['<all_urls>']],
    ['optional_permissions',['tabs']], ['optional_host_permissions',['https://*/*']], ['externally_connectable',{matches:['https://pokeidle.io/*']}],
  ])('recusa %s', (key,value) => {
    const result = check({[key]:value});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(key);
  });
  it.each([
    [['https://pokeidle.io/*','https://example.com/*']], [['<all_urls>']], [['http://pokeidle.io/*']], [['https://pokeidle.io.evil.com/*']], [['https://*.pokeidle.io/*']], [[]], ['https://pokeidle.io/*'],
  ])('recusa content script com matches %j', matches => {
    expect(check({content_scripts:[{matches,js:['a.js']}]}).ok).toBe(false);
  });
  it('recusa recursos expostos fora do jogo e manifest sem scripts', () => {
    expect(check({web_accessible_resources:[{resources:['x.js'],matches:['<all_urls>']}]}).ok).toBe(false);
    expect(check({web_accessible_resources:[{resources:['x.js'],extension_ids:['*']}]}).ok).toBe(false);
    expect(check({content_scripts:[]}).ok).toBe(false);
    expect(check({content_scripts:undefined}).ok).toBe(false);
    expect(check({version:'1.0-beta'}).ok).toBe(false);
  });
  it('recusa caminho relativo, inexistente, arquivo, JSON inválido e manifest enorme', () => {
    const fs = fakeFs({'/ext/manifest.json':manifest(),'/bad/manifest.json':'{','/big/manifest.json':manifest({description:'x'.repeat(70_000)}),'/list/manifest.json':'[]'});
    expect(checkExtension('ext',fs).ok).toBe(false);
    expect(checkExtension('',fs).ok).toBe(false);
    expect(checkExtension('/missing',fs).ok).toBe(false);
    expect(checkExtension('/ext/manifest.json',fs).ok).toBe(false);
    expect(checkExtension('/bad',fs).ok).toBe(false);
    expect(checkExtension('/big',fs)).toEqual({ok:false,error:'O manifest.json da extensão é grande demais.'});
    expect(checkExtension('/list',fs).ok).toBe(false);
  });
  it('lê uma pasta real com o fs padrão', () => {
    const dir = mkdtempSync(join(tmpdir(),'pokehub-ext-'));
    try {
      mkdirSync(join(dir,'1.0.17_0')); writeFileSync(join(dir,'1.0.17_0','manifest.json'),manifest());
      expect(checkExtension(join(dir,'1.0.17_0')).ok).toBe(true);
      expect(checkExtension(dir).ok).toBe(false);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});

describe('localização da extensão instalada', () => {
  const linux = {platform:'linux',home:'/home/u'};
  const ext = (root: string, profile: string, version: string) => `${root}/${profile}/Extensions/${HUNT_ID}/${version}/manifest.json`;
  it('escolhe a maior versão numericamente e ignora versões inválidas', () => {
    const idDir = `/home/u/.config/google-chrome/Default/Extensions/${HUNT_ID}`;
    const fs = fakeFs({
      [`${idDir}/1.0.9_0/manifest.json`]:manifest({version:'1.0.9'}), [`${idDir}/1.0.17_0/manifest.json`]:manifest(),
      [`${idDir}/1.0.17_1/manifest.json`]:manifest(), [`${idDir}/2.0.0_0/manifest.json`]:manifest({permissions:['tabs']}), [`${idDir}/Temp/manifest.json`]:manifest(),
    });
    expect(latestVersion(idDir,fs)?.path).toBe(`${idDir}/1.0.17_1`);
    expect(findInstalledHunt(linux,fs)).toBe(`${idDir}/1.0.17_1`);
    expect(latestVersion('/nada',fs)).toBeNull();
  });
  it('procura em todos os navegadores e perfis do Linux, incluindo Flatpak', () => {
    expect(browserRoots(linux)).toEqual(['/home/u/.config/google-chrome','/home/u/.config/chromium','/home/u/.var/app/com.google.Chrome/config/google-chrome','/home/u/.config/BraveSoftware/Brave-Browser','/home/u/.config/microsoft-edge']);
    const flatpak = '/home/u/.var/app/com.google.Chrome/config/google-chrome';
    const fs = fakeFs({
      [ext('/home/u/.config/chromium','Default','1.0.2_0')]:manifest({version:'1.0.2'}),
      [ext(flatpak,'Profile 2','1.0.17_0')]:manifest(),
      [ext(flatpak,'Guest Profile','9.0.0_0')]:manifest({version:'9.0.0'}),
      [ext('/home/u/.config/microsoft-edge','Default','1.0.10_0')]:manifest({version:'1.0.10'}),
    });
    expect(findInstalledHunt(linux,fs)).toBe(`${flatpak}/Profile 2/Extensions/${HUNT_ID}/1.0.17_0`);
    expect(findInstalledHunt(linux,fakeFs({'/home/u/x':'1'}))).toBeNull();
  });
  it('procura nas pastas do Windows', () => {
    const local = 'C:\\Users\\u\\AppData\\Local';
    const windows = {platform:'win32',home:'C:\\Users\\u',localAppData:local};
    expect(browserRoots(windows)).toEqual([`${local}\\Google\\Chrome\\User Data`,`${local}\\Microsoft\\Edge\\User Data`,`${local}\\BraveSoftware\\Brave-Browser\\User Data`]);
    expect(browserRoots({platform:'win32',home:'C:\\Users\\u'})).toEqual(browserRoots(windows));
    const brave = `${local}\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1\\Extensions\\${HUNT_ID}`;
    const fs = fakeFs({
      [`${local}\\Google\\Chrome\\User Data\\Default\\Extensions\\${HUNT_ID}\\1.0.3_0\\manifest.json`]:manifest({version:'1.0.3'}),
      [`${brave}\\1.0.17_0\\manifest.json`]:manifest(),
    });
    expect(findInstalledHunt(windows,fs)).toBe(`${brave}\\1.0.17_0`);
    expect(checkExtension(`${brave}\\1.0.17_0`,fs).ok).toBe(true);
  });
  it('troca a versão salva que sumiu pela maior irmã na pasta do id', () => {
    const idDir = `/home/u/.config/google-chrome/Default/Extensions/${HUNT_ID}`;
    const fs = fakeFs({[`${idDir}/1.0.18_0/manifest.json`]:manifest({version:'1.0.18'}),[`${idDir}/1.0.20_0/manifest.json`]:manifest({version:'1.0.20'}),'/custom/ext/manifest.json':manifest()});
    expect(resolveHuntPath(`${idDir}/1.0.17_0`,fs)).toBe(`${idDir}/1.0.20_0`);
    expect(resolveHuntPath(`${idDir}/1.0.18_0`,fs)).toBe(`${idDir}/1.0.18_0`); // ainda existe: mantém a escolha
    expect(resolveHuntPath('/custom/gone',fs)).toBe('/custom/gone'); // fora da pasta do id não há o que adivinhar
    expect(resolveHuntPath(`/vazio/${HUNT_ID}/1.0.17_0`,fs)).toBe(`/vazio/${HUNT_ID}/1.0.17_0`);
  });
});
