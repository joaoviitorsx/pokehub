import { describe, expect, it } from 'vitest';
import { huntFetchable, huntQueue } from '../src/hunt-queue';

describe('fila de leitura da lateral', () => {
  it('lê a selecionada primeiro e pré-aquece as outras na ordem dos perfis', () => {
    expect(huntQueue(['a','b','c'],'b',() => undefined,1000)).toEqual(['b','a','c']);
  });
  it('relê a selecionada sempre e as outras só após 60 s', () => {
    const at: Record<string,number> = {a:100_000,b:100_000,c:45_000};
    expect(huntQueue(['a','b','c'],'a',id => at[id],104_000)).toEqual(['a']);
    expect(huntQueue(['a','b','c'],'a',id => at[id],105_000)).toEqual(['a','c']);
    expect(huntQueue(['a','b','c'],'a',id => at[id],160_000)).toEqual(['a','b','c']);
  });
  it('não lê a selecionada quando a sessão dela não está utilizável', () => {
    expect(huntQueue(['a','c'],'b',() => undefined,0)).toEqual(['a','c']);
    expect(huntQueue([],'b',() => undefined,0)).toEqual([]);
  });
  it('só pede o retrato de sessão pronta ou carregando', () => {
    expect(['ready','loading','offline','auth_required','error','',undefined].map(huntFetchable)).toEqual([true,true,false,false,false,false,false]);
  });
});
