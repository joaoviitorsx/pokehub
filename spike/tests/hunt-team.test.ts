import { afterEach, describe, expect, it, vi } from 'vitest';
import { HUNT_UNAVAILABLE, type HuntTarget } from '../electron/hunt-snapshot';
import { huntTeam, sanitizeHuntTeam, TEAM_FULL_SCRIPT, TEAM_PROBE_SCRIPT, TEAM_WAIT } from '../electron/hunt-team';

const block = {hp:20,atk:31,def:5,spAtk:1,spDef:12,speed:30};
const hunt = {nome:'Caverna',regiao:'kanto',xpPorHora:1.5e6,ouroPorHora:82000,abatesPorHora:1240.4,estimado:true};
const member = {chave:'77',ativo:true,nome:'Bicho',nivel:142,potencia:3,tipos:['FIRE','FLYING'],ivs:block,stats:{...block,hp:900},look:6,hunts:[hunt]};
const raw = {estado:'ok',assinatura:'a',membros:[member],total:1,versaoJogo:'1.380.0'};
const target = (run: HuntTarget['run'], extra: Partial<HuntTarget> = {}): HuntTarget => ({url:'https://pokeidle.io/app',hasExtension:true,version:'1.0.17',run,...extra});
const page = (signature = 'a', full: unknown = raw) => vi.fn(async (script: string) => script === TEAM_PROBE_SCRIPT ? {estado:'ok',assinatura:signature} : full);
afterEach(() => vi.useRealTimers());

describe('sanitização da equipe do /hunt', () => {
  it('aceita o formato esperado e descarta campos extras', () => {
    const sprite = {url:'https://pokeidle.io/assets/a.webp',x:0,y:0,w:32,h:32};
    const clean = sanitizeHuntTeam({...raw,token:'segredo',membros:[{...member,segredo:1,hunts:[{...hunt,interno:{}}]}]},'1.0.17',new Map([[6,sprite]]),123);
    expect(clean).toEqual({estado:'ok',membros:[{chave:'77',ativo:true,nome:'Bicho',nivel:142,potencia:3,tipos:['FIRE','FLYING'],ivs:block,stats:{...block,hp:900},sprite,hunts:[hunt]}],total:1,lidoEm:123,versaoJogo:'1.380.0',versaoExtensao:'1.0.17'});
    expect(JSON.stringify(clean)).not.toContain('segredo');
  });
  it('recusa formas inesperadas e repassa estados sem dados', () => {
    for (const value of [null,'ok',[],{},{estado:'outro'},{...raw,membros:'x'},{...raw,membros:[]},{...raw,membros:[{...member,chave:null}]},{...raw,membros:[{...member,nivel:NaN}]}]) expect(sanitizeHuntTeam(value)).toBeNull();
    expect(sanitizeHuntTeam({estado:'sem-pokemon',membros:[member]})).toEqual({estado:'sem-pokemon'});
  });
  it('limita membros, hunts, textos e não presume potência nem IV', () => {
    const many = Array.from({length:40},(_item,i) => ({...member,chave:String(i),nome:`${'n'.repeat(500)}\u0000`,potencia:9,tipos:['A','B','C','D',7],ivs:{hp:-1,atk:1.5,def:'9',spAtk:NaN,spDef:Infinity,speed:40},stats:null,hunts:[...Array.from({length:500},() => hunt),{...hunt,xpPorHora:NaN},null]}));
    const clean = sanitizeHuntTeam({...raw,membros:[...many,member],total:1e99});
    if (clean?.estado !== 'ok') throw new Error('esperava ok');
    expect(clean.membros).toHaveLength(6);
    expect(clean.membros[0]).toMatchObject({nome:'n'.repeat(60),potencia:null,tipos:['A','B','C'],stats:null,ivs:{hp:null,atk:null,def:null,spAtk:null,spDef:null,speed:40}});
    expect(clean.membros[0]!.hunts).toHaveLength(120);
    expect(clean.total).toBe(6);
  });
  it('ignora Pokémon repetido e ficha sem nenhum atributo válido', () => {
    const clean = sanitizeHuntTeam({...raw,membros:[member,member,{...member,chave:'78',nome:7,ivs:{hp:'x'}}]});
    expect(clean?.estado === 'ok' && clean.membros.map(item => [item.chave,item.nome,item.ivs])).toEqual([['77','Bicho',block],['78','Pokémon',null]]);
  });
});

