import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserRoots, approvedHostsOf, auditExtension, catalogIdOf, checkExtension, findInstalled, HUNT_ID, hostsCovered, resolveExtensionPath, SMART_MARKET_ID, stripComments, type ExtFs } from '../electron/extension-check';

const base = {manifest_version:3, name:'Teste', version:'1.0.0', content_scripts:[{matches:['https://pokeidle.io/*'],js:['a.js']}]};
const manifest = (changes: Record<string, unknown> = {}) => JSON.stringify({...base,...changes});
// fs falso: só arquivos; as pastas são inferidas. Aceita "/" e "\" para simular Windows no Linux.
// `links`: caminho → destino real (realpath) e, para lstat, o caminho vira link simbólico.
function fakeFs(files: Record<string,string>, links: Record<string,string> = {}): ExtFs {
  const paths = Object.keys(files);
  const children = (dir: string) => paths.filter(path => path.startsWith(dir) && /^[\\/]/.test(path.slice(dir.length)));
  return {
    statSync(path) {
      const content = files[path];
      if (content !== undefined) return {isDirectory:() => false, size:Buffer.byteLength(content)};
      if (children(path).length === 0) throw new Error('ENOENT');
      return {isDirectory:() => true, size:0};
    },
    lstatSync(path) { const stat = this.statSync(path); return {isDirectory:() => stat.isDirectory(), size:stat.size, isSymbolicLink:() => path in links}; },
    realpathSync(path) { for (const [from,to] of Object.entries(links)) if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length); return path; },
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
    const real = fakeFs({[`${dir}/0.4.0_0/manifest.json`]:manifest()});
    expect(catalogIdOf(`${dir}/0.4.0_0`,linux,real)).toBe(SMART_MARKET_ID);
    expect(catalogIdOf('/custom/ext',linux,real)).toBeNull();
    const win = {platform:'win32',home:'C:\\Users\\u',localAppData:'C:\\Users\\u\\AppData\\Local'};
    const winDir = `${browserRoots(win)[0]}\\Profile 2\\Extensions\\${HUNT_ID}\\1.0.17_0`;
    expect(catalogIdOf(winDir,win,fakeFs({[`${winDir}\\manifest.json`]:manifest()}))).toBe(HUNT_ID);
  });
});

