import { describe, expect, it } from 'vitest';
import { compareAccounts, GrindolinoError, parseCompareRequest, parseForecastInput, parseHuntInput, parseId, parseMeasurementInput, parseRankRequest, rankHunts } from '../domain/grindolino';
import type { Forecast, Hunt, Measurement } from '../contracts/grindolino';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const account = uuid(1), other = uuid(2);
const hunt = (n: number, name: string, requiredTrainerLevel: number | null = 1): Hunt => ({id:uuid(100+n),name,region:'',requiredTrainerLevel,createdAt:'2026-11-10T00:00:00.000Z'});
const forecast = (h: Hunt, xpPerHour: number | null, coinsPerHour: number | null, readAt = '2026-11-10T00:00:00.000Z', accountId = account): Forecast => ({id:uuid(1),accountId,huntId:h.id,xpPerHour,coinsPerHour,readAt});
const measurement = (h: Hunt, minutes: number, xpGained: number | null, coinsGained: number | null, accountId = account): Measurement => ({id:uuid(1),accountId,huntId:h.id,minutes,xpGained,coinsGained,killCount:null,shinyCount:null,pokemonKey:null,pokemonName:null,pokemonLevel:null,pokemonLevelEnd:null,recordedAt:'2026-11-10T00:00:00.000Z'});
const request = {accountId:account,objective:'xp' as const,trainerLevel:100};

describe('abates e shinies observados', () => {
 it('calcula as taxas só com as medições que informaram a contagem', () => {
  const a = hunt(1,'A');
  const live = {...measurement(a,30,600,null),killCount:100,shinyCount:1}, typed = measurement(a,90,600,null);
  const [row] = rankHunts([a],[],[live,typed],request);
  expect(row?.observed).toEqual({xpPerHour:600,coinsPerHour:null,killsPerHour:200,shinyPerHour:2,samples:2,totalMinutes:120});
  expect(compareAccounts([a],[],[live,typed],[account],'xp')[0]?.cells[0]).toMatchObject({observedPerHour:600,killsPerHour:200,shinyPerHour:2});
  expect(parseMeasurementInput({accountId:account,huntId:other,minutes:5,xpGained:1,coinsGained:null,killCount:3,shinyCount:0,pokemonKey:' 77 ',pokemonName:'Sunflora',pokemonLevel:120,pokemonLevelEnd:121})).toMatchObject({killCount:3,shinyCount:0,pokemonKey:'77',pokemonName:'Sunflora',pokemonLevel:120,pokemonLevelEnd:121});
  for (const bad of [{killCount:-1},{shinyCount:1.5},{killCount:'3'},{pokemonKey:''},{pokemonKey:'x'.repeat(41)},{pokemonName:7},{pokemonLevel:0}]) expect(() => parseMeasurementInput({accountId:account,huntId:other,minutes:5,xpGained:1,coinsGained:null,...bad})).toThrow(GrindolinoError);
 });
});

