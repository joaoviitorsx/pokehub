import { SMALL_SAMPLE_MINUTES, type AccountSeries, type AnalyticsRange, type ExportRequest, type Metric, type SeriesPoint, type SeriesRequest, type SeriesResult } from '../contracts/analytics';
import type { Forecast, Measurement } from '../contracts/grindolino';
import { GrindolinoError, parseId } from './grindolino';

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {'7d':7, '30d':30, '90d':90, all:null};
const GAIN: Record<Metric, (m: Measurement) => number | null> = {xp:m => m.xpGained, coins:m => m.coinsGained, kills:m => m.killCount, shiny:m => m.shinyCount};
// O jogo só prevê XP/h e ouro/h; abates e shinies não têm previsto.
const PREDICTED: Record<Metric, (f: Forecast) => number | null> = {xp:f => f.xpPerHour, coins:f => f.coinsPerHour, kills:() => null, shiny:() => null};
const METRICS = Object.keys(GAIN);
const WEEK_AFTER_DAYS = 60;

function parseScope(value: unknown): ExportRequest['scope'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new GrindolinoError('Dados inválidos');
  const input = value as Record<string, unknown>;
  if (typeof input.range !== 'string' || !Object.hasOwn(RANGE_DAYS,input.range)) throw new GrindolinoError('Período inválido');
  return {accountId:input.accountId === null ? null : parseId(input.accountId,'Conta inválida'), huntId:input.huntId === null ? null : parseId(input.huntId,'Hunt inválida'), range:input.range as AnalyticsRange};
}
export function parseSeriesRequest(value: unknown): SeriesRequest {
  const scope = parseScope(value);
  const metric = (value as Record<string, unknown>).metric;
  if (typeof metric !== 'string' || !METRICS.includes(metric)) throw new GrindolinoError('Métrica inválida');
  return {...scope, metric:metric as Metric};
}
export function parseExportRequest(value: unknown): ExportRequest {
  if (typeof value !== 'object' || value === null) throw new GrindolinoError('Dados inválidos');
  const input = value as Record<string, unknown>;
  if (input.format !== 'csv' && input.format !== 'json') throw new GrindolinoError('Formato inválido');
  return {format:input.format, scope:parseScope(input.scope)};
}

// Todo agrupamento usa o fuso local do processo: o mesmo `Date` decide o início do período e o dia de cada medição.
const pad = (value: number) => String(value).padStart(2,'0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function bucketKey(iso: string, week: boolean): string {
  const date = new Date(iso);
  if (week) date.setDate(date.getDate() - (date.getDay() + 6) % 7); // segunda-feira da semana
  return dayKey(date);
}
/** Data local AAAA-MM-DD → Date à meia-noite local. */
export function bucketDate(bucket: string): Date {
  const [year = 0,month = 1,day = 1] = bucket.split('-').map(Number);
  return new Date(year,month - 1,day);
}
/** Início do período em ISO (meia-noite local de N-1 dias atrás, para incluir hoje); null = tudo. */
export function rangeStart(range: AnalyticsRange, now: Date): string | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : new Date(now.getFullYear(),now.getMonth(),now.getDate() - (days - 1)).toISOString();
}

/** RF-11: medições idênticas (mesma conta, hunt, instante e valores) contam uma vez. */
export function dedupeMeasurements(measurements: readonly Measurement[]): {unique: Measurement[]; duplicates: number} {
  const seen = new Set<string>();
  const unique = measurements.filter(m => {
    const key = [m.accountId,m.huntId,m.recordedAt,m.minutes,m.xpGained,m.coinsGained,m.killCount,m.shinyCount].join('|');
    return !seen.has(key) && Boolean(seen.add(key));
  });
  return {unique, duplicates:measurements.length - unique.length};
}
const inScope = <T extends {accountId: string; huntId: string}>(rows: readonly T[], accounts: ReadonlySet<string>, huntId: string | null) => rows.filter(row => accounts.has(row.accountId) && (huntId === null || row.huntId === huntId));
const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rate = (gain: number, minutes: number) => minutes > 0 ? gain * 60 / minutes : null; // multiplica antes: taxas inteiras saem exatas

/**
 * Séries por conta, por dia local (por semana quando os dados cobrem mais de 60 dias). Taxas ponderadas por minutos.
 * Contas ficam lado a lado, nunca somadas; previsto e observado também não. O(n log n) pelo sort de períodos e previsões.
 */
