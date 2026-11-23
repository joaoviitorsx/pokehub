import { describe, expect, it } from 'vitest';
import { auditExtension, browserRoots, catalogIdOf, HUNT_ID, SMART_MARKET_ID, type ExtFs } from '../electron/extension-check';

const GAME = ['https://pokeidle.io/*'];
const manifest = (changes: Record<string, unknown> = {}) => JSON.stringify({manifest_version: 3, name: 'T', version: '1.0.0', content_scripts: [{matches: GAME, js: ['a.js']}], ...changes});
// fs falso: só arquivos (pastas inferidas). `links`: caminho → destino real; o próprio caminho é um link simbólico para o lstat.
function fakeFs(files: Record<string, string>, links: Record<string, string> = {}): ExtFs {
  const paths = Object.keys(files);
  const children = (dir: string) => paths.filter(path => path.startsWith(`${dir}/`));
  const stat = (path: string) => {
    const content = files[path];
    if (content !== undefined) return {isDirectory: () => false, isSymbolicLink: () => path in links, size: Buffer.byteLength(content)};
    if (children(path).length === 0) throw new Error('ENOENT');
    return {isDirectory: () => true, isSymbolicLink: () => path in links, size: 0};
  };
  return {
    statSync: stat,
    lstatSync: stat,
    readFileSync(path) { const content = files[path]; if (content === undefined) throw new Error('ENOENT'); return content; },
    readdirSync(path) { const found = children(path); if (found.length === 0) throw new Error('ENOENT'); return [...new Set(found.map(child => child.slice(path.length + 1).split('/')[0] ?? ''))]; },
    realpathSync(path) { for (const [from, to] of Object.entries(links)) if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length); return path; },
  };
}
const audit = (files: Record<string, string>, manifestChanges: Record<string, unknown> = {}, links: Record<string, string> = {}) =>
  auditExtension('/ext', fakeFs({'/ext/manifest.json': manifest(manifestChanges), ...Object.fromEntries(Object.entries(files).map(([name, code]) => [`/ext/${name}`, code]))}, links));
const skipped = (result: ReturnType<typeof audit>) => result.findings.filter(finding => finding.kind === 'skipped').map(finding => `${finding.file}: ${finding.detail}`);

describe('auditoria: limites e arquivos citados no manifest', () => {
  it('eval a 7 níveis de profundidade não passa em silêncio: bloqueada', () => {
    const result = audit({'a.js': '1', 'a/b/c/d/e/f/g/x.js': 'eval(1)'});
    expect(result.verdict).toBe('bloqueada');
    expect(skipped(result)).toEqual(['a/b/c/d/e/f/g: pasta funda demais para auditar']);
    expect(audit({'a.js': '1', 'a/b/c/d/e/f/x.js': 'btn.click()'}).verdict).toBe('interage'); // 6 níveis ainda é lido
  });
  it('mais de 2000 itens: o excedente vira skipped (bloqueada)', () => {
    const many: Record<string, string> = {'a.js': '1'};
    for (let i = 0; i < 1998; i++) many[`img/${i}.png`] = 'x';
    const result = audit(many);
    expect(result.verdict).toBe('bloqueada');
    expect(skipped(result).some(text => text.includes('mais de 2000 itens'))).toBe(true);
    delete many['img/0.png'];
    expect(skipped(audit(many))).toEqual([]);
  });
  it('content_scripts.js "a.txt" (ou ausente, ou fora da pasta) é recusado: bloqueada', () => {
    const txt = audit({'a.txt': 'eval(1)'}, {content_scripts: [{matches: GAME, js: ['a.txt']}]});
    expect(txt.verdict).toBe('bloqueada');
    expect(skipped(txt)[0]).toContain('a.txt');
    expect(skipped(audit({}, {content_scripts: [{matches: GAME, js: ['sumiu.js']}]}))).toEqual(['sumiu.js: content_scripts.js: arquivo citado no manifest não pôde ser lido']);
    expect(audit({'a.js': '1'}, {content_scripts: [{matches: GAME, js: ['../fora.js']}]}).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1'}, {content_scripts: [{matches: GAME, js: ['https://x.example/a.js']}]}).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1', 'ui.js': '1'}, {content_scripts: [{matches: GAME, js: ['./a.js', '/ui.js']}]}).verdict).toBe('leitura'); // ./ e / iniciais são normalizados
    expect(audit({'a.js': '1', 's.js': '1'}, {content_scripts: [{matches: GAME, js: ['a.js'], css: ['s.js']}]}).verdict).toBe('bloqueada'); // css apontando para .js
  });
  it('web_accessible_resources: .js/.css/mídia inerte passam; html, svg e wasm viram skipped, inclusive por curinga', () => {
    const resources = (list: string[]) => ({web_accessible_resources: [{resources: list, matches: GAME}]});
    expect(audit({'a.js': '1', 'img/i.png': 'x', 'f/a.woff2': 'x'}, resources(['img/i.png', 'f/*'])).verdict).toBe('leitura');
    expect(audit({'a.js': '1', 'p.html': '<script>1</script>'}, resources(['p.html'])).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1', 'img/i.svg': '<svg/>'}, resources(['img/i.svg'])).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1', 'w/x.wasm': 'x', 'w/y.png': 'x'}, resources(['w/*'])).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1'}, resources(['nao-existe.png'])).verdict).toBe('bloqueada');
    expect(audit({'a.js': '1', 'tests/x.js': 'eval(1)'}, resources(['tests/x.js'])).verdict).toBe('bloqueada'); // citado: audita mesmo em pasta de teste
  });
  it('link simbólico/junção dentro da pasta: bloqueada com o motivo', () => {
    const result = audit({'a.js': '1', 'lib/real.js': '1'}, {}, {'/ext/lib': '/fora'});
    expect(result.verdict).toBe('bloqueada');
    expect(skipped(result)).toEqual(['lib: link simbólico ou junção não é permitido']);
    expect(audit({'a.js': '1'}, {}, {'/ext/a.js': '/fora/a.js'}).verdict).toBe('bloqueada');
  });
  it('world MAIN é só informação', () => {
    const result = audit({'a.js': '1'}, {content_scripts: [{matches: GAME, js: ['a.js'], world: 'MAIN'}]});
    expect(result.verdict).toBe('leitura');
    expect(result.findings).toEqual([{kind: 'info', file: 'manifest.json', detail: expect.stringContaining('MAIN')}]);
  });
});