describe('ranking do Grindolino', () => {
 it('usa a previsão mais recente da conta e ignora outras contas', () => {
  const a = hunt(1,'A');
  const [row] = rankHunts([a],[forecast(a,100,5,'2026-11-01T00:00:00.000Z'),forecast(a,300,7,'2026-11-09T00:00:00.000Z'),forecast(a,200,6,'2026-11-05T00:00:00.000Z'),forecast(a,999,9,'2026-12-01T00:00:00.000Z',other)],[measurement(a,60,5000,null,other)],request);
  expect(row).toMatchObject({forecast:{xpPerHour:300,coinsPerHour:7,readAt:'2026-11-09T00:00:00.000Z'},observed:null,sortValue:300,sortSource:'forecast',deltaRatio:null,eligible:true,warnings:[]});
 });
 it('calcula o observado por métrica só com as medições que a informam', () => {
  const a = hunt(1,'A');
  const [row] = rankHunts([a],[forecast(a,1000,null)],[measurement(a,30,600,null),measurement(a,30,600,300),measurement(a,60,null,300)],request);
  expect(row?.observed).toEqual({xpPerHour:1200,coinsPerHour:400,killsPerHour:null,shinyPerHour:null,samples:3,totalMinutes:120});
  expect(row).toMatchObject({sortValue:1200,sortSource:'observed',warnings:[]});
  expect(row?.deltaRatio).toBeCloseTo(0.2);
  const [coins] = rankHunts([a],[forecast(a,1000,null)],[measurement(a,60,null,300)],{...request,objective:'coins'});
  expect(coins).toMatchObject({sortValue:300,sortSource:'observed',deltaRatio:null});
 });
 it('não calcula delta com previsão zero e cai para a previsão sem observado do objetivo', () => {
  const a = hunt(1,'A'), b = hunt(2,'B');
  const rows = rankHunts([a,b],[forecast(a,0,null),forecast(b,50,null)],[measurement(a,60,10,null),measurement(b,10,null,5)],request);
  expect(rows.map(row => [row.hunt.name,row.sortValue,row.sortSource,row.deltaRatio])).toEqual([['B',50,'forecast',null],['A',10,'observed',null]]);
  expect(rows[0]?.warnings).toEqual(['Amostra pequena (< 30 min)']);
 });
 it('aplica elegibilidade e avisos de nível', () => {
  const locked = hunt(1,'Trancada',200), unknown = hunt(2,'Incógnita',null), open = hunt(3,'Aberta',100);
  const rows = rankHunts([locked,unknown,open],[forecast(locked,9999,null)],[],request);
  expect(rows.map(row => row.hunt.name)).toEqual(['Aberta','Incógnita','Trancada']);
  expect(rows[2]).toMatchObject({eligible:false,ineligibleReason:'Requer nível 200; conta informou 100',sortValue:9999});
  expect(rows[1]).toMatchObject({eligible:true,ineligibleReason:null,warnings:['Nível exigido desconhecido','Sem dados'],sortValue:null,sortSource:null});
  expect(rows[0]?.warnings).toEqual(['Sem dados']);
  expect(rankHunts([locked],[],[],{...request,trainerLevel:null})[0]).toMatchObject({eligible:true,warnings:['Nível da conta não informado','Sem dados']});
 });
 it('desempata por nome em pt-BR e depois por id, com nulos por último', () => {
  const hunts = [hunt(5,'Zubat'),hunt(4,'caverna'),hunt(3,'Árvore'),hunt(2,'Igual'),hunt(1,'Igual'),hunt(6,'Abra')];
  const rows = rankHunts(hunts,hunts.slice(0,5).map(h => forecast(h,10,null)),[],request);
  expect(rows.map(row => row.hunt.name)).toEqual(['Árvore','caverna','Igual','Igual','Zubat','Abra']);
  expect(rows.slice(2,4).map(row => row.hunt.id)).toEqual([uuid(101),uuid(102)]);
  expect(rankHunts([...hunts].reverse(),hunts.slice(0,5).map(h => forecast(h,10,null)),[],request)).toEqual(rows);
 });
 it('ordena 1.000 hunts com 10.000 medições em menos de 300 ms', () => {
  const hunts = Array.from({length:1000},(_,i) => hunt(i,`Hunt ${i % 50}`,i % 7 ? i % 300 + 1 : null));
  const forecasts = hunts.map((h,i) => forecast(h,i * 13 % 997,i % 5 ? i : null));
  const measurements = Array.from({length:10000},(_,i) => measurement(hunts[i * 7 % 1000] as Hunt,i % 90 + 1,i % 3 ? i * 11 : null,i % 4 ? i : null));
  const start = performance.now();
  const rows = rankHunts(hunts,forecasts,measurements,request);
  const elapsed = performance.now() - start;
  console.log(`rankHunts 1000x10000: ${elapsed.toFixed(1)} ms`);
  expect(rows).toHaveLength(1000);
  expect(elapsed).toBeLessThan(300);
 });
});