export function buildSeries(measurements: readonly Measurement[], forecasts: readonly Forecast[], accountIds: readonly string[], request: SeriesRequest, now: Date): SeriesResult {
  const accounts = new Set(request.accountId === null ? accountIds : accountIds.filter(id => id === request.accountId));
  const from = rangeStart(request.range,now);
  const gainOf = GAIN[request.metric], predictedOf = PREDICTED[request.metric];
  const {unique,duplicates} = dedupeMeasurements(inScope(measurements,accounts,request.huntId).filter(m => from === null || m.recordedAt >= from));
  // Sem hunt escolhida não há previsto: uma previsão vale para uma hunt, e a série mistura várias.
  const reads = request.huntId === null ? [] : inScope(forecasts,accounts,request.huntId).filter(f => predictedOf(f) !== null).sort((a,b) => byText(a.readAt,b.readAt));
  const shown = reads.filter(f => from === null || f.readAt >= from);

  let first = '', last = '';
  for (const {at} of [...unique.map(m => ({at:m.recordedAt})),...shown.map(f => ({at:f.readAt}))]) {
    if (first === '' || at < first) first = at;
    if (at > last) last = at;
  }
  const week = first !== '' && Math.round((bucketDate(bucketKey(last,false)).getTime() - bucketDate(bucketKey(first,false)).getTime()) / 86_400_000) > WEEK_AFTER_DAYS;

  const totals = new Map<string, Map<string, {gain: number; minutes: number; samples: number}>>();
  for (const m of unique) {
    const gain = gainOf(m);
    if (gain === null) continue;
    let buckets = totals.get(m.accountId);
    if (!buckets) totals.set(m.accountId,buckets = new Map());
    const key = bucketKey(m.recordedAt,week);
    let total = buckets.get(key);
    if (!total) buckets.set(key,total = {gain:0,minutes:0,samples:0});
    total.gain += gain; total.minutes += m.minutes; total.samples++;
  }

  const series = [...accounts].map((accountId): AccountSeries => {
    const buckets = totals.get(accountId) ?? new Map<string, {gain: number; minutes: number; samples: number}>();
    const own = reads.filter(f => f.accountId === accountId).map(f => ({key:bucketKey(f.readAt,week), value:predictedOf(f), visible:from === null || f.readAt >= from}));
    const keys = new Set(buckets.keys());
    for (const read of own) if (read.visible) keys.add(read.key);
    let next = 0, current: number | null = null, gain = 0, minutes = 0, samples = 0;
    const points = [...keys].sort().map((bucket): SeriesPoint => {
      for (let read = own[next]; read && read.key <= bucket; read = own[++next]) current = read.value; // vigente = última lida até o fim do período
      const total = buckets.get(bucket);
      if (total) { gain += total.gain; minutes += total.minutes; samples += total.samples; }
      return {bucket, perHour:total ? rate(total.gain,total.minutes) : null, samples:total?.samples ?? 0, minutes:total?.minutes ?? 0, small:total !== undefined && total.minutes < SMALL_SAMPLE_MINUTES, forecastPerHour:current};
    });
    const perHour = rate(gain,minutes), forecastPerHour = own.at(-1)?.value ?? null;
    return {accountId, points, summary:{perHour, samples, minutes, small:samples > 0 && minutes < SMALL_SAMPLE_MINUTES, forecastPerHour, deltaRatio:perHour !== null && forecastPerHour !== null && forecastPerHour > 0 ? perHour / forecastPerHour - 1 : null}};
  });
  return {metric:request.metric, granularity:week ? 'week' : 'day', series, duplicatesIgnored:duplicates};
}

// ---- Exportação (RF-12): só medições, previsões e agregados, identificados por apelido da conta e nome da hunt. ----

