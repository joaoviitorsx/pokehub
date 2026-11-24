import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertLabel, hitKey, matches, normName, sanitizeAlert } from '../domain/market-alerts';
import { dayTypeNotice, recommend, tempoAte, tipoNome } from '../domain/team-pick';
import { sanitizeDayType, sanitizeTeamPick, TEAM_FULL_SCRIPT, TEAM_PROBE_SCRIPT, DAY_TYPE_SCRIPT } from '../electron/team-pick';
import { PreferencesStore } from '../electron/preferences-store';
import type { MarketListing } from '../domain/market';
import type { PickMember } from '../contracts/team';

const listing = (over: Partial<MarketListing> = {}): MarketListing => ({id:'a1', name:'Venusaur', level:61, potencia:4, nota:7.8, shiny:false, price:13_000, currency:'gold', smart:null, ...over});

describe('alertas do RMT: validação', () => {
  it('normaliza o nome (acento, caixa, espaços) e exige algum critério', () => {
    expect(sanitizeAlert({nome:'  VENUSÁUR  '}, 'x').nome).toBe('venusaur');
    expect(() => sanitizeAlert({}, 'x')).toThrow('Alerta vazio');
    expect(sanitizeAlert({soShiny:true}, 'x').soShiny).toBe(true);
  });
  it('preço máximo exige moeda (Gemas e Coins não se comparam)', () => {
    expect(() => sanitizeAlert({nome:'x', precoMax:100}, 'x')).toThrow('Preço exige a moeda');
    expect(sanitizeAlert({nome:'Venusaur', moeda:'gold', precoMax:'15.000'}, 'x').precoMax).toBe(15_000);
  });
  it('recusa faixas fora do jogo e texto estranho', () => {
    for (const bad of [{notaMin:11}, {potenciaMin:6}, {nome:'<script>'}, {precoMax:-1, moeda:'gold'}, null, [], 'x']) expect(() => sanitizeAlert(bad, 'x')).toThrow();
  });
});

describe('alertas do RMT: casamento', () => {
  const alert = sanitizeAlert({nome:'venus', moeda:'gold', precoMax:15_000, potenciaMin:4, notaMin:7}, 'a');
  it('casa quando tudo bate (nome parcial)', () => { expect(matches(alert, listing())).toBe(true); });
  it('cada critério recusa sozinho', () => {
    expect(matches(alert, listing({name:'Charizard'}))).toBe(false);
    expect(matches(alert, listing({currency:'orb'}))).toBe(false);
    expect(matches(alert, listing({price:15_001}))).toBe(false);
    expect(matches(alert, listing({potencia:3}))).toBe(false);
    expect(matches(alert, listing({nota:null}))).toBe(false); // nota exigida e não lida: não casa
    expect(matches({...alert, ativo:false}, listing())).toBe(false);
    expect(matches(sanitizeAlert({soShiny:true}, 's'), listing())).toBe(false);
    expect(matches(sanitizeAlert({soShiny:true}, 's'), listing({shiny:true}))).toBe(true);
  });
  it('chave de aviso por alerta e anúncio; rótulo legível', () => {
    expect(hitKey(alert, listing())).not.toBe(hitKey(alert, listing({id:'a2'})));
    expect(alertLabel(alert)).toBe('Venus · P4+ · nota ≥ 7 · até 15.000 Coins');
    expect(normName('Mr. Mime')).toBe('mr. mime');
  });
});

const membro = (chave: string, v: number, over: Partial<PickMember> = {}): PickMember => ({chave, nome:`P${chave}`, nivel:50, ativo:false, equipe:true, tipos:['WATER'], potencia:2, sprite:null, tipoDoDia:false, melhor:{treinador:{nome:'Hunt', regiao:'kanto', valor:v}, ouro:null, pokemon:null}, ...over});

describe('quem colocar em campo', () => {
  it('recomenda o melhor DA EQUIPE e mostra o ganho', () => {
    const r = recommend([membro('1', 100, {ativo:true}), membro('2', 130), membro('3', 200, {equipe:false})], 'treinador');
    expect(r.melhor?.chave).toBe('2');
    expect(r.ganho).toBeCloseTo(0.3);
    expect(r.manter).toBe(false);
    expect(r.colecao?.membro.chave).toBe('3');
    expect(r.ordenados.map(m => m.chave)).toEqual(['3', '2', '1']);
  });
  it('mantém o em campo quando ele é o melhor ou empata em até 3%', () => {
    expect(recommend([membro('1', 100, {ativo:true}), membro('2', 103)], 'treinador').manter).toBe(true);
    expect(recommend([membro('1', 100, {ativo:true}), membro('2', 104)], 'treinador').manter).toBe(false);
  });
  it('coleção só aparece se superar em mais de 3%; métrica sem dados não recomenda', () => {
    expect(recommend([membro('1', 100, {ativo:true}), membro('3', 102, {equipe:false})], 'treinador').colecao).toBeNull();
    expect(recommend([membro('1', 100, {ativo:true})], 'ouro').melhor).toBeNull();
  });
});