describe('validação do Grindolino', () => {
 it('normaliza entradas válidas', () => {
  expect(parseHuntInput({name:'  Caverna  ',region:' Kanto ',requiredTrainerLevel:null,extra:1})).toEqual({name:'Caverna',region:'Kanto',requiredTrainerLevel:null});
  expect(parseForecastInput({accountId:account,huntId:other,xpPerHour:0,coinsPerHour:null})).toEqual({accountId:account,huntId:other,xpPerHour:0,coinsPerHour:null});
  expect(parseMeasurementInput({accountId:account,huntId:other,minutes:1440,xpGained:null,coinsGained:5})).toEqual({accountId:account,huntId:other,minutes:1440,xpGained:null,coinsGained:5,killCount:null,shinyCount:null,pokemonKey:null,pokemonName:null,pokemonLevel:null,pokemonLevelEnd:null});
  expect(parseRankRequest({accountId:account,objective:'coins',trainerLevel:null})).toEqual({accountId:account,objective:'coins',trainerLevel:null});
 });
 it('rejeita tipos, limites e identificadores inválidos', () => {
  const h = {name:'Caverna',region:'',requiredTrainerLevel:10};
  for (const bad of [null,undefined,'x',[],{...h,name:'   '},{...h,name:'x'.repeat(5000)},{...h,name:'x'.repeat(61)},{...h,name:1},{...h,region:'x'.repeat(41)},{...h,region:null},{...h,requiredTrainerLevel:0},{...h,requiredTrainerLevel:1.5},{...h,requiredTrainerLevel:'10'},{...h,requiredTrainerLevel:undefined}]) expect(() => parseHuntInput(bad)).toThrow();
  const f = {accountId:account,huntId:other,xpPerHour:10,coinsPerHour:10};
  for (const bad of [{...f,xpPerHour:NaN},{...f,xpPerHour:-1},{...f,xpPerHour:'10'},{...f,coinsPerHour:Infinity},{...f,coinsPerHour:2**53},{...f,xpPerHour:null,coinsPerHour:null},{...f,accountId:'../../bad'},{...f,huntId:'x'.repeat(5000)},{...f,huntId:1}]) expect(() => parseForecastInput(bad)).toThrow();
  const m = {accountId:account,huntId:other,minutes:30,xpGained:10,coinsGained:10};
  for (const bad of [{...m,minutes:0},{...m,minutes:1441},{...m,minutes:NaN},{...m,minutes:'30'},{...m,minutes:null},{...m,xpGained:-1},{...m,coinsGained:0.5},{...m,xpGained:null,coinsGained:null},{...m,accountId:''}]) expect(() => parseMeasurementInput(bad)).toThrow();
  const r = {accountId:account,objective:'xp',trainerLevel:10};
  for (const bad of [{...r,objective:'gold'},{...r,trainerLevel:0},{...r,trainerLevel:NaN},{...r,accountId:'id'},null]) expect(() => parseRankRequest(bad)).toThrow();
  for (const bad of ['', 'x'.repeat(5000), 1, null, '550e8400-e29b-11d4-a716-446655440000']) expect(() => parseId(bad)).toThrow();
 });
 it('explica cada erro com mensagem específica em pt-BR', () => {
  const h = {name:'Caverna',region:'',requiredTrainerLevel:10};
  const f = {accountId:account,huntId:other,xpPerHour:10,coinsPerHour:10};
  const m = {accountId:account,huntId:other,minutes:30,xpGained:10,coinsGained:10};
  const cases: [() => unknown, string][] = [
   [() => parseHuntInput(null),'Dados inválidos'],
   [() => parseHuntInput({...h,name:' '}),'Nome da hunt deve ter de 1 a 60 caracteres'],
   [() => parseHuntInput({...h,region:'x'.repeat(41)}),'Região deve ter no máximo 40 caracteres'],
   [() => parseHuntInput({...h,requiredTrainerLevel:0}),'Nível exigido deve ser um inteiro entre 1 e 9.007.199.254.740.991'],
   [() => parseForecastInput({...f,xpPerHour:-1}),'XP/h deve ser um inteiro entre 0 e 9.007.199.254.740.991'],
   [() => parseForecastInput({...f,coinsPerHour:2**53}),'Coins/h deve ser um inteiro entre 0 e 9.007.199.254.740.991'],
   [() => parseForecastInput({...f,xpPerHour:null,coinsPerHour:null}),'Informe ao menos XP/h ou Coins/h'],
   [() => parseForecastInput({...f,accountId:'x'}),'Conta inválida'],
   [() => parseForecastInput({...f,huntId:'x'}),'Hunt inválida'],
   [() => parseMeasurementInput({...m,minutes:1441}),'Duração em minutos deve ser um inteiro entre 1 e 1.440'],
   [() => parseMeasurementInput({...m,xpGained:0.5}),'XP ganho deve ser um inteiro entre 0 e 9.007.199.254.740.991'],
   [() => parseMeasurementInput({...m,coinsGained:-1}),'Total de coins ganhos deve ser um inteiro entre 0 e 9.007.199.254.740.991'],
   [() => parseMeasurementInput({...m,xpGained:null,coinsGained:null}),'Informe ao menos XP ganho ou coins ganhos'],
   [() => parseRankRequest({accountId:account,objective:'gold',trainerLevel:1}),'Objetivo inválido'],
   [() => parseRankRequest({accountId:account,objective:'xp',trainerLevel:0}),'Nível da conta deve ser um inteiro entre 1 e 9.007.199.254.740.991'],
   [() => parseCompareRequest({objective:'gold'}),'Objetivo inválido'],
   [() => parseId('x'),'Identificador inválido'],
  ];
  for (const [run,message] of cases) {
   let error: unknown; try { run(); } catch (caught) { error = caught; }
   expect(error).toBeInstanceOf(GrindolinoError);
   expect((error as Error).message).toBe(message);
  }
  expect(parseCompareRequest({objective:'coins',extra:1})).toEqual({objective:'coins'});
 });
});

