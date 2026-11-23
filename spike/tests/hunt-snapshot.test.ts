import { describe, expect, it, vi } from 'vitest';
import { HUNT_ALL_SCRIPT, HUNT_FULL_SCRIPT, HUNT_PROBE_SCRIPT, HUNT_UNAVAILABLE, huntSnapshot, sanitizeHuntSnapshot, sanitizeSprite, type HuntTarget } from '../electron/hunt-snapshot';

const row = {nome:'Caverna',regiao:'kanto',nivel:120,xpPorHora:1.5e6,abatesPorHora:1240.4,mataEm:1.2,ouroPorHora:82000,shinyPorHora:0.02,estimado:true,umHit:false,mortesPorHora:0,piorGolpe:0.12,liberada:true,sprite:null};
const raw = {estado:'ok',assinatura:'1|2',pokemon:{nome:'Bicho',nivel:142},bonus:{pokemon:1.5,treinador:1.5,itens:[{nome:'VIP',mult:1.5}]},hunts:[row],liberadas:42,total:120,versaoJogo:'1.380.0'};
const fail = {ok:false,error:HUNT_UNAVAILABLE};

describe('sanitização do retrato do /hunt', () => {
  it('aceita o formato esperado e não repassa campos extras', () => {
    const clean = sanitizeHuntSnapshot({...raw,token:'segredo',hunts:[{...row,hunt:{interno:true}}]},'1.0.17');
    expect(clean).toEqual({estado:'ok',pokemon:{nome:'Bicho',nivel:142,sprite:null},bonus:raw.bonus,hunts:[row],liberadas:42,total:120,filtro:{ordem:'xp',soLiberadas:true},versaoJogo:'1.380.0',versaoExtensao:'1.0.17'});
    expect(JSON.stringify(clean)).not.toContain('segredo');
  });
  it('recusa formas inesperadas', () => {
    for (const value of [null,undefined,'ok',42,[],{},{estado:'outro'},{...raw,hunts:'x'},{...raw,pokemon:null},{...raw,pokemon:{nome:7,nivel:1}},{...raw,pokemon:{nome:'A',nivel:NaN}}]) expect(sanitizeHuntSnapshot(value)).toBeNull();
    expect(sanitizeHuntSnapshot({estado:'sem-jogo',pokemon:{nome:'x'}})).toEqual({estado:'sem-jogo'});
  });
  it('descarta linhas com NaN, infinito, negativos ou tipos errados', () => {
    const hunts = [{...row,xpPorHora:NaN},{...row,ouroPorHora:Infinity},{...row,abatesPorHora:-1},{...row,nome:{}},{...row,nivel:'120'},null,'x',row];
    const clean = sanitizeHuntSnapshot({...raw,hunts});
    expect(clean?.estado === 'ok' && clean.hunts).toEqual([row]);
  });
  it('limita quantidade, tamanho de texto e grandezas', () => {
    const clean = sanitizeHuntSnapshot({...raw,pokemon:{nome:`  ${'n'.repeat(5000)}\u0000‮`,nivel:1e300},hunts:Array.from({length:5000},() => ({...row,nome:'x'.repeat(500),xpPorHora:1e300,shinyPorHora:NaN,regiao:5})),bonus:{pokemon:2,treinador:2,itens:Array.from({length:99},() => ({nome:'i'.repeat(99),mult:2}))},liberadas:NaN,versaoJogo:'v'.repeat(999)});
    if (clean?.estado !== 'ok') throw new Error('esperava ok');
    expect(clean.hunts).toHaveLength(60);
    expect(clean.hunts[0]).toMatchObject({nome:'x'.repeat(80),xpPorHora:1e15,shinyPorHora:null,regiao:''});
    expect(clean.pokemon).toEqual({nome:'n'.repeat(80),nivel:1e7,sprite:null});
    expect(clean.bonus?.itens).toHaveLength(8);
    expect(clean.bonus?.itens[0]?.nome).toHaveLength(40);
    expect(clean.liberadas).toBe(60);
    expect(clean.versaoJogo).toHaveLength(24);
  });
  it('bônus inválido vira ausência, não erro', () => {
    const clean = sanitizeHuntSnapshot({...raw,bonus:{pokemon:'2',treinador:2}});
    expect(clean?.estado === 'ok' && clean.bonus).toBeNull();
  });
});