describe('auditoria: CSS', () => {
  const css = (code: string, extra: Record<string, unknown> = {}) => audit({'a.js': '1', 's.css': code}, {content_scripts: [{matches: GAME, js: ['a.js'], css: ['s.css']}], ...extra});
  it('url(...) e @import para fora do jogo são rede (externa) com o host', () => {
    expect(css('a{background:url(https://x.example/i.png)}')).toMatchObject({verdict: 'externa', hosts: ['x.example']});
    expect(css("@import 'https://fonts.example.org/f.css'; a{}")).toMatchObject({verdict: 'externa', hosts: ['fonts.example.org']});
    expect(css('@import url("//cdn.example.net/x.css");')).toMatchObject({verdict: 'externa', hosts: ['cdn.example.net']});
    expect(css('a{background:url( "HTTP://User@Y.Example:8080/p" )}').hosts).toEqual(['y.example']);
  });
  it('url local, data:, do próprio jogo e comentários não contam', () => {
    expect(css('a{background:url(img/i.png)} b{background:url("data:image/png;base64,AAAA")} c{background:url(https://pokeidle.io/x.png)}').verdict).toBe('leitura');
    expect(css('/* url(https://x.example/i.png) */ a{color:red}').verdict).toBe('leitura');
  });
  it('css não citado no manifest também é auditado', () => {
    expect(audit({'a.js': '1', 'extra.css': 'a{background:url(https://z.example/i.png)}'}).hosts).toEqual(['z.example']);
  });
});

describe('auditoria: padrões de evasão', () => {
  const kinds = (code: string) => audit({'a.js': code}).findings.map(finding => `${finding.kind}:${finding.detail}`);
  it('atob e fromCharCode: ofuscação → interage, no mínimo', () => {
    const a = audit({'a.js': "const s = atob('ZmV0Y2g=')"});
    expect(a.verdict).toBe('interage');
    expect(a.findings).toEqual([{kind: 'obfuscation', file: 'a.js', detail: 'ofuscação: atob()'}]);
    expect(audit({'a.js': 'String.fromCharCode(102,101)'}).verdict).toBe('interage');
    expect(audit({'a.js': 'btn.click(); atob(x)'}).verdict).toBe('interage');
  });
  it('new Image() e .src = com URL ou variável contam como rede', () => {
    expect(audit({'a.js': "new Image().src = 'https://track.example/p.gif'"})).toMatchObject({verdict: 'externa', hosts: ['track.example']});
    expect(audit({'a.js': "const i = new Image(); i.src='https://t2.example/p'"}).hosts).toEqual(['t2.example']);
    expect(audit({'a.js': "const L = ['https://a.example/x']; img.src = pick(L)"})).toMatchObject({verdict: 'externa', hosts: ['a.example']}); // atribuição dinâmica: os endereços do arquivo contam
    expect(kinds("img.src = 'img/ok.png'")).toEqual(['fetch:.src =']);
    expect(audit({'a.js': "if (a.src == b) {}"}).findings).toEqual([]); // comparação não é atribuição
  });
  it('setTimeout/setInterval com texto e .constructor( são código dinâmico → bloqueada', () => {
    expect(audit({'a.js': "setTimeout('doIt()', 10)"}).verdict).toBe('bloqueada');
    expect(audit({'a.js': 'setInterval(`x()`, 10)'}).verdict).toBe('bloqueada');
    expect(audit({'a.js': 'setTimeout(() => 1, 10); setInterval(fn, 5)'}).verdict).toBe('leitura');
    expect(audit({'a.js': "[].constructor.constructor('return 1')()"}).verdict).toBe('bloqueada');
    expect(audit({'a.js': 'return new this.constructor(a)'}).verdict).toBe('leitura');
  });
  it("['fetch'], window['XMLHttpRequest'] e import() são achados; acesso por colchetes torna os links do arquivo rede", () => {
    expect(kinds("window['fetch']('/x')")).toContain("fetch:acesso por colchetes (['fetch'])");
    expect(audit({'a.js': "const u='https://h.example/x'; window[\"fetch\"](u)"})).toMatchObject({verdict: 'externa', hosts: ['h.example']});
    expect(audit({'a.js': "new window['WebSocket']('wss://w.example')"}).hosts).toEqual(['w.example']);
    expect(kinds("const m = await import('./mod.js')")).toEqual(['fetch:import()']);
    expect(audit({'a.js': "import('https://cdn.example.com/x.js')"})).toMatchObject({verdict: 'externa', hosts: ['cdn.example.com']});
    expect(audit({'a.js': "const u='https://h2.example/x'; import(u)"}).hosts).toEqual(['h2.example']);
  });
});