describe('leitura da equipe', () => {
  const known = ['a','b','c','d','e','f'];
  it('só usa scripts constantes e não executa fora do jogo, sem extensão ou para conta desconhecida', async () => {
    const run = page();
    expect(await huntTeam('x',known,() => target(run))).toEqual({ok:false,error:HUNT_UNAVAILABLE});
    expect(await huntTeam(7,known,() => target(run))).toEqual({ok:false,error:HUNT_UNAVAILABLE});
    expect(await huntTeam('a',known,() => null)).toEqual({ok:false,error:HUNT_UNAVAILABLE});
    expect(await huntTeam('a',known,() => target(run,{hasExtension:false}))).toEqual({ok:true,data:{estado:'sem-extensao'}});
    expect(await huntTeam('a',known,() => target(run,{url:'https://accounts.google.com/x'}))).toEqual({ok:true,data:{estado:'sem-jogo'}});
    expect(run).not.toHaveBeenCalled();
    const result = await huntTeam('a',known,() => target(run));
    expect(result.ok && result.data.estado).toBe('ok');
    expect(run.mock.calls.map(call => call[0])).toEqual([TEAM_PROBE_SCRIPT,TEAM_FULL_SCRIPT]);
    expect(TEAM_FULL_SCRIPT).not.toMatch(/cookie|localStorage|fetch\(/);
  });
  it('calcula no máximo uma vez a cada 60 s por conta e reaproveita a equipe igual', async () => {
    vi.useFakeTimers({now:1_000_000});
    const run = page(), identity = {};
    const first = await huntTeam('b',known,() => target(run,{identity}));
    expect(await huntTeam('b',known,() => target(run,{identity}))).toEqual(first); // dentro do minuto: nada roda na página
    expect(run).toHaveBeenCalledTimes(2);
    vi.setSystemTime(1_000_000 + 61_000);
    expect(await huntTeam('b',known,() => target(run,{identity}))).toEqual(first); // mesma assinatura: só a sondagem
    expect(run.mock.calls.map(call => call[0])).toEqual([TEAM_PROBE_SCRIPT,TEAM_FULL_SCRIPT,TEAM_PROBE_SCRIPT]);
    const changed = page('outra');
    const again = await huntTeam('b',known,() => target(changed,{identity}));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(again.ok && again.data.estado === 'ok' && again.data.lidoEm).toBe(1_061_000);
  });
  it('sessão reaberta dentro do minuto não reaproveita a anterior nem recalcula', async () => {
    vi.useFakeTimers({now:5_000_000});
    const run = page();
    await huntTeam('c',known,() => target(run,{identity:{}}));
    expect(await huntTeam('c',known,() => target(run,{identity:{}}))).toEqual({ok:false,error:TEAM_WAIT});
    expect(run.mock.calls.map(call => call[0])).toEqual([TEAM_PROBE_SCRIPT,TEAM_FULL_SCRIPT,TEAM_PROBE_SCRIPT]);
  });
  it('erro, formato estranho e leituras simultâneas', async () => {
    expect(await huntTeam('d',known,() => target(async () => { throw new Error('x'); }))).toEqual({ok:false,error:HUNT_UNAVAILABLE});
    expect(await huntTeam('e',known,() => target(page('a',{estado:'ok',membros:'x'})))).toEqual({ok:false,error:HUNT_UNAVAILABLE});
    const run = page();
    const [one,two] = await Promise.all([huntTeam('f',known,() => target(run)),huntTeam('f',known,() => target(run))]);
    expect(one).toBe(two);
    expect(run).toHaveBeenCalledTimes(2);
    const sprites = vi.fn(async () => { throw new Error('rede'); });
    vi.useFakeTimers({now:9_000_000_000});
    const result = await huntTeam('d',known,() => target(page(),{sprites}));
    expect(result.ok && result.data.estado === 'ok' && result.data.membros[0]?.sprite).toBeNull();
  });
});
