import { describe, expect, it } from 'vitest';
import { audioMuted, mergeDisableFeatures, startupPlan, windowChrome } from '../electron/performance';
import { groupMetrics } from '../electron/diagnostics';
import { isMainFrameLoading, statusChanged } from '../electron/session-status';

describe('início escalonado', () => {
  it('abre a conta em foco logo e as demais a cada 2,5 s', () => {
    expect(startupPlan(['a','b','c','d'],'c')).toEqual([{id:'c',delay:0},{id:'a',delay:2500},{id:'b',delay:5000},{id:'d',delay:7500}]);
    expect(startupPlan(['a','b'],null)).toEqual([{id:'a',delay:0},{id:'b',delay:2500}]);
    expect(startupPlan(['a','b'],'fora')[0]).toEqual({id:'a',delay:0});
    expect(startupPlan([],null)).toEqual([]);
  });
});
describe('áudio, flags e janela', () => {
  it('muta só quando a opção está ligada e a conta não está visível', () => {
    expect([audioMuted(true,false),audioMuted(true,true),audioMuted(false,false)]).toEqual([true,false,false]);
  });
  it('junta o disable-features sem duplicar', () => {
    expect(mergeDisableFeatures(undefined,['SpareRendererForSitePerProcess'])).toBe('SpareRendererForSitePerProcess');
    expect(mergeDisableFeatures('A, B',['SpareRendererForSitePerProcess','A'])).toBe('A,B,SpareRendererForSitePerProcess');
  });
  it('barra de título: overlay no Windows/Linux, semáforos no macOS', () => {
    expect(windowChrome('win32')).toEqual({titleBarStyle:'hidden'});
    expect(windowChrome('linux').titleBarStyle).toBe('hidden');
    expect(windowChrome('darwin')).toEqual({titleBarStyle:'hiddenInset'});
  });
});
describe('estado da sessão', () => {
  it('só notifica quando muda e só conta carga do frame principal', () => {
    expect([statusChanged(undefined,'loading'),statusChanged('loading','loading'),statusChanged('loading','ready')]).toEqual([true,false,true]);
    expect([isMainFrameLoading(true),isMainFrameLoading(false)]).toEqual([true,false]);
  });
});
describe('monitor por conta', () => {
  const metric = (pid:number,type:string,ws:number,cpu:number,priv?:number) => ({pid,type,creationTime:pid,memory:{workingSetSize:ws,...(priv === undefined ? {} : {privateBytes:priv})},cpu:{percentCPUUsage:cpu}});
  const metrics = [metric(1,'Browser',100,1),metric(2,'Tab',900,5,700),metric(3,'Tab',50,2),metric(4,'GPU',60,3),metric(5,'Utility',10,0),metric(6,'Tab',800,9,600)];
  it('mapeia pids para contas, hub (principal + janela), GPU e outros', () => {
    const result = groupMetrics(metrics,new Map<string,number|null>([['a',2],['b',6],['c',null]]),3);
    expect(result.accounts).toEqual([{id:'a',cpuPercent:5,privateKb:700,workingSetKb:900},{id:'b',cpuPercent:9,privateKb:600,workingSetKb:800},{id:'c',cpuPercent:null,privateKb:null,workingSetKb:null}]);
    expect(result.hub).toEqual({cpuPercent:3,privateKb:150,workingSetKb:150,count:2}); // sem privateBytes usa o conjunto de trabalho
    expect(result.gpu).toMatchObject({count:1,workingSetKb:60}); expect(result.other.count).toBe(1);
  });
  it('não mostra CPU na primeira leitura', () => {
    const result = groupMetrics(metrics,new Map([['a',2]]),3,true);
    expect(result.accounts[0]?.cpuPercent).toBeNull(); expect(result.hub.cpuPercent).toBeNull(); expect(result.accounts[0]?.privateKb).toBe(700);
  });
});
