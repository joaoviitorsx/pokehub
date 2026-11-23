import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PokemonProfessor } from '../src/pokemon-professor';
import { talk } from '../src/pokemon-team';

describe('Professor Grindolino', () => {
  it('oferece avaliação de Pokémon sem a antiga análise de hunts', () => {
    const html = renderToStaticMarkup(<PokemonProfessor onClose={() => {}}/>);
    expect(html).toContain('IVs por atributo');
    expect(html).toContain('Potência');
    expect(html).toContain('Avaliar Pokémon');
    expect(html).not.toContain('Cadastrar hunt');
    expect(html).not.toContain('Comparar contas');
  });
  it('com contas abre na equipe, com seletor de conta, regras do veredito e leitura sob demanda', () => {
    const profiles = [{id:'a',label:'Conta A',emailLabel:'a@a',characterName:'',colorToken:'#d4a65f',createdAt:''}];
    const html = renderToStaticMarkup(<PokemonProfessor profiles={profiles as never} states={{a:'ready'}} onClose={() => {}}/>);
    for (const text of ['Equipe','Informar IVs','Conta A','Ler equipe','Como o Professor decide','Lendo a equipe de Conta A']) expect(html).toContain(text);
    expect(html).not.toContain('IVs por atributo');
    expect(renderToStaticMarkup(<PokemonProfessor profiles={profiles as never} states={{a:'offline'}} onClose={() => {}}/>)).toContain('não está pronta');
  });
  it('o humor do Professor segue o veredito: feliz, pensativo ou preocupado', () => {
    const base = {chave:'1',bestXp:{} as never,bestGold:null,badges:[],real:{} as never,compared:null,smallSample:false,lines:[]};
    const compared = (xpRatio:number) => ({hunt:'Caverna',minutes:45,xpRatio,goldRatio:null});
    expect(talk('Abra',{...base,compared:compared(0.1)})[0]).toBe('happy');
    expect(talk('Abra',{...base,compared:compared(-0.1)})[0]).toBe('thinking');
    expect(talk('Abra',{...base,compared:compared(-0.4)})).toEqual(['worried',expect.stringContaining('40% abaixo')]);
    expect(talk('Abra',{...base,compared:{...compared(0.1),goldRatio:-0.4}})).toEqual(['thinking',expect.stringContaining('Ouro de Abra ficou 40% abaixo')]);
    expect(talk('Abra',{...base,compared:compared(-0.4),smallSample:true})[0]).toBe('thinking');
    expect(talk('Abra',{...base,real:null,badges:['xp']})).toEqual(['happy',expect.stringContaining('Falta medir')]);
    expect(talk('Abra',{...base,real:null})[0]).toBe('thinking');
  });
});
