import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditExtension, catalogIdOf, checkExtension, findInstalled, HUNT_ID, resolveExtensionPath, SMART_MARKET_ID, type ExtFs } from '../electron/extension-check';

const base = {manifest_version:3, name:'Teste', version:'1.0.0', content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js']}]};
const manifest = (changes: Record<string, unknown> = {}) => JSON.stringify({...base,...changes});
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

describe('catálogo e detecção de várias extensões', () => {
  const linux = {platform:'linux',home:'/home/u'};
  const chrome = '/home/u/.config/google-chrome/Default/Extensions';
  it('acha /hunt e Smart Market, cada uma na maior versão, entre navegadores e perfis', () => {
    const edge = '/home/u/.config/microsoft-edge/Profile 1/Extensions';
    const fs = fakeFs({
      [`${chrome}/${HUNT_ID}/1.0.17_0/manifest.json`]:manifest(),
      [`${chrome}/${SMART_MARKET_ID}/0.4.0_0/manifest.json`]:manifest({version:'0.4.0'}),
      [`${edge}/${SMART_MARKET_ID}/0.10.0_0/manifest.json`]:manifest({version:'0.10.0'}),
      [`${chrome}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/1.0.0_0/manifest.json`]:manifest(),
    });
    expect(findInstalled(linux,fs)).toEqual([{id:HUNT_ID,path:`${chrome}/${HUNT_ID}/1.0.17_0`},{id:SMART_MARKET_ID,path:`${edge}/${SMART_MARKET_ID}/0.10.0_0`}]);
    expect(findInstalled(linux,fakeFs({'/home/u/x':'1'}))).toEqual([]);
  });
  it('ignora a versão instalada que o validador recusa', () => {
    const dir = `${chrome}/${SMART_MARKET_ID}`;
    const fs = fakeFs({[`${dir}/1.0.0_0/manifest.json`]:manifest({version:'1.0.0'}),[`${dir}/2.0.0_0/manifest.json`]:manifest({version:'2.0.0',background:{service_worker:'b.js'}})});
    expect(findInstalled(linux,fs)).toEqual([{id:SMART_MARKET_ID,path:`${dir}/1.0.0_0`}]);
  });
  it('troca a versão sumida de qualquer extensão do catálogo e reconhece o id pelo caminho', () => {
    const dir = `${chrome}/${SMART_MARKET_ID}`;
    const fs = fakeFs({[`${dir}/0.5.0_0/manifest.json`]:manifest({version:'0.5.0'})});
    expect(resolveExtensionPath(`${dir}/0.4.0_0`,fs)).toBe(`${dir}/0.5.0_0`);
    expect(resolveExtensionPath('/custom/gone',fs)).toBe('/custom/gone');
    expect(catalogIdOf(`${dir}/0.4.0_0`)).toBe(SMART_MARKET_ID);
    expect(catalogIdOf('/custom/ext')).toBeNull();
    expect(catalogIdOf(`C:\\Users\\u\\Extensions\\${HUNT_ID}\\1.0.17_0`)).toBe(HUNT_ID);
  });
});

describe('auditoria estática', () => {
  const audit = (files: Record<string,string>) => auditExtension('/ext',fakeFs({'/ext/manifest.json':manifest(),...Object.fromEntries(Object.entries(files).map(([name,code]) => [`/ext/${name}`,code]))}));
  it('é só leitura quando observa a página e não envia nada', () => {
    const result = audit({'a.js':"const el=document.querySelector('.x'); new MutationObserver(()=>{}).observe(el,{childList:true}); const u='https://pokeidle.io/tracker/api/x'; fetch('/tracker/api/y');"});
    expect(result).toEqual({verdict:'leitura',findings:[{kind:'fetch',file:'a.js',detail:'fetch()'}]});
  });
  it('trata links de divulgação como link, não como rede', () => {
    const result = audit({'a.js':"el.href='https://chromewebstore.google.com/detail/x'; const g='https://github.com/a/b'; const d='https://livepix.gg/x';"});
    expect(result.verdict).toBe('leitura');
    expect(result.findings.map(finding => `${finding.kind}:${finding.detail}`)).toEqual(['link:chromewebstore.google.com','link:github.com','link:livepix.gg']);
  });
  it('bloqueia rede para fora do jogo, inclusive link dentro de fetch/WebSocket', () => {
    expect(audit({'a.js':"fetch('https://api.example.com/v1',{method:'POST'})"})).toMatchObject({verdict:'bloqueada',findings:expect.arrayContaining([{kind:'network',file:'a.js',detail:'api.example.com'}])});
    expect(audit({'a.js':"new WebSocket('wss://relay.example.net/x')"}).verdict).toBe('bloqueada');
    expect(audit({'a.js':"fetch('https://github.com/x/raw')"}).verdict).toBe('bloqueada');
    expect(audit({'a.js':"const base='http://203.0.113.9:8080'; use(base)"}).verdict).toBe('bloqueada');
    expect(audit({'a.js':"new WebSocket('wss://pokeidle.io/socket')"}).verdict).toBe('leitura');
  });
  it('bloqueia eval e new Function, sem confundir com nomes parecidos', () => {
    expect(audit({'a.js':'eval(code)'}).verdict).toBe('bloqueada');
    expect(audit({'a.js':"const f=new Function('return 1')"}).verdict).toBe('bloqueada');
    expect(audit({'a.js':'retrieval(x); obj.medieval(y); prefetch(z)'}).verdict).toBe('leitura');
  });
  it('marca como interage quem clica, dispara eventos ou envia pelo socket', () => {
    expect(audit({'a.js':'btn.click()'}).verdict).toBe('interage');
    expect(audit({'a.js':"input.dispatchEvent(new Event('input'))"}).verdict).toBe('interage');
    expect(audit({'a.js':'socket.send(JSON.stringify(q))'}).verdict).toBe('interage');
    expect(audit({'a.js':'btn.click(); btn.click();'}).findings).toEqual([{kind:'click',file:'a.js',detail:'.click() (2×)'}]);
  });
  it('modelo do Smart Market: só storage, mundo MAIN, preenche campo e consulta o mercado pelo socket → interage, não bloqueada', () => {
    const smart = JSON.stringify({manifest_version:3,name:'Smart Market',version:'0.10.0',permissions:['storage'],content_scripts:[{matches:['https://pokeidle.io/*'],js:['page.js'],world:'MAIN',run_at:'document_start'},{matches:['https://pokeidle.io/*'],js:['ui/overlay.js'],css:['ui/overlay.css']}]});
    const fs = fakeFs({
      '/sm/manifest.json':smart,
      '/sm/page.js':"function ask(ws){ ws.send(JSON.stringify({m:'market.historicoGlobal',id:1})); ws.send(JSON.stringify({m:'market.listar'})); }",
      '/sm/ui/overlay.js':"function fill(input,v){ input.value=v; input.dispatchEvent(new Event('input',{bubbles:true})); } const repo='https://github.com/danielbonfante/pokeidle-smartmarket'; const home='https://pokeidle.io/app';",
      '/sm/ui/overlay.css':'a{color:red}',
    });
    expect(checkExtension('/sm',fs)).toEqual({ok:true,name:'Smart Market',version:'0.10.0'});
    const result = auditExtension('/sm',fs);
    expect(result.verdict).toBe('interage');
    expect(result.findings).toEqual(expect.arrayContaining([{kind:'send',file:'page.js',detail:'.send() (2×)'},{kind:'dispatch',file:'ui/overlay.js',detail:'dispatchEvent()'},{kind:'link',file:'ui/overlay.js',detail:'github.com'}]));
    expect(result.findings.some(finding => finding.kind === 'network' || finding.kind === 'eval')).toBe(false);
  });
  it('modelo de autopiloto: service worker é recusado já pelo validador', () => {
    const pilot = JSON.stringify({manifest_version:3,name:'Piloto',version:'1.0.0',permissions:['storage','alarms','power','notifications'],background:{service_worker:'sw.js'},content_scripts:[{matches:['https://pokeidle.io/*'],js:['c.js']}]});
    const result = checkExtension('/pilot',fakeFs({'/pilot/manifest.json':pilot,'/pilot/sw.js':"fetch('https://pokeidle.io/api/buy')"}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('background');
  });
  it('respeita os limites de tamanho e de profundidade', () => {
    expect(audit({'big.js':'x'.repeat(2 * 1024 * 1024 + 1)})).toMatchObject({verdict:'bloqueada',findings:[{kind:'skipped',file:'big.js'}]});
    expect(audit({'a/b/c/d/e/f/deep.js':'btn.click()'}).verdict).toBe('interage');
    expect(audit({'a/b/c/d/e/f/g/h/too-deep.js':'eval(1)'}).verdict).toBe('leitura');
    const many: Record<string,string> = {};
    for (let i = 0; i < 5; i++) many[`f${i}.js`] = 'a'.repeat(1_900_000);
    expect(audit(many).findings.some(finding => finding.kind === 'skipped')).toBe(true); // passou de 8 MB no total
  });
  it('lê arquivos reais com o fs padrão e ignora o que não é JavaScript', () => {
    const dir = mkdtempSync(join(tmpdir(),'pokehub-audit-'));
    try { mkdirSync(join(dir,'sub')); writeFileSync(join(dir,'sub','a.js'),'x.click()'); writeFileSync(join(dir,'note.txt'),'eval(1)'); expect(auditExtension(dir)).toEqual({verdict:'interage',findings:[{kind:'click',file:'sub/a.js',detail:'.click()'}]}); }
    finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
