import type { CompareRequest, CompareRow, Forecast, ForecastInput, Hunt, HuntInput, Measurement, MeasurementInput, Objective, RankRequest, RankRow } from '../contracts/grindolino';
import { isProfileId } from './profiles';

/** Erro com mensagem segura para exibir ao usuário; qualquer outro erro vira mensagem genérica no IPC. */
export class GrindolinoError extends Error {}

const fail = (message: string) => new GrindolinoError(message);
const range = (label: string, min: number, max: number) => `${label} deve ser um inteiro entre ${min.toLocaleString('pt-BR')} e ${max.toLocaleString('pt-BR')}`;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('Dados inválidos');
  return value as Record<string, unknown>;
}
function text(value: unknown, min: number, max: number, message: string): string {
  if (typeof value !== 'string') throw fail(message);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw fail(message);
  return clean;
}
function int(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw fail(range(label,min,max));
  return value;
}
const optionalText = (value: unknown, max: number, message: string): string | null => value === null || value === undefined ? null : text(value,1,max,message);
const optionalInt = (value: unknown, label: string, min: number): number | null => value === null ? null : int(value,label,min);
function objective(value: unknown): Objective {
  if (value !== 'xp' && value !== 'coins') throw fail('Objetivo inválido');
  return value;
}
export function parseId(value: unknown, message = 'Identificador inválido'): string {
  if (!isProfileId(value)) throw fail(message);
  return value;
}
export function parseHuntInput(value: unknown): HuntInput {
  const input = record(value);
  return {name:text(input.name,1,60,'Nome da hunt deve ter de 1 a 60 caracteres'),region:text(input.region,0,40,'Região deve ter no máximo 40 caracteres'),requiredTrainerLevel:optionalInt(input.requiredTrainerLevel,'Nível exigido',1)};
}
export function parseForecastInput(value: unknown): ForecastInput {
  const input = record(value);
  const clean = {accountId:parseId(input.accountId,'Conta inválida'),huntId:parseId(input.huntId,'Hunt inválida'),xpPerHour:optionalInt(input.xpPerHour,'XP/h',0),coinsPerHour:optionalInt(input.coinsPerHour,'Coins/h',0)};
  if (clean.xpPerHour === null && clean.coinsPerHour === null) throw fail('Informe ao menos XP/h ou Coins/h');
  return clean;
}
export function parseMeasurementInput(value: unknown): Required<MeasurementInput> {
  const input = record(value);
  const clean = {accountId:parseId(input.accountId,'Conta inválida'),huntId:parseId(input.huntId,'Hunt inválida'),minutes:int(input.minutes,'Duração em minutos',1,1440),xpGained:optionalInt(input.xpGained,'XP ganho',0),coinsGained:optionalInt(input.coinsGained,'Total de coins ganhos',0),killCount:optionalInt(input.killCount ?? null,'Abates',0),shinyCount:optionalInt(input.shinyCount ?? null,'Shinies',0),
    pokemonKey:optionalText(input.pokemonKey,40,'Identificador do Pokémon inválido'),pokemonName:optionalText(input.pokemonName,60,'Nome do Pokémon inválido'),pokemonLevel:optionalInt(input.pokemonLevel ?? null,'Nível do Pokémon',1),pokemonLevelEnd:optionalInt(input.pokemonLevelEnd ?? null,'Nível final do Pokémon',1)};
  if (clean.xpGained === null && clean.coinsGained === null) throw fail('Informe ao menos XP ganho ou coins ganhos');
  return clean;
}
export function parseRankRequest(value: unknown): RankRequest {
  const input = record(value);
  return {accountId:parseId(input.accountId,'Conta inválida'),objective:objective(input.objective),trainerLevel:optionalInt(input.trainerLevel,'Nível da conta',1)};
}
export function parseCompareRequest(value: unknown): CompareRequest {
  return {objective:objective(record(value).objective)};
}

/** Chave de comparação de nomes de hunt: sem espaços nas pontas e sem diferenciar maiúsculas. */
export const huntKey = (name: string) => name.trim().toLowerCase();

