import { describe, expect, it } from 'vitest';
import { buildExport, buildSeries, dedupeMeasurements, exportCsv, parseExportRequest, parseSeriesRequest, rangeStart, toCsv } from '../domain/analytics';
import { GrindolinoError } from '../domain/grindolino';
import type { Forecast, Measurement } from '../contracts/grindolino';
import type { SeriesRequest } from '../contracts/analytics';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const H = '33333333-3333-4333-8333-333333333333', H2 = '44444444-4444-4444-8444-444444444444';
// Horários locais: os testes valem em qualquer fuso.
const at = (day: number, hour = 12, month = 10) => new Date(2026,month,day,hour).toISOString();
const now = new Date(2026,10,10,18);
let seq = 0;
const m = (over: Partial<Measurement>): Measurement => ({id:`m${seq++}`,accountId:A,huntId:H,minutes:60,xpGained:1000,coinsGained:null,killCount:null,shinyCount:null,pokemonKey:null,pokemonName:null,pokemonLevel:null,pokemonLevelEnd:null,recordedAt:at(10),...over});
const f = (over: Partial<Forecast>): Forecast => ({id:`f${seq++}`,accountId:A,huntId:H,xpPerHour:2000,coinsPerHour:null,readAt:at(1),...over});
const request = (over: Partial<SeriesRequest> = {}): SeriesRequest => ({accountId:null,huntId:null,metric:'xp',range:'30d',...over});