describe('comparação entre contas', () => {
 const third = uuid(3);
 it('monta uma célula por conta na ordem pedida, sem somar entre contas', () => {
  const a = hunt(1,'A');
  const [row] = compareAccounts([a],
   [forecast(a,100,5,'2026-11-01T00:00:00.000Z'),forecast(a,300,7,'2026-11-09T00:00:00.000Z'),forecast(a,900,null,undefined,other)],
   [measurement(a,30,600,null),measurement(a,30,600,300),measurement(a,60,null,300),measurement(a,60,50,null,third)],[third,account,other,uuid(4)],'xp');
  expect(row?.cells).toEqual([
   {accountId:third,forecastPerHour:null,observedPerHour:50,killsPerHour:null,shinyPerHour:null,samples:1,totalMinutes:60},
   {accountId:account,forecastPerHour:300,observedPerHour:1200,killsPerHour:null,shinyPerHour:null,samples:2,totalMinutes:60},
   {accountId:other,forecastPerHour:900,observedPerHour:null,killsPerHour:null,shinyPerHour:null,samples:0,totalMinutes:0},
   {accountId:uuid(4),forecastPerHour:null,observedPerHour:null,killsPerHour:null,shinyPerHour:null,samples:0,totalMinutes:0},
  ]);
  expect(row).toMatchObject({bestAccountId:account,missingAccountIds:[uuid(4)]});
  const [coins] = compareAccounts([a],[forecast(a,900,null,undefined,other)],[measurement(a,60,null,300),measurement(a,60,50,null,third)],[third,account,other],'coins');
  expect(coins).toMatchObject({bestAccountId:account,missingAccountIds:[third,other]});
  expect(coins?.cells[1]).toEqual({accountId:account,forecastPerHour:null,observedPerHour:300,killsPerHour:null,shinyPerHour:null,samples:1,totalMinutes:60});
 });
 it('prefere o observado ao previsto, desempata pela primeira conta e ordena por nome e id', () => {
  const hunts = [hunt(5,'Zubat'),hunt(4,'caverna'),hunt(3,'Árvore'),hunt(2,'Igual'),hunt(1,'Igual')];
  const z = hunts[0] as Hunt, c = hunts[1] as Hunt;
  const rows = compareAccounts(hunts,[forecast(z,5000,null),forecast(z,100,null,undefined,other),forecast(c,10,null,undefined,other),forecast(c,10,null)],[measurement(z,60,200,null),measurement(z,60,300,null,other)],[other,account],'xp');
  expect(rows.map(row => row.hunt.name)).toEqual(['Árvore','caverna','Igual','Igual','Zubat']);
  expect(rows.slice(2,4).map(row => row.hunt.id)).toEqual([uuid(101),uuid(102)]);
  expect(rows.map(row => row.bestAccountId)).toEqual([null,other,null,null,other]);
  expect(rows[0]?.missingAccountIds).toEqual([other,account]);
  expect(compareAccounts([z],[forecast(z,0,null)],[],[other,account],'xp')[0]).toMatchObject({bestAccountId:account,missingAccountIds:[other]});
  expect(compareAccounts([z],[],[],[],'xp')).toEqual([{hunt:z,cells:[],bestAccountId:null,missingAccountIds:[]}]);
 });
 it('compara 1.000 hunts em 4 contas com 10.000 medições em menos de 300 ms', () => {
  const accounts = [1,2,3,4].map(uuid);
  const hunts = Array.from({length:1000},(_,i) => hunt(i,`Hunt ${i % 50}`));
  const forecasts = hunts.flatMap((h,i) => accounts.map((id,j) => forecast(h,(i + j) * 13 % 997,i % 5 ? i : null,undefined,id)));
  const measurements = Array.from({length:10000},(_,i) => measurement(hunts[i * 7 % 1000] as Hunt,i % 90 + 1,i % 3 ? i * 11 : null,i % 4 ? i : null,accounts[i % 4]));
  const start = performance.now();
  const rows = compareAccounts(hunts,forecasts,measurements,accounts,'xp');
  const elapsed = performance.now() - start;
  console.log(`compareAccounts 1000x4x10000: ${elapsed.toFixed(1)} ms`);
  expect(rows).toHaveLength(1000);
  expect(rows.every(row => row.cells.length === 4 && row.bestAccountId !== null)).toBe(true);
  expect(elapsed).toBeLessThan(300);
 });
});