describe('tipagem do dia', () => {
  it('nome em português e tempo até a troca', () => {
    expect(tipoNome('FIGHTING')).toBe('Lutador');
    expect(tempoAte(1_000 + 9 * 3_600_000 + 20 * 60_000, 1_000)).toBe('9 h 20');
    expect(tempoAte(500, 1_000)).toBe('');
  });
  it('só avisa quem tem Pokémon do tipo; equipe primeiro', () => {
    expect(dayTypeNotice('FIGHTING', 'Principal', [], [])).toBeNull();
    expect(dayTypeNotice('FIGHTING', 'Principal', ['Machamp Nv 80'], ['Lucario Nv 50'])?.body).toContain('Na equipe: Machamp Nv 80');
    expect(dayTypeNotice('FIGHTING', 'Principal', [], ['Lucario Nv 50'])?.body).toContain('Na coleção');
    expect(dayTypeNotice('FIGHTING', 'P', [], ['a', 'b', 'c', 'd', 'e'])?.body).toContain('e mais 2');
  });
});

describe('leitura da equipe (retorno da página)', () => {
  const raw = {estado:'ok', total:210, tipoDoDia:'FIGHTING', tipoFim:1_795_640_400_000, membros:[
    {chave:'1', ativo:true, equipe:true, nome:'Blastoise', nivel:219, potencia:2, tipos:['WATER'], look:55, tipoDoDia:false, melhor:{treinador:{nome:'Ancient Pupitar', regiao:'outland', valor:40_124_206.79}, ouro:{nome:'X', regiao:'', valor:581_484}, pokemon:null}},
    {chave:'1', nome:'duplicado', nivel:5},
    {chave:'2', nome:'<b>Ruim</b>‮', nivel:20, tipos:['FIRE', 'fire', 'X'.repeat(20)], melhor:{treinador:{nome:'Y', valor:-5}}},
  ]};
  it('aceita o formato real e descarta lixo', () => {
    const data = sanitizeTeamPick(raw);
    expect(data?.estado).toBe('ok');
    if (data?.estado !== 'ok') return;
    expect(data.membros).toHaveLength(2);
    expect(data.membros[1]!.tipos).toEqual(['FIRE']);
    expect(data.membros[1]!.melhor.treinador).toBeNull();
    expect(data.membros[1]!.nome).not.toMatch(/‮/);
    expect(data.tipoDoDia).toBe('FIGHTING');
  });
  it('estados sem dados passam; tipagem inválida vira nula', () => {
    expect(sanitizeTeamPick({estado:'sem-extensao'})).toEqual({estado:'sem-extensao'});
    expect(sanitizeTeamPick({estado:'ok', membros:[]})).toBeNull();
    const data = sanitizeTeamPick({...raw, tipoDoDia:'fighting'});
    expect(data?.estado === 'ok' && data.tipoDoDia).toBeNull();
    expect(sanitizeDayType({tipo:'FIGHTING', chave:'2026-11-25', equipe:['A Nv 1'], colecao:'x'})).toMatchObject({tipo:'FIGHTING', equipe:['A Nv 1'], colecao:[]});
    expect(sanitizeDayType({tipo:'drop table'})).toBeNull();
  });
  it('scripts fixos válidos, sem rede nem escrita', () => {
    for (const code of [TEAM_FULL_SCRIPT, TEAM_PROBE_SCRIPT, DAY_TYPE_SCRIPT]) {
      expect(() => new Function(`return ${code}`)).not.toThrow();
      for (const banned of ['fetch(', '.click(', 'innerHTML', 'localStorage', 'WebSocket', 'emit(']) expect(code).not.toContain(banned);
    }
  });
});

describe('preferências novas', () => {
  it('alertas: cria, edita, remove, limite 20; aviso da tipagem ligado por padrão', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-alerts-'));
    const prefs = new PreferencesStore(join(dir, 'app.sqlite'));
    try {
      expect(prefs.listMarketAlerts()).toEqual([]);
      prefs.saveMarketAlert('a1', {nome:'Venusaur', moeda:'gold', precoMax:15000});
      prefs.saveMarketAlert('a1', {nome:'Venusaur', moeda:'gold', precoMax:12000, ativo:false});
      expect(prefs.listMarketAlerts()).toMatchObject([{id:'a1', precoMax:12000, ativo:false}]);
      expect(() => prefs.saveMarketAlert('../x', {nome:'a'})).toThrow();
      for (let i = 2; i <= 20; i++) prefs.saveMarketAlert(`a${i}`, {nome:`p${i}`});
      expect(() => prefs.saveMarketAlert('a21', {nome:'x'})).toThrow('Limite de alertas');
      prefs.removeMarketAlert('a1');
      expect(prefs.listMarketAlerts()).toHaveLength(19);
      expect(() => prefs.removeMarketAlert('nao-existe')).toThrow();
      expect(prefs.getDayTypeNotify()).toBe(true);
      expect(prefs.setDayTypeNotify(false)).toBe(false);
      expect(() => prefs.setDayTypeNotify('x')).toThrow();
    } finally { prefs.close(); rmSync(dir, {recursive:true, force:true}); }
  });
});