describe('retrato da espécie (sprite)', () => {
  const art = {img:'/assets/asset-packs/outfits/male/25/outfits-male-25-00-0b5c4a4cb507.webp',x:206,y:2,w:32,h:32,pw:4094,ph:34};
  const url = `https://pokeidle.io${art.img}`;
  it('aceita caminho relativo ou URL https do próprio jogo e descarta campos extras', () => {
    expect(sanitizeSprite(art)).toEqual({url,x:206,y:2,w:32,h:32});
    expect(sanitizeSprite({...art,img:url})).toEqual({url,x:206,y:2,w:32,h:32});
  });
  it('recusa outra origem, http, javascript:, data:, credenciais, path traversal e URL longa', () => {
    const bad = ['https://evil.example/a.png','//evil.example/a.png','https://pokeidle.io.evil.example/a.png','https://pokeidle.io@evil.example/a.png','https://user:senha@pokeidle.io/a.png','https://pokeidle.io:8443/a.png',
      'http://pokeidle.io/a.png','javascript:alert(1)','data:image/png;base64,AAAA',`data:image/png;base64,${'A'.repeat(70000)}`,'file:///etc/passwd','blob:https://pokeidle.io/x',
      '/assets/../../app/secret.png','/assets/%2e%2e/x.png','/assets/%2E%2E%2fx.png','\\\\evil.example\\a.png','/a b.png','/a\n.png',`/${'a'.repeat(300)}.png`,'',7,null];
    for (const img of bad) expect(sanitizeSprite({...art,img})).toBeNull();
  });
  it('recusa janela fora da faixa ou de tipo errado', () => {
    for (const patch of [{x:-1},{y:1.5},{w:0},{h:9999},{w:'32'},{x:NaN},{h:Infinity}]) expect(sanitizeSprite({...art,...patch})).toBeNull();
    for (const value of [null,'x',[],{}]) expect(sanitizeSprite(value)).toBeNull();
  });
  it('busca só looktypes válidos, uma vez, e segue sem imagem quando a busca falha', async () => {
    const full = {...raw,pokemon:{...raw.pokemon,look:25},hunts:[{...row,look:26},{...row,nome:'B',look:'27'},{...row,nome:'C',look:-3},{...row,nome:'D',look:25}]};
    const run = async (script: string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:String(Math.random())} : full;
    const base = {url:'https://pokeidle.io/app',hasExtension:true,version:null,run};
    const down = await huntSnapshot('s',['s'],() => ({...base,sprites:async () => { throw new Error('rede'); }}));
    expect(down.ok && down.data.estado === 'ok' && down.data.hunts.map(item => item.sprite)).toEqual([null,null,null,null]);
    const sprites = vi.fn(async () => ({retratos:{25:art,26:{...art,img:'https://evil.example/x.png'}}}));
    const first = await huntSnapshot('s',['s'],() => ({...base,sprites}));
    if (!first.ok || first.data.estado !== 'ok') throw new Error('esperava ok');
    expect(sprites).toHaveBeenCalledWith([25,26]);
    expect(first.data.pokemon.sprite).toEqual({url,x:206,y:2,w:32,h:32});
    expect(first.data.hunts.map(item => item.sprite?.url ?? null)).toEqual([null,null,null,url]);
    expect(JSON.stringify(first.data)).not.toMatch(/evil|look|"pw"/);
    await huntSnapshot('s',['s'],() => ({...base,sprites}));
    expect(sprites).toHaveBeenLastCalledWith([26]); // o 25 ficou em cache; o recusado é pedido de novo
  });
});