export interface Named { id: string; name: string }
export interface ExportData {
  app: 'PokéHub';
  formatVersion: 1;
  exportedAt: string;
  timezone: string; // fuso usado em `daily.date`; os instantes são ISO em UTC
  range: AnalyticsRange;
  duplicatesIgnored: number;
  measurements: {account: string; hunt: string; recordedAt: string; minutes: number; xpGained: number | null; coinsGained: number | null; killCount: number | null; shinyCount: number | null; pokemonName: string | null; pokemonLevel: number | null; pokemonLevelEnd: number | null}[];
  forecasts: {account: string; hunt: string; readAt: string; xpPerHour: number | null; coinsPerHour: number | null}[];
  /** Por conta, hunt e dia local. Cada taxa divide pelo tempo das medições que informaram aquela métrica. */
  daily: {date: string; account: string; hunt: string; samples: number; minutes: number; xpGained: number | null; coinsGained: number | null; killCount: number | null; shinyCount: number | null; xpPerHour: number | null; coinsPerHour: number | null; killsPerHour: number | null; shinyPerHour: number | null}[];
}
// Nomes repetidos ganham sufixo para as linhas não se confundirem; o identificador interno não sai do aplicativo.
function nameMap(items: readonly Named[]): Map<string, string> {
  const used = new Map<string, number>();
  return new Map(items.map(item => {
    const count = (used.get(item.name) ?? 0) + 1;
    used.set(item.name,count);
    return [item.id, count === 1 ? item.name : `${item.name} (${count})`];
  }));
}
export function buildExport(measurements: readonly Measurement[], forecasts: readonly Forecast[], accounts: readonly Named[], hunts: readonly Named[], scope: ExportRequest['scope'], now: Date): ExportData {
  const ids = new Set(accounts.filter(account => scope.accountId === null || account.id === scope.accountId).map(account => account.id));
  const from = rangeStart(scope.range,now);
  const accountName = nameMap(accounts), huntName = nameMap(hunts);
  const {unique,duplicates} = dedupeMeasurements(inScope(measurements,ids,scope.huntId).filter(m => from === null || m.recordedAt >= from));
  unique.sort((a,b) => byText(a.recordedAt,b.recordedAt));
  const days = new Map<string, {date: string; account: string; hunt: string; samples: number; minutes: number; sums: Record<Metric, {gain: number; minutes: number}>}>();
  for (const m of unique) {
    const date = bucketKey(m.recordedAt,false), key = `${date}|${m.accountId}|${m.huntId}`;
    let day = days.get(key);
    if (!day) days.set(key,day = {date, account:accountName.get(m.accountId) ?? '', hunt:huntName.get(m.huntId) ?? '', samples:0, minutes:0, sums:{xp:{gain:0,minutes:0},coins:{gain:0,minutes:0},kills:{gain:0,minutes:0},shiny:{gain:0,minutes:0}}});
    day.samples++; day.minutes += m.minutes;
    for (const metric of METRICS as Metric[]) {
      const gain = GAIN[metric](m);
      if (gain !== null) { day.sums[metric].gain += gain; day.sums[metric].minutes += m.minutes; }
    }
  }
  const sum = (total: {gain: number; minutes: number}) => total.minutes > 0 ? total.gain : null;
  return {
    app:'PokéHub', formatVersion:1, exportedAt:now.toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, range:scope.range, duplicatesIgnored:duplicates,
    measurements:unique.map(m => ({account:accountName.get(m.accountId) ?? '', hunt:huntName.get(m.huntId) ?? '', recordedAt:m.recordedAt, minutes:m.minutes, xpGained:m.xpGained, coinsGained:m.coinsGained, killCount:m.killCount, shinyCount:m.shinyCount, pokemonName:m.pokemonName, pokemonLevel:m.pokemonLevel, pokemonLevelEnd:m.pokemonLevelEnd})),
    forecasts:inScope(forecasts,ids,scope.huntId).filter(f => from === null || f.readAt >= from).sort((a,b) => byText(a.readAt,b.readAt)).map(f => ({account:accountName.get(f.accountId) ?? '', hunt:huntName.get(f.huntId) ?? '', readAt:f.readAt, xpPerHour:f.xpPerHour, coinsPerHour:f.coinsPerHour})),
    daily:[...days.values()].map(({sums,...day}) => ({...day, xpGained:sum(sums.xp), coinsGained:sum(sums.coins), killCount:sum(sums.kills), shinyCount:sum(sums.shiny), xpPerHour:rate(sums.xp.gain,sums.xp.minutes), coinsPerHour:rate(sums.coins.gain,sums.coins.minutes), killsPerHour:rate(sums.kills.gain,sums.kills.minutes), shinyPerHour:rate(sums.shiny.gain,sums.shiny.minutes)})),
  };
}

type Cell = string | number | null;
function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.',','); // vírgula decimal: o separador é ';'
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; // texto que o Excel executaria como fórmula
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g,'""')}"` : safe;
}
/** CSV para Excel em pt-BR: UTF-8 com BOM, ';' como separador e CRLF. */
export const toCsv = (rows: readonly (readonly Cell[])[]) => `\uFEFF${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}\r\n`;

const localTime = (iso: string) => { const date = new Date(iso); return `${dayKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`; };
/** Uma tabela só, com a coluna `tipo` separando medição, previsão do jogo e agregado do dia. Datas no fuso local. */
export function exportCsv(data: ExportData): string {
  return toCsv([
    ['tipo','data','conta','hunt','minutos','amostras','xp','ouro','abates','shinies','xp_por_hora','ouro_por_hora','abates_por_hora','shiny_por_hora','pokemon','nivel_inicio','nivel_fim'],
    ...data.measurements.map((m): Cell[] => ['medicao',localTime(m.recordedAt),m.account,m.hunt,m.minutes,1,m.xpGained,m.coinsGained,m.killCount,m.shinyCount,null,null,null,null,m.pokemonName,m.pokemonLevel,m.pokemonLevelEnd]),
    ...data.forecasts.map((f): Cell[] => ['previsao_do_jogo',localTime(f.readAt),f.account,f.hunt,null,null,null,null,null,null,f.xpPerHour,f.coinsPerHour,null,null,null,null,null]),
    ...data.daily.map((d): Cell[] => ['agregado_dia',d.date,d.account,d.hunt,d.minutes,d.samples,d.xpGained,d.coinsGained,d.killCount,d.shinyCount,d.xpPerHour,d.coinsPerHour,d.killsPerHour,d.shinyPerHour,null,null,null]),
  ]);
}