const collator = new Intl.Collator('pt-BR');
// UUIDs têm tamanho fixo, então conta+hunt concatenados não colidem.
function aggregate(forecasts: readonly Forecast[], measurements: readonly Measurement[]) {
  const latest = new Map<string, Forecast>();
  for (const forecast of forecasts) {
    const id = forecast.accountId + forecast.huntId;
    const current = latest.get(id);
    if (!current || forecast.readAt >= current.readAt) latest.set(id,forecast);
  }
  const totals = new Map<string, {xp:number;xpMinutes:number;xpSamples:number;coins:number;coinsMinutes:number;coinsSamples:number;kills:number;killMinutes:number;shinies:number;shinyMinutes:number;samples:number;totalMinutes:number}>();
  for (const m of measurements) {
    const id = m.accountId + m.huntId;
    let total = totals.get(id);
    if (!total) totals.set(id, total = {xp:0,xpMinutes:0,xpSamples:0,coins:0,coinsMinutes:0,coinsSamples:0,kills:0,killMinutes:0,shinies:0,shinyMinutes:0,samples:0,totalMinutes:0});
    total.samples++; total.totalMinutes += m.minutes;
    if (m.xpGained !== null) { total.xp += m.xpGained; total.xpMinutes += m.minutes; total.xpSamples++; }
    if (m.coinsGained !== null) { total.coins += m.coinsGained; total.coinsMinutes += m.minutes; total.coinsSamples++; }
    if (m.killCount !== null) { total.kills += m.killCount; total.killMinutes += m.minutes; }
    if (m.shinyCount !== null) { total.shinies += m.shinyCount; total.shinyMinutes += m.minutes; }
  }
  return {latest,totals};
}
const byName = (a: Hunt, b: Hunt) => collator.compare(a.name,b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Ranking de uma conta: só aritmética sobre valores digitados; previsto e observado nunca são somados. */
export function rankHunts(hunts: readonly Hunt[], forecasts: readonly Forecast[], measurements: readonly Measurement[], request: RankRequest): RankRow[] {
  const {latest,totals} = aggregate(forecasts,measurements);
  const key = request.objective === 'xp' ? 'xpPerHour' : 'coinsPerHour';
  const rows = hunts.map((hunt): RankRow => {
    const read = latest.get(request.accountId + hunt.id);
    const total = totals.get(request.accountId + hunt.id);
    const forecast = read ? {xpPerHour:read.xpPerHour,coinsPerHour:read.coinsPerHour,readAt:read.readAt} : null;
    const observed = total ? {
      xpPerHour: total.xpMinutes ? total.xp / total.xpMinutes * 60 : null,
      coinsPerHour: total.coinsMinutes ? total.coins / total.coinsMinutes * 60 : null,
      killsPerHour: total.killMinutes ? total.kills / total.killMinutes * 60 : null,
      shinyPerHour: total.shinyMinutes ? total.shinies / total.shinyMinutes * 60 : null,
      samples: total.samples, totalMinutes: total.totalMinutes,
    } : null;
    const seen = observed?.[key] ?? null;
    const predicted = forecast?.[key] ?? null;
    const required = hunt.requiredTrainerLevel;
    const warnings: string[] = [];
    let ineligibleReason: string | null = null;
    if (required === null) warnings.push('Nível exigido desconhecido');
    else if (request.trainerLevel === null) warnings.push('Nível da conta não informado');
    else if (request.trainerLevel < required) ineligibleReason = `Requer nível ${required}; conta informou ${request.trainerLevel}`;
    if (observed && observed.totalMinutes < 30) warnings.push('Amostra pequena (< 30 min)');
    if (seen === null && predicted === null) warnings.push('Sem dados');
    return {
      hunt, eligible: ineligibleReason === null, ineligibleReason, forecast, observed,
      sortValue: seen ?? predicted,
      sortSource: seen !== null ? 'observed' : predicted !== null ? 'forecast' : null,
      deltaRatio: seen !== null && predicted !== null && predicted > 0 ? seen / predicted - 1 : null,
      warnings,
    };
  });
  return rows.sort((a,b) => Number(b.eligible) - Number(a.eligible)
    || (a.sortValue === null ? (b.sortValue === null ? 0 : 1) : b.sortValue === null ? -1 : b.sortValue - a.sortValue)
    || byName(a.hunt,b.hunt));
}

/** Comparação entre contas: uma célula por conta, na ordem de accountIds; valores nunca são somados entre contas. */
export function compareAccounts(hunts: readonly Hunt[], forecasts: readonly Forecast[], measurements: readonly Measurement[], accountIds: readonly string[], objective: Objective): CompareRow[] {
  const {latest,totals} = aggregate(forecasts,measurements);
  const xp = objective === 'xp';
  return [...hunts].sort(byName).map((hunt): CompareRow => {
    let bestAccountId: string | null = null, best = -Infinity;
    const missingAccountIds: string[] = [];
    const cells = accountIds.map(accountId => {
      const read = latest.get(accountId + hunt.id);
      const total = totals.get(accountId + hunt.id);
      // amostras e minutos contam só as medições que informaram a métrica do objetivo
      const totalMinutes = total ? xp ? total.xpMinutes : total.coinsMinutes : 0;
      const forecastPerHour = read ? xp ? read.xpPerHour : read.coinsPerHour : null;
      const observedPerHour = total && totalMinutes ? (xp ? total.xp : total.coins) / totalMinutes * 60 : null;
      const value = observedPerHour ?? forecastPerHour;
      if (value === null) missingAccountIds.push(accountId);
      else if (value > best) { best = value; bestAccountId = accountId; }
      return {accountId,forecastPerHour,observedPerHour,killsPerHour: total?.killMinutes ? total.kills / total.killMinutes * 60 : null,shinyPerHour: total?.shinyMinutes ? total.shinies / total.shinyMinutes * 60 : null,samples: total ? xp ? total.xpSamples : total.coinsSamples : 0,totalMinutes};
    });
    return {hunt,cells,bestAccountId,missingAccountIds};
  });
}
