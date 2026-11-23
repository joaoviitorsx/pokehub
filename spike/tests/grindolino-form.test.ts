import { describe, expect, it } from 'vitest';
import { checkForecast, checkHunt, checkMeasurement, fieldsChanged, forecastFromHunt, formatCompact, formatDelta, huntKey, parseCount } from '../src/grindolino-form';

describe('formulários do Grindolino', () => {
  it('lê inteiros em pt-BR e recusa o resto', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount(' 1.250.000 ')).toBe(1250000);
    expect(parseCount('1250000')).toBe(1250000);
    for (const bad of ['1,5','1.5','-3','abc','1e3','99999999999999999999']) expect(parseCount(bad)).toBeNaN();
  });
  it('valida hunt conforme o contrato', () => {
    expect(checkHunt({name:'  Caverna  ',region:' Norte ',level:''})).toEqual({ok:true,value:{name:'Caverna',region:'Norte',requiredTrainerLevel:null}});
    expect(checkHunt({name:'Caverna',region:'',level:'200'})).toMatchObject({value:{requiredTrainerLevel:200}});
    expect(checkHunt({name:' ',region:'',level:''}).ok).toBe(false);
    expect(checkHunt({name:'x'.repeat(61),region:'',level:''}).ok).toBe(false);
    expect(checkHunt({name:'x',region:'y'.repeat(41),level:''}).ok).toBe(false);
    expect(checkHunt({name:'x',region:'',level:'0'}).ok).toBe(false);
    expect(checkHunt({name:'x',region:'',level:'dez'}).ok).toBe(false);
  });
  it('valida previsão: ao menos um valor, só inteiros', () => {
    expect(checkForecast({xp:'1.200.000',coins:''})).toEqual({ok:true,value:{xpPerHour:1200000,coinsPerHour:null}});
    expect(checkForecast({xp:'0',coins:'0'}).ok).toBe(true);
    expect(checkForecast({xp:'',coins:''}).ok).toBe(false);
    expect(checkForecast({xp:'1,5',coins:'10'}).ok).toBe(false);
  });
  it('valida medição: minutos de 1 a 1440 e ao menos um ganho', () => {
    expect(checkMeasurement({minutes:'30',xp:'500000',coins:''})).toEqual({ok:true,value:{minutes:30,xpGained:500000,coinsGained:null}});
    for (const minutes of ['','0','1441','meia hora']) expect(checkMeasurement({minutes,xp:'1',coins:''}).ok).toBe(false);
    expect(checkMeasurement({minutes:'30',xp:'',coins:''}).ok).toBe(false);
    expect(checkMeasurement({minutes:'30',xp:'x',coins:'1'}).ok).toBe(false);
  });
  it('formata números compactos e a diferença com texto', () => {
    expect(formatCompact(null)).toBe('—');
    expect(formatCompact(1234567)).toMatch(/^1,2\smi$/);
    expect(formatCompact(850000)).toMatch(/^850\smil$/);
    expect(formatDelta(0.124)).toEqual({text:'12% acima do previsto',tone:'up'});
    expect(formatDelta(-0.08)).toEqual({text:'8% abaixo do previsto',tone:'down'});
    expect(formatDelta(0.001)).toEqual({text:'Igual ao previsto',tone:'flat'});
  });
  it('guarda de saída: só há alteração quando o digitado difere do valor inicial', () => {
    expect(fieldsChanged({},{})).toBe(false);
    expect(fieldsChanged({},{xp:'  '})).toBe(false);
    expect(fieldsChanged({},{xp:'10'})).toBe(true);
    expect(fieldsChanged({name:'Caverna',region:''},{name:' Caverna '})).toBe(false);
    expect(fieldsChanged({name:'Caverna'},{name:'Cavernas'})).toBe(true);
    expect(fieldsChanged({name:'Caverna'},{name:''})).toBe(true);
  });
  it('converte uma linha do /hunt em hunt e previsão do Grindolino', () => {
    const row = {nome:'  Caverna dos Cristais ',regiao:'kanto',nivel:120,xpPorHora:1402000.6,ouroPorHora:-3};
    expect(forecastFromHunt(row)).toEqual({hunt:{name:'Caverna dos Cristais',region:'Kanto',requiredTrainerLevel:120},rates:{xpPerHour:1402001,coinsPerHour:0}});
    const odd = forecastFromHunt({nome:'x'.repeat(70),regiao:'',nivel:12.5,xpPorHora:NaN,ouroPorHora:Infinity});
    expect(odd).toEqual({hunt:{name:'x'.repeat(60),region:'',requiredTrainerLevel:null},rates:{xpPerHour:null,coinsPerHour:null}});
    expect(forecastFromHunt({...row,nivel:0}).hunt.requiredTrainerLevel).toBeNull();
    expect(huntKey('  CAVERNA dos Cristais ')).toBe(huntKey(forecastFromHunt(row).hunt.name));
  });
});
