import { describe, expect, it } from 'vitest';
import { HUNT_IDLE_MS, HUNT_REFRESH_LITE_MS, HUNT_REFRESH_MS, huntFetchable, huntQueue, huntRefreshMs, signature } from '../src/hunt-queue';

describe('fila de leitura da lateral', () => {
  it('lê a selecionada primeiro e pré-aquece as outras na ordem dos perfis', () => {
    expect(huntQueue(['a','b','c'],'b',() => undefined,1000)).toEqual(['b','a','c']);
  });
  it('relê a selecionada sempre e as outras só após 5 min', () => {
    const at: Record<string,number> = {a:1_000_000,b:1_000_000,c:800_000};
    expect(huntQueue(['a','b','c'],'a',id => at[id],1_004_000)).toEqual(['a']);
    expect(huntQueue(['a','b','c'],'a',id => at[id],1_100_000)).toEqual(['a','c']);
    expect(huntQueue(['a','b','c'],'a',id => at[id],1_000_000 + HUNT_IDLE_MS)).toEqual(['a','b','c']);
  });
  it('sem pré-aquecimento (Modo leve) lê só a selecionada', () => {
    expect(huntQueue(['a','b','c'],'b',() => undefined,0,false)).toEqual(['b']);
    expect(huntQueue(['a','c'],'b',() => undefined,0,false)).toEqual([]);
  });
  it('não lê a selecionada quando a sessão dela não está utilizável', () => {
    expect(huntQueue(['a','c'],'b',() => undefined,0)).toEqual(['a','c']);
    expect(huntQueue([],'b',() => undefined,0)).toEqual([]);
  });
  it('só pede o retrato de sessão pronta ou carregando', () => {
    expect(['ready','loading','offline','auth_required','error','suspended','',undefined].map(huntFetchable)).toEqual([true,true,false,false,false,false,false,false]);
  });
  it('ritmo: 10 s normal, 20 s no Modo leve', () => {
    expect([HUNT_REFRESH_MS,huntRefreshMs(false),HUNT_REFRESH_LITE_MS,huntRefreshMs(true)]).toEqual([10_000,10_000,20_000,20_000]);
  });
  it('a assinatura detecta só mudança real do retrato', () => {
    expect(signature({a:1,b:[1,2]})).toBe(signature({a:1,b:[1,2]}));
    expect(signature({a:1,b:[1,2]})).not.toBe(signature({a:1,b:[1,3]}));
    expect(signature(undefined)).toBe('');
  });
});
