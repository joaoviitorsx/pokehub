import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMeasure, LIVE_INSTALL_SCRIPT, LIVE_POLL_MS, LIVE_READ_SCRIPT, LIVE_STOP_SCRIPT, sanitizeLiveRead } from '../electron/live-measure';
import { GrindolinoError } from '../domain/grindolino';
import type { Hunt, Measurement } from '../contracts/grindolino';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const kill = (name = 'Sunkern') => `${name} derrotado! +100 xp treinador, +50 xp pokemon, +10 ouro`;
const MIN = 60_000;

// Página falsa: responde aos três scripts fixos como a página do jogo responderia.
function page() {
  const state = {id:'p1',seq:0,lines:[] as string[],slug:null as string|null,pokemon:{key:'77',nome:'Sunflora',nivel:120} as unknown,installed:false,url:'https://pokeidle.io/app',fail:false,scripts:[] as string[]};
  const run = async (script: string) => {
    state.scripts.push(script);
    if (state.fail) throw new Error('sem resposta');
    if (script === LIVE_INSTALL_SCRIPT) { state.installed = true; state.seq = 0; state.lines = []; return {estado:'ok',id:state.id,seq:0,slug:null,lines:[],pokemon:state.pokemon}; }
    if (script === LIVE_STOP_SCRIPT) { state.installed = false; return true; }
    if (script !== LIVE_READ_SCRIPT) throw new Error('script desconhecido');
    return state.installed ? {estado:'ok',id:state.id,seq:state.seq,slug:state.slug,lines:state.lines.splice(0),pokemon:state.pokemon} : {estado:'ausente'};
  };
  return {state, push:(...lines: string[]) => { state.seq += lines.length; state.lines.push(...lines); }, target:() => ({url:state.url,run})};
}
function setup(accounts = [uuid(1)]) {
  const pages = new Map(accounts.map(id => [id,page()]));
  const hunts: Hunt[] = [], saved: Record<string,unknown>[] = [];
  const store = {
    listHunts: () => hunts,
    createHunt: (input: unknown) => { const hunt = {...(input as Pick<Hunt,'name'|'region'|'requiredTrainerLevel'>),id:uuid(100 + hunts.length),createdAt:'x'}; hunts.push(hunt); return hunt; },
    addMeasurement: (input: unknown) => { saved.push(input as Record<string,unknown>); return {...(input as object),id:uuid(900),recordedAt:'x'} as Measurement; },
  };
  const live = new LiveMeasure({accounts:() => accounts, target:id => pages.get(id)?.target() ?? null, store, now:() => Date.now()});
  return {live, pages, hunts, saved, first:pages.get(accounts[0]!)!};
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('scripts de página', () => {
 it('são constantes, sintaticamente válidos e somente leitura', () => {
  for (const script of [LIVE_INSTALL_SCRIPT,LIVE_READ_SCRIPT,LIVE_STOP_SCRIPT]) {
   expect(() => new Function(`return ${script}`)).not.toThrow();
   expect(script).not.toMatch(/fetch|XMLHttpRequest|WebSocket|cookie|localStorage|sessionStorage|indexedDB|\.click\(|dispatchEvent|innerHTML|appendChild|setAttribute|\.send\(|eval\(/);
  }
 });
});

describe('sanitização da leitura', () => {
 it('aceita só o formato esperado e limpa textos', () => {
  expect(sanitizeLiveRead({estado:'ausente',x:1})).toEqual({estado:'ausente'});
  expect(sanitizeLiveRead({estado:'ok',id:'abc1',seq:2,slug:' sunkern-200\u0000 ',lines:['a‮b',7,'x'.repeat(500)],pokemon:{key:77,nome:'Sunflora'},extra:1}))
   .toEqual({estado:'ok',id:'abc1',seq:2,slug:'sunkern-200',lines:['ab','x'.repeat(240)],pokemon:null});
  expect(sanitizeLiveRead({estado:'ok',id:'abc1',seq:0,slug:null,lines:[],pokemon:{key:'77',nome:7,nivel:1.5}})).toMatchObject({pokemon:{key:'77',name:null,level:null}});
  for (const bad of [null,'x',[],{estado:'ok'},{estado:'ok',id:'A B',seq:0,lines:[]},{estado:'ok',id:'a',seq:-1,lines:[]},{estado:'ok',id:'a',seq:Infinity,lines:[]},{estado:'ok',id:'a',seq:0,lines:'x'},{estado:'ok',id:'a',seq:0,lines:Array(2001).fill('x')}]) expect(sanitizeLiveRead(bad)).toBeNull();
 });
});

describe('medição ao vivo', () => {
 it('mede, vincula a hunt pelo nome e grava XP do pokémon, ouro, abates, shinies e o Pokémon', async () => {
  const {live, first, hunts, saved} = setup();
  hunts.push({id:uuid(50),name:' sunkern ',region:'Johto',requiredTrainerLevel:200,createdAt:'x'});
  expect((await live.start(uuid(1),null)).active).toMatchObject([{accountId:uuid(1),huntName:null,totals:{kills:0},pokemon:{key:'77',name:'Sunflora',level:120}}]);
  first.push(kill(),kill(),'Sunkern Nv200 escapou e sumiu','capturado: Shiny Sunkern Nv40 (q1.397)');
  first.state.pokemon = {key:'77',nome:'Sunflora',nivel:121};
  await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().active[0]).toMatchObject({huntName:'Sunkern',totals:{kills:2,trainerXp:200,pokemonXp:100,coins:20,captures:1,shinies:1},lostLines:0});
  await vi.advanceTimersByTimeAsync(10 * MIN - LIVE_POLL_MS);
  first.push(kill());
  const status = await live.stop(uuid(1));
  expect(status.active).toEqual([]);
  expect(status.ended).toMatchObject([{accountId:uuid(1),reason:'user',huntName:'Sunkern',notice:'Medição gravada: 10 min em Sunkern.'}]);
  expect(saved).toEqual([{accountId:uuid(1),huntId:uuid(50),minutes:10,xpGained:150,coinsGained:30,killCount:3,shinyCount:1,pokemonKey:'77',pokemonName:'Sunflora',pokemonLevel:120,pokemonLevelEnd:121}]);
  expect(first.state.installed).toBe(false); // o observador sai da página
  const calls = first.state.scripts.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(first.state.scripts.length).toBe(calls); // sem medição ativa, nenhuma leitura
 });
 it('cria a hunt quando não existe e respeita a hunt escolhida', async () => {
  const {live, first, hunts, saved} = setup();
  await live.start(uuid(1),null); first.push(kill('Mr. Mime'));
  await vi.advanceTimersByTimeAsync(2 * MIN); await live.stop(uuid(1));
  expect(hunts).toMatchObject([{name:'Mr. Mime',region:'',requiredTrainerLevel:null}]);
  await live.start(uuid(1),hunts[0]!.id); first.push(kill('Sunkern'));
  await vi.advanceTimersByTimeAsync(2 * MIN); await live.stop(uuid(1));
  expect(hunts.length).toBe(1);
  expect(saved.map(item => item.huntId)).toEqual([hunts[0]!.id,hunts[0]!.id]);
 });
 it('não grava sem abate nem com menos de 1 minuto', async () => {
  const {live, first, saved} = setup();
  await live.start(uuid(1),null); await vi.advanceTimersByTimeAsync(5 * MIN);
  expect((await live.stop(uuid(1))).ended[0]).toMatchObject({measurement:null,notice:'Nenhum abate foi lido do log do jogo; nada foi gravado.'});
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(20_000);
  expect((await live.stop(uuid(1))).ended[0]).toMatchObject({measurement:null,notice:'Medição com menos de 1 minuto; nada foi gravado.'});
  expect(saved).toEqual([]);
 });
 it('recusa conta desconhecida, hunt inexistente, conta sem sessão, página de outro site e medição duplicada', async () => {
  const {live, first} = setup([uuid(1),uuid(2)]);
  await expect(live.start('x',null)).rejects.toThrow(GrindolinoError);
  await expect(live.start(uuid(1),'x')).rejects.toThrow('Hunt inválida');
  await expect(live.start(uuid(1),uuid(77))).rejects.toThrow('Hunt não encontrada');
  await expect(live.stop(uuid(1))).rejects.toThrow('não está em medição');
  first.state.url = 'https://accounts.google.com/o/oauth2';
  await expect(live.start(uuid(1),null)).rejects.toThrow('Abra o jogo');
  expect(first.state.scripts).toEqual([]); // nada é executado fora do jogo
  first.state.url = 'https://pokeidle.io/app';
  const both = [live.start(uuid(1),null),live.start(uuid(1),null)];
  await expect(both[1]).rejects.toThrow('já está em medição'); await both[0];
  await expect(live.start(uuid(1),null)).rejects.toThrow('já está em medição');
  live.dispose();
 });
 it('limita a 4 medições ativas', async () => {
  const ids = [1,2,3,4,5].map(uuid);
  const {live} = setup(ids);
  for (const id of ids.slice(0,4)) await live.start(id,null);
  await expect(live.start(ids[4]!,null)).rejects.toThrow('No máximo 4');
  live.dispose();
 });
 it('encerra com parcial quando a hunt muda (slug da extensão ou espécie do log)', async () => {
  const {live, first, saved} = setup();
  await live.start(uuid(1),null); first.push(kill()); first.state.slug = 'sunkern-200';
  await vi.advanceTimersByTimeAsync(3 * MIN);
  first.state.slug = 'hoppip-210'; first.push(kill('Hoppip'));
  await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status()).toMatchObject({active:[],ended:[{reason:'hunt',notice:'A hunt mudou. Medição parcial gravada: 3 min em Sunkern.'}]});
  expect(saved).toMatchObject([{minutes:3,killCount:1}]); // o abate da hunt nova não entra
  await live.start(uuid(1),null); first.state.slug = null; first.push(kill());
  await vi.advanceTimersByTimeAsync(2 * MIN);
  first.push(kill('Hoppip'),kill()); await vi.advanceTimersByTimeAsync(LIVE_POLL_MS); // espécie diferente no meio não encerra
  expect(live.status().active[0]?.totals.kills).toBe(3);
  first.push(kill('Hoppip'),kill('Hoppip'),kill('Hoppip')); await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().ended[0]).toMatchObject({reason:'hunt'});
  expect(saved[1]).toMatchObject({killCount:3});
 });
 it('encerra com parcial quando o Pokémon em campo muda', async () => {
  const {live, first, saved} = setup();
  await live.start(uuid(1),null); first.push(kill());
  await vi.advanceTimersByTimeAsync(4 * MIN);
  first.state.pokemon = {key:'78',nome:'Bellossom',nivel:90}; first.push(kill());
  await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().ended[0]).toMatchObject({reason:'pokemon',notice:'O Pokémon em campo mudou. Medição parcial gravada: 4 min em Sunkern.'});
  expect(saved).toMatchObject([{killCount:1,pokemonKey:'77',pokemonLevel:120,pokemonLevelEnd:120}]);
 });
 it('encerra com parcial quando a página recarrega, o contador anda para trás ou a sessão para de responder', async () => {
  const {live, first, saved} = setup();
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(2 * MIN);
  first.state.installed = false; await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().ended[0]).toMatchObject({reason:'session',notice:'A sessão caiu ou a página do jogo recarregou. Medição parcial gravada: 2 min em Sunkern.'});
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(2 * MIN);
  first.state.id = 'p2'; await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().active).toEqual([]);
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(2 * MIN);
  first.state.seq = 0; await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().active).toEqual([]);
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(2 * MIN);
  first.state.fail = true; await vi.advanceTimersByTimeAsync(2 * LIVE_POLL_MS);
  expect(live.status().active.length).toBe(1); // duas falhas ainda são toleradas
  first.state.fail = false; first.push(kill()); await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  expect(live.status().active[0]?.totals.kills).toBe(2);
  first.state.fail = true; await vi.advanceTimersByTimeAsync(3 * LIVE_POLL_MS);
  expect(live.status().active).toEqual([]);
  expect(saved.map(item => [item.minutes,item.killCount])).toEqual([[2,1],[2,1],[2,1],[2,2]]);
 });
 it('conta linhas perdidas e avisa', async () => {
  const {live, first} = setup();
  await live.start(uuid(1),null); first.push(kill()); first.state.seq += 5; // a página contou 5 linhas que não couberam na fila
  await vi.advanceTimersByTimeAsync(2 * MIN);
  expect(live.status().active[0]?.lostLines).toBe(5);
  expect((await live.stop(uuid(1))).ended[0]?.notice).toContain('Parte do log não foi lida');
 });
 it('para sozinha em 12 h e grava ao fechar o aplicativo', async () => {
  const {live, first, saved} = setup([uuid(1),uuid(2)]);
  await live.start(uuid(1),null); first.push(kill());
  await vi.advanceTimersByTimeAsync(12 * 60 * MIN + LIVE_POLL_MS);
  expect(live.status().ended[0]).toMatchObject({reason:'limit',notice:'Limite de 12 h atingido. Medição gravada: 720 min em Sunkern.'});
  await live.start(uuid(1),null); first.push(kill()); await vi.advanceTimersByTimeAsync(3 * MIN);
  live.dispose();
  expect(saved.map(item => item.minutes)).toEqual([720,3]);
  expect(live.status().active).toEqual([]);
 });
});
