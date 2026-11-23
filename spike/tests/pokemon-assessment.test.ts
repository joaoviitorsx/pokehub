import { describe, expect, it } from 'vitest';
import { assessPokemon, assessTeam, pokemonPerformance, teamIvMean } from '../domain/pokemon-assessment';
import type { Measurement } from '../contracts/grindolino';
import type { StatBlock, TeamHunt, TeamMember } from '../contracts/hunt';

const measure = (over: Partial<Measurement> = {}): Measurement => ({id:'m',accountId:'conta',huntId:'h1',minutes:30,xpGained:1000,coinsGained:100,killCount:null,shinyCount:null,pokemonKey:'p1',pokemonName:'Bicho',pokemonLevel:40,pokemonLevelEnd:null,recordedAt:'2026-11-10T10:00:00Z',...over});
const hunt = (nome: string, xpPorHora: number, ouroPorHora: number): TeamHunt => ({nome,regiao:'kanto',xpPorHora,ouroPorHora,abatesPorHora:100,estimado:false});
const member = (chave: string, hunts: TeamHunt[], ivs: Partial<StatBlock> | null): TeamMember => ({chave,ativo:false,nome:chave,nivel:50,potencia:null,tipos:[],ivs:ivs && {hp:null,atk:null,def:null,spAtk:null,spDef:null,speed:null,...ivs},stats:null,sprite:null,hunts});

describe('avaliação de IVs', () => {
  it('calcula o total e a proximidade do máximo com seis IVs válidos', () => {
    expect(assessPokemon([32,32,32,32,32,32])).toEqual({total:192,percent:100});
    expect(assessPokemon([1,1,1,1,1,1])).toEqual({total:6,percent:3.125});
  });
  it('recusa dados incompletos, fora da faixa ou não inteiros', () => {
    for (const values of [[1,2], [0,1,1,1,1,1], [33,1,1,1,1,1], [1.5,1,1,1,1,1], [NaN,1,1,1,1,1]]) {
      expect(assessPokemon(values)).toBeNull();
    }
  });
});

describe('desempenho medido por Pokémon', () => {
  it('agrega por pokemonKey só na conta pedida e ignora medições sem Pokémon', () => {
    const result = pokemonPerformance([
      measure({minutes:30,xpGained:1000,coinsGained:300,killCount:60,pokemonLevelEnd:41}),
      measure({minutes:30,xpGained:3000,coinsGained:null,killCount:null,huntId:'h2',pokemonName:'Novo nome',recordedAt:'2026-11-10T12:00:00Z'}),
      measure({pokemonKey:null,xpGained:9e9}), measure({accountId:'outra',xpGained:9e9}), measure({pokemonKey:'p2',minutes:10,xpGained:null,coinsGained:50}),
    ],'conta');
    expect([...result.keys()]).toEqual(['p1','p2']);
    expect(result.get('p1')).toMatchObject({name:'Novo nome',minutes:60,samples:2,xpPerHour:4000,coinsPerHour:600,killsPerHour:120,levelTo:41});
    expect(result.get('p1')!.hunts.map(hunt => [hunt.huntId,hunt.xpPerHour])).toEqual([['h1',2000],['h2',6000]]);
    expect(result.get('p2')).toMatchObject({xpPerHour:null,coinsPerHour:300,killsPerHour:null});
  });
});

describe('veredito da equipe', () => {
  const names = new Map([['h1','caverna '],['h2','Sem previsão']]);
  it('ordena pelo previsto, dá selos e compara real com previsto na mesma hunt', () => {
    const team = [member('p1',[hunt('Caverna',1000,50),hunt('Praia',400,90)],{atk:30,speed:28,hp:4}), member('p2',[hunt('Caverna',800,200)],{atk:10,speed:10,hp:20})];
    const real = pokemonPerformance([measure({minutes:45,xpGained:840,coinsGained:30,pokemonLevelEnd:40})],'conta'); // 1120 XP/h, 40 ouro/h
    const [first,second] = assessTeam(team,real,names);
    expect(first).toMatchObject({badges:['xp'],bestXp:{nome:'Caverna'},bestGold:{nome:'Praia'},smallSample:false,compared:{hunt:'Caverna',minutes:45}});
    expect(first!.compared!.xpRatio).toBeCloseTo(0.12);
    expect(first!.lines.map(line => line.text)).toEqual(['1º de 2 em XP/h previsto','2º de 2 em ouro/h previsto','XP real 12% acima do previsto em “Caverna” (45 min)','Ouro real 20% abaixo do previsto em “Caverna” (45 min)','Medido até o nível 40; a previsão vale para o nível 50 de agora','IV acima da média da equipe em ATK, SPD','IV abaixo da média da equipe em HP']);
    expect(second).toMatchObject({badges:['gold'],real:null,compared:null});
    expect(second!.lines.map(line => line.text)).toContain('Sem medição ao vivo com este Pokémon nesta conta');
  });
  it('sinaliza amostra pequena, diferença dentro da margem e medição sem hunt comparável', () => {
    const team = [member('p1',[hunt('Caverna',1000,0)],null)];
    const close = assessTeam(team,pokemonPerformance([measure({minutes:12,xpGained:206,coinsGained:null,pokemonLevelEnd:50})],'conta'),names)[0]!;
    expect(close.smallSample).toBe(true);
    expect(close.badges).toEqual([]); // sozinho não há com quem comparar
    expect(close.lines.map(line => line.text)).toEqual(['XP real dentro do previsto em “Caverna” (12 min)','Amostra pequena (menos de 30 min): leia o real como indício']);
    const other = assessTeam(team,pokemonPerformance([measure({huntId:'h2',minutes:90})],'conta'),names)[0]!;
    expect(other).toMatchObject({compared:null,smallSample:false});
    expect(other.lines[0]!.text).toBe('90 min medidos, mas em hunt sem previsão do /hunt agora: sem comparação');
  });
  it('não inventa previsão nem média de IV', () => {
    const [only] = assessTeam([member('p1',[],{atk:30})],new Map(),names);
    expect(only).toMatchObject({bestXp:null,bestGold:null,badges:[]});
    expect(only!.lines.map(line => line.tone)).toEqual(['warn','plain']);
    expect(teamIvMean([member('p1',[],{atk:30}),member('p2',[],{atk:10}),member('p3',[],null)])).toMatchObject({atk:20,hp:null});
  });
});