describe('séries do histórico', () => {
  it('pondera a taxa por minutos e agrupa pelo dia local, inclusive perto da meia-noite', () => {
    const result = buildSeries([m({minutes:30,xpGained:300,recordedAt:at(9,23)}),m({minutes:90,xpGained:2700,recordedAt:at(10,0)}),m({minutes:30,xpGained:300,recordedAt:at(10,23)})],[],[A],request(),now);
    expect(result.granularity).toBe('day');
    expect(result.series[0]?.points).toEqual([
      {bucket:'2026-11-09',perHour:600,samples:1,minutes:30,small:false,forecastPerHour:null},
      {bucket:'2026-11-10',perHour:1500,samples:2,minutes:120,small:false,forecastPerHour:null}, // (2700+300)/120 min, não a média de 1800 e 600
    ]);
    expect(result.series[0]?.summary).toMatchObject({perHour:1320,samples:3,minutes:150});
  });
  it('só conta as medições que informaram a métrica e marca amostra pequena', () => {
    const rows = [m({minutes:20,xpGained:null,coinsGained:50,killCount:40,shinyCount:1}),m({minutes:60,xpGained:900,recordedAt:at(10,13)})];
    const kills = buildSeries(rows,[],[A],request({metric:'kills'}),now).series[0];
    expect(kills?.points).toEqual([{bucket:'2026-11-10',perHour:120,samples:1,minutes:20,small:true,forecastPerHour:null}]);
    expect(kills?.summary.small).toBe(true);
    expect(buildSeries(rows,[],[A],request({metric:'shiny'}),now).series[0]?.points[0]?.perHour).toBe(3);
    expect(buildSeries(rows,[],[A],request({metric:'coins'}),now).series[0]?.points[0]?.perHour).toBe(150);
    expect(buildSeries(rows,[],[A],request({metric:'xp'}),now).series[0]?.points[0]).toMatchObject({perHour:900,samples:1,small:false});
  });
  it('ignora medições idênticas e mantém as que diferem em algum valor', () => {
    const base = m({});
    const {unique,duplicates} = dedupeMeasurements([base,{...base,id:'cópia'},{...base,id:'outra',minutes:61},{...base,id:'conta-b',accountId:B}]);
    expect(unique.map(row => row.id)).toEqual([base.id,'outra','conta-b']);
    expect(duplicates).toBe(1);
    const result = buildSeries([base,{...base,id:'cópia'}],[],[A],request(),now);
    expect(result.duplicatesIgnored).toBe(1);
    expect(result.series[0]?.summary).toMatchObject({samples:1,minutes:60,perHour:1000});
  });
  it('deixa as contas lado a lado, na ordem dos perfis, sem somar', () => {
    const result = buildSeries([m({accountId:B,xpGained:500}),m({xpGained:3000})],[],[A,B],request(),now);
    expect(result.series.map(series => [series.accountId,series.summary.perHour])).toEqual([[A,3000],[B,500]]);
    expect(buildSeries([m({accountId:B})],[],[A,B],request({accountId:A}),now).series).toEqual([{accountId:A,points:[],summary:{perHour:null,samples:0,minutes:0,small:false,forecastPerHour:null,deltaRatio:null}}]);
  });
  it('usa a previsão vigente em cada data e nunca a soma ao observado', () => {
    const forecasts = [f({xpPerHour:2000,readAt:at(1,12,9)}),f({xpPerHour:4000,readAt:at(8)}),f({xpPerHour:9999,huntId:H2,readAt:at(9)}),f({xpPerHour:7777,accountId:B,readAt:at(9)}),f({xpPerHour:null,coinsPerHour:5,readAt:at(9)})];
    const rows = [m({xpGained:1000,recordedAt:at(5)}),m({xpGained:3000,recordedAt:at(9)})];
    const series = buildSeries(rows,forecasts,[A],request({huntId:H}),now).series[0];
    expect(series?.points).toEqual([
      {bucket:'2026-11-05',perHour:1000,samples:1,minutes:60,small:false,forecastPerHour:2000}, // lida antes do período, ainda vigente
      {bucket:'2026-11-08',perHour:null,samples:0,minutes:0,small:false,forecastPerHour:4000},
      {bucket:'2026-11-09',perHour:3000,samples:1,minutes:60,small:false,forecastPerHour:4000},
    ]);
    expect(series?.summary).toMatchObject({perHour:2000,forecastPerHour:4000,deltaRatio:-0.5});
    // sem hunt escolhida, ou em métrica que o jogo não prevê, não há previsto
    expect(buildSeries(rows,forecasts,[A],request(),now).series[0]?.points.every(point => point.forecastPerHour === null)).toBe(true);
    expect(buildSeries([m({killCount:10})],forecasts,[A],request({huntId:H,metric:'kills'}),now).series[0]?.points).toEqual([expect.objectContaining({forecastPerHour:null})]);
  });
  it('respeita o período a partir da meia-noite local e agrupa por semana acima de 60 dias', () => {
    expect(rangeStart('7d',now)).toBe(new Date(2026,10,4).toISOString());
    expect(rangeStart('all',now)).toBeNull();
    const rows = [m({recordedAt:at(3,23)}),m({recordedAt:at(4,0)})];
    expect(buildSeries(rows,[],[A],request({range:'7d'}),now).series[0]?.points.map(point => point.bucket)).toEqual(['2026-11-04']);
    // 2026-08-12 é quarta e 2026-11-10 é terça: os períodos começam nas segundas 10/08 e 09/11
    const long = buildSeries([m({recordedAt:at(12,12,7)}),m({recordedAt:at(14,12,7),xpGained:3000}),m({})],[],[A],request({range:'all'}),now);
    expect(long.granularity).toBe('week');
    expect(long.series[0]?.points.map(point => [point.bucket,point.perHour,point.samples])).toEqual([['2026-08-10',2000,2],['2026-11-09',1000,1]]);
    expect(buildSeries([m({recordedAt:at(12,12,8)}),m({})],[],[A],request({range:'90d'}),now).granularity).toBe('day'); // 59 dias
  });
  it('agrega 50.000 medições em tempo n log n', () => {
    const rows = Array.from({length:50_000},(_,index) => m({accountId:index % 2 ? A : B,recordedAt:new Date(now.getTime() - index * 600_000).toISOString(),xpGained:index}));
    const forecasts = Array.from({length:2_000},(_,index) => f({readAt:new Date(now.getTime() - index * 3_600_000).toISOString()}));
    const started = performance.now();
    const result = buildSeries(rows,forecasts,[A,B],request({range:'all',huntId:H}),now);
    const elapsed = performance.now() - started;
    expect(result.series.reduce((total,series) => total + series.summary.samples,0)).toBe(50_000);
    expect(elapsed).toBeLessThan(1500);
    console.info(`buildSeries 50.000 medições/2.000 previsões: ${elapsed.toFixed(1)} ms`);
  });
});