describe('privilégios do catálogo exigem o caminho real dentro da pasta de extensões do navegador', () => {
  const linux = {platform: 'linux', home: '/home/u'};
  const chrome = '/home/u/.config/google-chrome';
  const real = (path: string) => `${path}/manifest.json`;
  const inside = `${chrome}/Default/Extensions/${HUNT_ID}/1.0.17_0`;
  it('pasta legítima (Default e Profile N) recebe o id', () => {
    expect(catalogIdOf(inside, linux, fakeFs({[real(inside)]: '{}'}))).toBe(HUNT_ID);
    const profile = `${chrome}/Profile 3/Extensions/${SMART_MARKET_ID}/0.10.0_0`;
    expect(catalogIdOf(profile, linux, fakeFs({[real(profile)]: '{}'}))).toBe(SMART_MARKET_ID);
    const brave = `/home/u/.config/BraveSoftware/Brave-Browser/Default/Extensions/${HUNT_ID}/1.0.0_0`;
    expect(browserRoots(linux)).toContain('/home/u/.config/BraveSoftware/Brave-Browser');
    expect(catalogIdOf(brave, linux, fakeFs({[real(brave)]: '{}'}))).toBe(HUNT_ID);
  });
  it('mesmo nome de pasta em qualquer outro lugar: sem privilégio', () => {
    for (const spoof of [`/tmp/Extensions/${HUNT_ID}/1.0.17_0`, `/home/u/Downloads/${HUNT_ID}/1.0.17_0`, `${chrome}/Extensions/${HUNT_ID}/1.0.17_0`, `${chrome}/Default/Extensions/${HUNT_ID}`, `${chrome}/Profile x/Extensions/${HUNT_ID}/1.0_0`, `${chrome}/Default/Other/${HUNT_ID}/1.0_0`, `${chrome}/Default/Extensions/${HUNT_ID}/1.0_0/sub`]) {
      expect(catalogIdOf(spoof, linux, fakeFs({[real(spoof)]: '{}', [`${chrome}/Default/Extensions/x/manifest.json`]: '{}'}))).toBeNull();
    }
  });
  it('link no caminho legítimo que aponta para fora: sem privilégio; link de fora para a pasta do navegador vale pelo caminho real', () => {
    const fs = fakeFs({[real(inside)]: '{}', '/tmp/evil/manifest.json': '{}'}, {[inside]: '/tmp/evil'});
    expect(catalogIdOf(inside, linux, fs)).toBeNull();
    const outside = `/tmp/Extensions/${HUNT_ID}/1.0.17_0`;
    const toChrome = fakeFs({[real(outside)]: '{}', [real(inside)]: '{}'}, {[outside]: inside});
    expect(catalogIdOf(outside, linux, toChrome)).toBe(HUNT_ID); // o que vale é o caminho real: é a pasta do navegador mesmo
  });
  it('id do nome diferente do id real, fs sem realpath ou pasta inexistente: sem privilégio', () => {
    const swapped = `${chrome}/Default/Extensions/${SMART_MARKET_ID}/1.0.0_0`;
    expect(catalogIdOf(swapped, linux, fakeFs({[real(swapped)]: '{}', [real(inside)]: '{}'}, {[swapped]: inside}))).toBeNull();
    const noReal = fakeFs({[real(inside)]: '{}'}); delete noReal.realpathSync;
    expect(catalogIdOf(inside, linux, noReal)).toBeNull();
    expect(catalogIdOf(inside, linux, {...fakeFs({}), realpathSync() { throw new Error('ENOENT'); }})).toBeNull();
  });
});