describe('auditoria estática', () => {
  // o manifest cita todos os .js que não são de teste: arquivo citado e ilegível bloqueia a extensão
  const TEST_PATH = /(^|[/])(tests?|__tests__)[/]|[.]test[.]js$/;
  const isTest = (name: string) => TEST_PATH.test(name);
  const manifestFor = (files: Record<string,string>, extra: Record<string,unknown> = {}) => manifest({content_scripts:[{matches:['https://pokeidle.io/*'],js:Object.keys(files).filter(name => /[.]js$/.test(name) && !isTest(name))}],...extra});
  const auditWith = (files: Record<string,string>, extra: Record<string,unknown> = {}, links: Record<string,string> = {}) => auditExtension('/ext',fakeFs({'/ext/manifest.json':manifestFor(files,extra),...Object.fromEntries(Object.entries(files).map(([name,code]) => [`/ext/${name}`,code]))},links));
  const audit = (files: Record<string,string>) => auditWith(files);
  it('é só leitura quando observa a página e não envia nada', () => {
    const result = audit({'a.js':"const el=document.querySelector('.x'); new MutationObserver(()=>{}).observe(el,{childList:true}); const u='https://pokeidle.io/tracker/api/x'; fetch('/tracker/api/y');"});
    expect(result).toEqual({verdict:'leitura',findings:[{kind:'fetch',file:'a.js',detail:'fetch()'}],hosts:[]});
  });
  it('trata links de divulgação como link, não como rede', () => {
    const result = audit({'a.js':"el.href='https://chromewebstore.google.com/detail/x'; const g='https://github.com/a/b'; const d='https://livepix.gg/x';"});
    expect(result.verdict).toBe('leitura');
    expect(result.findings.map(finding => `${finding.kind}:${finding.detail}`)).toEqual(['link:chromewebstore.google.com','link:github.com','link:livepix.gg']);
  });
  it('rede para fora do jogo é "externa" (precisa de aprovação dos hosts), inclusive link dentro de fetch/WebSocket', () => {
    expect(audit({'a.js':"fetch('https://api.example.com/v1',{method:'POST'})"})).toMatchObject({verdict:'externa',hosts:['api.example.com'],findings:expect.arrayContaining([{kind:'network',file:'a.js',detail:'api.example.com'}])});
    expect(audit({'a.js':"new WebSocket('wss://relay.example.net/x')"})).toMatchObject({verdict:'externa',hosts:['relay.example.net']});
    expect(audit({'a.js':"fetch('https://github.com/x/raw')"})).toMatchObject({verdict:'externa',hosts:['github.com']});
    expect(audit({'a.js':"x.open('GET','https://cdn.example.org/a.json')"}).hosts).toEqual(['cdn.example.org']);
    expect(audit({'a.js':"new WebSocket('wss://pokeidle.io/socket')"}).verdict).toBe('leitura');
    expect(audit({'a.js':"fetch('https://x.example.com'); eval(1)"}).verdict).toBe('bloqueada'); // eval vence
  });
  it('endereço escrito como texto fora de chamada de rede é só link; com fetch(variável) no arquivo passa a contar como rede', () => {
    expect(audit({'a.js':"const base='http://203.0.113.9:8080'; use(base)"})).toMatchObject({verdict:'leitura',hosts:[],findings:[{kind:'link',file:'a.js',detail:'203.0.113.9'}]});
    expect(audit({'a.js':"const U=['https://a.example.com/x','https://b.example.com/y']; for (const u of U) await fetch(u)"})).toMatchObject({verdict:'externa',hosts:['a.example.com','b.example.com']});
    expect(audit({'a.js':"const U='https://a.example.com/x'; fetch('/rel/api')"}).verdict).toBe('leitura');
    expect(audit({'a.js':"const w='http://www.w3.org/2000/svg'; fetch(url)"}).verdict).toBe('leitura'); // namespace conhecido continua link
  });
  it('comentários e arquivos de teste não geram achados de rede', () => {
    const qrcode = "/*! qrcode.js - MIT https://github.com/davidshimjs/qrcodejs/blob/master/LICENSE */\n// see http://www.opensource.org/licenses/mit-license.php\n/**\n * @see https://www.example-license.org/terms\n */\nfunction QR(){ return 1 } // https://comments.example.net/x\nvar a = 'https://kept-in-string.example.com'; var b = \"//not-a-comment\";";
    const result = audit({'lib/qrcode.js':qrcode});
    expect(result.verdict).toBe('leitura');
    expect(result.hosts).toEqual([]);
    expect(result.findings.map(finding => finding.kind)).toEqual(['link']);
    expect(result.findings[0]?.detail).toBe('kept-in-string.example.com');
    expect(audit({'tests/a.js':"fetch('https://x.example.com'); eval(1)",'test/b.js':'btn.click()','__tests__/c.js':'eval(1)','src/d.test.js':"fetch('https://y.example.com')",'src/ok.js':'1'})).toMatchObject({verdict:'leitura',findings:[],hosts:[]});
  });
  it('stripComments preserva https:// em strings e só tira // depois de espaço, ; { } ou início de linha', () => {
    expect(stripComments("a('https://x.com/y'); // c\nb")).toBe("a('https://x.com/y'); \nb");
    expect(stripComments("/* a */x/* b\nc */y")).toBe(' x y');
    expect(stripComments("x=`//t`; y=\"// s\"; z=1;//c\nw")).toBe("x=`//t`; y=\"// s\"; z=1;\nw");
    expect(stripComments("var u=a//b\n")).toBe("var u=a//b\n"); // sem espaço antes: não é comentário
  });
  it('hosts aprovados: catálogo só vale pelo id e um host novo pede aprovação de novo', () => {
    expect(approvedHostsOf(HUNT_ID,[])).toEqual(['pokeidle-gg.pages.dev','pokeidleguide.io']);
    expect(approvedHostsOf(SMART_MARKET_ID,[])).toEqual([]);
    expect(approvedHostsOf('outro-id',[])).toEqual([]);
    expect(approvedHostsOf(HUNT_ID,['extra.example.com'])).toEqual(['extra.example.com','pokeidle-gg.pages.dev','pokeidleguide.io']);
    expect(hostsCovered(['pokeidleguide.io'],approvedHostsOf(HUNT_ID,[]))).toBe(true);
    expect(hostsCovered(['pokeidleguide.io','novo.example.com'],approvedHostsOf(HUNT_ID,[]))).toBe(false);
    expect(hostsCovered([],[])).toBe(true);
  });
  it('modelo do /hunt 1.0.23: scripts MAIN + ponte ISOLATED que busca dois hosts → externa; os dois hosts do catálogo cobrem', () => {
    const hunt = JSON.stringify({manifest_version:3,name:'/hunt for PokeIdle',version:'1.0.23',content_scripts:[
      {matches:['https://pokeidle.io/*'],js:['src/boot.js','src/game.js','src/ui.js'],run_at:'document_start',world:'MAIN'},
      {matches:['https://pokeidle.io/*'],css:['src/ui.css'],run_at:'document_start'},
      {matches:['https://pokeidle.io/*'],js:['src/wishlist-ponte.js'],run_at:'document_idle'}]});
    const fs = fakeFs({
      '/h/manifest.json':hunt,
      '/h/src/boot.js':'window.__x = 1;',
      '/h/src/game.js':"const r = await fetch('/tracker/api/sprites?lt=1'); const pix = new MutationObserver(() => {});",
      '/h/src/ui.js':"const g = 'https://pokeidleguide.io'; const pay = 'https://livepix.gg/x'; const ns = 'http://www.w3.org/2000/svg'; a.href = g;",
      '/h/src/ui.css':'.x{color:red}',
      '/h/src/wishlist-ponte.js':"// ponte da WishList\n(function(){ const URLS_LISTA = ['https://pokeidleguide.io/api/wishlist', 'https://pokeidle-gg.pages.dev/api/wishlist'];\n const buscar = async (url) => { const r = await fetch(url, { credentials: 'omit' }); return r.json(); };\n})();",
    });
    expect(checkExtension('/h',fs)).toEqual({ok:true,name:'/hunt for PokeIdle',version:'1.0.23'});
    const result = auditExtension('/h',fs);
    expect(result.verdict).toBe('externa');
    expect(result.hosts).toEqual(['pokeidle-gg.pages.dev','pokeidleguide.io']);
    expect(result.findings.filter(finding => finding.kind === 'network').map(finding => finding.file)).toEqual(['src/wishlist-ponte.js','src/wishlist-ponte.js']);
    expect(hostsCovered(result.hosts,approvedHostsOf(HUNT_ID,[]))).toBe(true); // carrega pela pré-aprovação do catálogo
    expect(hostsCovered(result.hosts,approvedHostsOf('outra-pasta',[]))).toBe(false); // a mesma extensão fora do catálogo pede aprovação
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
    expect(result.hosts).toEqual([]);
  });
  it('Smart Market com pasta tests/ cheia de .send() e rede continua só "interage"', () => {
    const fs = fakeFs({'/sm/manifest.json':manifest({content_scripts:[{matches:['https://pokeidle.io/*'],js:['page.js']}]}),'/sm/page.js':"ws.send('q')",'/sm/tests/page.test.js':"fetch('https://mock.example.com'); ws.send(1)",'/sm/tests/helper.js':"ws.send(2)"});
    expect(auditExtension('/sm',fs)).toEqual({verdict:'interage',findings:[{kind:'send',file:'page.js',detail:'.send()'}],hosts:[]});
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
    expect(audit({'a/b/c/d/e/f/g/too-deep.js':'eval(1)'})).toMatchObject({verdict:'bloqueada',findings:expect.arrayContaining([{kind:'skipped',file:'a/b/c/d/e/f/g',detail:'pasta funda demais para auditar'}])}); // fundo demais: nunca mais ignorado em silêncio
    const many: Record<string,string> = {};
    for (let i = 0; i < 5; i++) many[`f${i}.js`] = 'a'.repeat(1_900_000);
    expect(audit(many).findings.some(finding => finding.kind === 'skipped')).toBe(true); // passou de 8 MB no total
  });
  it('lê arquivos reais com o fs padrão e ignora o que não é JavaScript', () => {
    const dir = mkdtempSync(join(tmpdir(),'pokehub-audit-'));
    try { mkdirSync(join(dir,'sub')); writeFileSync(join(dir,'manifest.json'),manifest({content_scripts:[{matches:['https://pokeidle.io/*'],js:['sub/a.js']}]})); writeFileSync(join(dir,'sub','a.js'),'x.click()'); writeFileSync(join(dir,'note.txt'),'eval(1)'); expect(auditExtension(dir)).toEqual({verdict:'interage',findings:[{kind:'click',file:'sub/a.js',detail:'.click()'}],hosts:[]}); }
    finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
