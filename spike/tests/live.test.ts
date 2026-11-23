import { describe, expect, it } from 'vitest';
import { addEvents, emptyTotals, parseLogLine, perHour } from '../domain/live';

describe('parser do log de mensagens do jogo', () => {
 it('lê a linha de abate com ponto de milhar e o ouro total (sem somar o bônus de novo)', () => {
  expect(parseLogLine('Sunkern derrotado! +42.127 xp treinador, +42.127 xp pokemon, +1.005 ouro (+137 do bônus de loot) · Loot Boost')).toEqual({kind:'kill',name:'Sunkern',trainerXp:42127,pokemonXp:42127,coins:1005});
  expect(parseLogLine('[12:03] Mr. Mime derrotado! +7 xp treinador, +1.234.567 xp pokémon')).toEqual({kind:'kill',name:'Mr. Mime',trainerXp:7,pokemonXp:1234567,coins:null});
  expect(parseLogLine('Nidoran♀ derrotada! +12 ouro')).toMatchObject({name:'Nidoran♀',trainerXp:null,coins:12});
 });
 it('lê a captura, com nível e Shiny', () => {
  expect(parseLogLine('capturado: Sunkern Nv40 (q1.397)')).toEqual({kind:'capture',name:'Sunkern',level:40,shiny:false});
  expect(parseLogLine('Capturado: Shiny Sunkern Nv 200 (q2.000)')).toEqual({kind:'capture',name:'Sunkern',level:200,shiny:true});
  expect(parseLogLine('✨ capturado: Ho-Oh Nv70')).toMatchObject({name:'Ho-Oh',shiny:true});
 });
 it('ignora texto inesperado, números fora do formato e valores absurdos', () => {
  for (const line of ['Sunkern Nv200 escapou e sumiu','','derrotado!','Seu Pikachu foi derrotado!','capturado: Sunkern','capturado: Nv40','Sunkern derrotado! muito bem',
   'x'.repeat(241),null,undefined,42,{},['Sunkern derrotado! +1 ouro']]) expect(parseLogLine(line)).toBeNull();
  // "1,2 mi", decimal e separador errado não viram número; o ganho legível da mesma linha continua valendo
  expect(parseLogLine('Sunkern derrotado! +1,2 mi xp treinador, +42.1 xp pokemon, +9 ouro')).toEqual({kind:'kill',name:'Sunkern',trainerXp:null,pokemonXp:null,coins:9});
  expect(parseLogLine('Sunkern derrotado! +9.999.999.999.999.999 xp treinador')).toBeNull();
  expect(parseLogLine('Sunkern derrotado! -5 ouro')).toBeNull();
 });
 it('acumula sem alterar o total anterior e só dá taxa com amostra mínima', () => {
  const start = emptyTotals();
  const events = ['Sunkern derrotado! +10 xp treinador, +20 xp pokemon, +3 ouro','Sunkern derrotado! +10 xp treinador','capturado: Sunkern Nv40','capturado: Shiny Sunkern Nv40','lixo'].flatMap(line => parseLogLine(line) ?? []);
  expect(addEvents(start,events)).toEqual({kills:2,trainerXp:20,pokemonXp:20,coins:3,captures:2,shinies:1});
  expect(start).toEqual(emptyTotals());
  expect(perHour(100,119_999,120_000)).toBeNull();
  expect(perHour(100,120_000,120_000)).toBe(3000);
  expect(perHour(100,0,0)).toBeNull();
 });
});