describe('pedidos do histórico', () => {
  it('valida conta, hunt, métrica, período e formato', () => {
    expect(parseSeriesRequest({accountId:null,huntId:H,metric:'shiny',range:'all',extra:1})).toEqual({accountId:null,huntId:H,metric:'shiny',range:'all'});
    for (const bad of [null,[],{},{accountId:'x',huntId:null,metric:'xp',range:'7d'},{accountId:null,huntId:1,metric:'xp',range:'7d'},{accountId:null,huntId:null,metric:'toString',range:'7d'},{accountId:null,huntId:null,metric:'xp',range:'constructor'},{huntId:null,metric:'xp',range:'7d'}])
      expect(() => parseSeriesRequest(bad)).toThrow(GrindolinoError);
    expect(parseExportRequest({format:'json',scope:{accountId:A,huntId:null,range:'90d'}})).toEqual({format:'json',scope:{accountId:A,huntId:null,range:'90d'}});
    for (const bad of [null,{format:'xlsx',scope:{accountId:null,huntId:null,range:'7d'}},{format:'csv'},{format:'csv',scope:{accountId:null,huntId:null,range:'1y'}}])
      expect(() => parseExportRequest(bad)).toThrow(GrindolinoError);
  });
});

describe('exportação', () => {
  it('escapa aspas, separador, quebras de linha e fórmulas; usa BOM, CRLF e vírgula decimal', () => {
    expect(toCsv([['a','b'],['x;y','diz "oi"'],['linha\nnova',null],['=1+1','+55'],['-2','@cmd'],['\tx',' ok'],[-3,1.5],[1200,0.004]]))
      .toBe('\uFEFFa;b\r\n"x;y";"diz ""oi"""\r\n"linha\nnova";\r\n\'=1+1;\'+55\r\n\'-2;\'@cmd\r\n\'\tx; ok\r\n-3;1,50\r\n1200;0,00\r\n');
    expect(toCsv([['=a;"b"']])).toBe('\uFEFF"\'=a;""b"""\r\n');
  });
  it('exporta medições, previsões e agregados por apelido, sem identificadores nem duplicatas', () => {
    const rows = [m({minutes:30,xpGained:600,coinsGained:90,killCount:50,shinyCount:1,pokemonKey:'instancia-77',pokemonName:'Sunflora',pokemonLevel:10,pokemonLevelEnd:11,recordedAt:at(10,9)}),m({minutes:90,xpGained:600,recordedAt:at(10,15)}),m({accountId:B,huntId:H2,recordedAt:at(1,12,5)})];
    const data = buildExport([...rows,{...rows[0]!,id:'cópia'}],[f({}),f({readAt:at(1,12,5)})],[{id:A,name:'=Main'},{id:B,name:'=Main'}],[{id:H,name:'Caverna; "funda"'},{id:H2,name:'Bosque'}],{accountId:null,huntId:null,range:'30d'},now);
    expect(data).toMatchObject({app:'PokéHub',formatVersion:1,range:'30d',duplicatesIgnored:1,exportedAt:now.toISOString()});
    expect(data.measurements).toHaveLength(2); // a de junho está fora do período
    expect(data.forecasts).toEqual([{account:'=Main',hunt:'Caverna; "funda"',readAt:at(1),xpPerHour:2000,coinsPerHour:null}]);
    expect(data.daily).toEqual([{date:'2026-11-10',account:'=Main',hunt:'Caverna; "funda"',samples:2,minutes:120,xpGained:1200,coinsGained:90,killCount:50,shinyCount:1,xpPerHour:600,coinsPerHour:180,killsPerHour:100,shinyPerHour:2}]);
    expect(buildExport(rows,[],[{id:A,name:'Main'},{id:B,name:'Main'}],[{id:H,name:'Caverna'},{id:H2,name:'Bosque'}],{accountId:B,huntId:null,range:'all'},now).measurements).toEqual([expect.objectContaining({account:'Main (2)',hunt:'Bosque'})]);
    const json = JSON.stringify(data), csv = exportCsv(data);
    for (const secret of [A,B,H,H2,'instancia-77','accountId','emailLabel','@example']) { expect(json).not.toContain(secret); expect(csv).not.toContain(secret); }
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('\uFEFFtipo;data;conta;hunt;minutos;amostras;xp;ouro;abates;shinies;xp_por_hora;ouro_por_hora;abates_por_hora;shiny_por_hora;pokemon;nivel_inicio;nivel_fim');
    expect(lines[1]).toBe('medicao;2026-11-10 09:00;\'=Main;"Caverna; ""funda""";30;1;600;90;50;1;;;;;Sunflora;10;11');
    expect(lines[3]).toBe('previsao_do_jogo;2026-11-01 12:00;\'=Main;"Caverna; ""funda""";;;;;;;2000;;;;;;');
    expect(lines[4]).toBe('agregado_dia;2026-11-10;\'=Main;"Caverna; ""funda""";120;2;1200;90;50;1;600;180;100;2;;;');
    expect(lines).toHaveLength(6);
  });
});