describe('leitura do retrato', () => {
  const target = (run: HuntTarget['run'], extra: Partial<HuntTarget> = {}) => (): HuntTarget => ({url:'https://pokeidle.io/app',hasExtension:true,version:'1.0.17',run,...extra});
  it('rejeita id inválido ou desconhecido e conta sem sessão, sem executar nada', async () => {
    const run = vi.fn();
    for (const id of [undefined,null,7,{},'x',"a';alert(1)//"]) expect(await huntSnapshot(id,['a'],target(run))).toEqual(fail);
    expect(await huntSnapshot('a',['a'],() => null)).toEqual(fail);
    expect(await huntSnapshot('a',['a'],() => { throw new Error('view destruída'); })).toEqual(fail);
    expect(run).not.toHaveBeenCalled();
  });
  it('não executa script sem a extensão nem fora do site do jogo', async () => {
    const run = vi.fn();
    expect(await huntSnapshot('a',['a'],target(run,{hasExtension:false}))).toEqual({ok:true,data:{estado:'sem-extensao'}});
    for (const url of ['https://accounts.google.com/o/oauth2','https://pokeidle.io.evil.example/app','about:blank','']) expect(await huntSnapshot('a',['a'],target(run,{url}))).toEqual({ok:true,data:{estado:'sem-jogo'}});
    expect(run).not.toHaveBeenCalled();
  });
  it('só executa os dois scripts fixos e reaproveita o cálculo enquanto a assinatura não muda', async () => {
    const run = vi.fn(async (script: string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'s1'} : raw);
    const first = await huntSnapshot('cache',['cache'],target(run));
    expect(first.ok && first.data.estado).toBe('ok');
    expect(await huntSnapshot('cache',['cache'],target(run))).toEqual(first);
    expect(run.mock.calls.map(call => call[0])).toEqual([HUNT_PROBE_SCRIPT,HUNT_FULL_SCRIPT,HUNT_PROBE_SCRIPT]);
    run.mockImplementation(async (script: string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'s2'} : raw);
    await huntSnapshot('cache',['cache'],target(run));
    expect(run).toHaveBeenCalledTimes(5);
  });
  it('"só liberadas" precisa ser booleano e escolhe entre dois scripts fixos, com cache separado', async () => {
    const run = vi.fn(async (script: string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'s1'} : {...raw,soLiberadas:script === HUNT_FULL_SCRIPT});
    for (const flag of ['false',0,null,{},'true;alert(1)']) expect(await huntSnapshot('f',['f'],target(run),8000,flag)).toEqual(fail);
    expect(run).not.toHaveBeenCalled();
    const all = await huntSnapshot('f',['f'],target(run),8000,false), only = await huntSnapshot('f',['f'],target(run),8000,true);
    expect(all.ok && all.data.estado === 'ok' && all.data.filtro.soLiberadas).toBe(false);
    expect(only.ok && only.data.estado === 'ok' && only.data.filtro.soLiberadas).toBe(true);
    expect(run.mock.calls.map(call => call[0])).toEqual([HUNT_PROBE_SCRIPT,HUNT_ALL_SCRIPT,HUNT_PROBE_SCRIPT,HUNT_FULL_SCRIPT]);
    expect(HUNT_ALL_SCRIPT).toBe(HUNT_FULL_SCRIPT.replaceAll('soLiberadas:true','soLiberadas:false').replaceAll('soLiberadas: true','soLiberadas: false'));
  });
  it('estado sem jogo ou sem pokémon vem da sondagem, sem cálculo', async () => {
    const run = vi.fn(async () => ({estado:'sem-pokemon',extra:1}));
    expect(await huntSnapshot('b',['b'],target(run))).toEqual({ok:true,data:{estado:'sem-pokemon'}});
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('erro, retorno malformado e tempo esgotado viram indisponível', async () => {
    expect(await huntSnapshot('c',['c'],target(async () => { throw new Error('falhou'); }))).toEqual(fail);
    expect(await huntSnapshot('c',['c'],target(async () => 'texto'))).toEqual(fail);
    expect(await huntSnapshot('c',['c'],target(async () => ({estado:'ok',assinatura:7})))).toEqual(fail);
    expect(await huntSnapshot('c',['c'],target(async script => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'z'} : {estado:'ok',hunts:[{}]}))).toEqual(fail);
    expect(await huntSnapshot('c',['c'],target(() => new Promise(() => {})),20)).toEqual(fail);
  });
  it('faz uma leitura por conta de cada vez', async () => {
    let release: (value: unknown) => void = () => {};
    const run = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const one = huntSnapshot('d',['d'],target(run)), two = huntSnapshot('d',['d'],target(run));
    release({estado:'sem-jogo'});
    expect(await one).toEqual(await two);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('não reutiliza um retrato quando a sessão de uma conta é reaberta', async () => {
    const firstSession = {}, secondSession = {};
    const readFirst = vi.fn(async (script:string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'mesma'} : {...raw,pokemon:{nome:'Primeiro',nivel:10}});
    const readSecond = vi.fn(async (script:string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'mesma'} : {...raw,pokemon:{nome:'Segundo',nivel:10}});
    const first = await huntSnapshot('reaberta',['reaberta'],target(readFirst,{identity:firstSession}));
    const second = await huntSnapshot('reaberta',['reaberta'],target(readSecond,{identity:secondSession}));
    expect(first.ok && first.data.estado === 'ok' && first.data.pokemon.nome).toBe('Primeiro');
    expect(second.ok && second.data.estado === 'ok' && second.data.pokemon.nome).toBe('Segundo');
    expect(readSecond).toHaveBeenCalledWith(HUNT_FULL_SCRIPT);
  });
  it('mantém leituras de contas diferentes independentes mesmo com assinaturas iguais', async () => {
    const make = (name:string) => target(async script => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'igual'} : {...raw,pokemon:{nome:name,nivel:10}});
    const first = await huntSnapshot('conta1',['conta1','conta2'],make('Primeiro'));
    const second = await huntSnapshot('conta2',['conta1','conta2'],make('Segundo'));
    expect(first.ok && first.data.estado === 'ok' && first.data.pokemon.nome).toBe('Primeiro');
    expect(second.ok && second.data.estado === 'ok' && second.data.pokemon.nome).toBe('Segundo');
  });
  it('ignora uma leitura anterior que termina depois da sessão ser reaberta', async () => {
    let finishOld: (value:unknown) => void = () => {};
    const oldSession = {}, newSession = {};
    const oldRead = vi.fn((script:string) => script === HUNT_PROBE_SCRIPT ? Promise.resolve({estado:'ok',assinatura:'igual'}) : new Promise(resolve => {finishOld = resolve;}));
    const newRead = vi.fn(async (script:string) => script === HUNT_PROBE_SCRIPT ? {estado:'ok',assinatura:'igual'} : {...raw,pokemon:{nome:'Atual',nivel:10}});
    const pending = huntSnapshot('troca',['troca'],target(oldRead,{identity:oldSession}));
    await vi.waitFor(() => expect(oldRead).toHaveBeenCalledWith(HUNT_FULL_SCRIPT));
    const current = await huntSnapshot('troca',['troca'],target(newRead,{identity:newSession}));
    finishOld({...raw,pokemon:{nome:'Antigo',nivel:10}});
    await pending;
    const again = await huntSnapshot('troca',['troca'],target(newRead,{identity:newSession}));
    expect(current.ok && current.data.estado === 'ok' && current.data.pokemon.nome).toBe('Atual');
    expect(again).toEqual(current);
  });
  it('os scripts são somente leitura: sem storage, cookies, rede ou escrita no DOM', () => {
    for (const script of [HUNT_PROBE_SCRIPT,HUNT_FULL_SCRIPT,HUNT_ALL_SCRIPT]) {
      expect(script).not.toMatch(/localStorage|sessionStorage|cookie|indexedDB|fetch\(|XMLHttpRequest|WebSocket|innerHTML|\.click\(|postMessage|\$\{/);
      expect(() => new Function(`return ${script}`)).not.toThrow();
    }
  });
});
