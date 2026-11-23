import type { ForecastInput, HuntInput, MeasurementInput } from '../contracts/grindolino';
import { huntKey } from '../domain/grindolino';

export type Checked<T> = {ok:true; value:T} | {ok:false; error:string};
const fail = (error:string) => ({ok:false as const, error});

/** Inteiro >= 0 digitado em pt-BR ("1250000" ou "1.250.000"). Vazio = null; inválido = NaN. */
export function parseCount(text:string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(trimmed)) return NaN;
  const value = Number(trimmed.replaceAll('.',''));
  return Number.isSafeInteger(value) ? value : NaN;
}

export function checkHunt(fields:{name:string; region:string; level:string}): Checked<HuntInput> {
  const name = fields.name.trim(), region = fields.region.trim(), level = parseCount(fields.level);
  if (name.length < 1 || name.length > 60) return fail('Dê um nome à hunt, com até 60 caracteres.');
  if (region.length > 40) return fail('A região pode ter até 40 caracteres.');
  if (level !== null && !(level >= 1)) return fail('O nível exigido deve ser um número inteiro a partir de 1, ou ficar em branco.');
  return {ok:true, value:{name, region, requiredTrainerLevel:level}};
}

export function checkForecast(fields:{xp:string; coins:string}): Checked<Pick<ForecastInput,'xpPerHour'|'coinsPerHour'>> {
  const xpPerHour = parseCount(fields.xp), coinsPerHour = parseCount(fields.coins);
  if (Number.isNaN(xpPerHour) || Number.isNaN(coinsPerHour)) return fail('Use só números inteiros, como aparecem no Hunt Analyser do jogo (ex.: 1.250.000).');
  if (xpPerHour === null && coinsPerHour === null) return fail('Informe pelo menos um valor: XP/h ou Coins/h.');
  return {ok:true, value:{xpPerHour, coinsPerHour}};
}

export function checkMeasurement(fields:{minutes:string; xp:string; coins:string}): Checked<Pick<MeasurementInput,'minutes'|'xpGained'|'coinsGained'>> {
  const minutes = parseCount(fields.minutes), xpGained = parseCount(fields.xp), coinsGained = parseCount(fields.coins);
  if (minutes === null || !(minutes >= 1 && minutes <= 1440)) return fail('Informe a duração em minutos inteiros, de 1 a 1440 (24 horas).');
  if (Number.isNaN(xpGained) || Number.isNaN(coinsGained)) return fail('XP e Coins ganhos devem ser números inteiros (ex.: 1.250.000).');
  if (xpGained === null && coinsGained === null) return fail('Informe pelo menos um ganho: XP ou Coins.');
  return {ok:true, value:{minutes, xpGained, coinsGained}};
}

/** Formulário tem algo digitado diferente do valor inicial (espaços nas pontas não contam). */
export function fieldsChanged(initial:Record<string,string>, current:Record<string,string>): boolean {
  return Object.keys({...initial,...current}).some(key => (initial[key] ?? '').trim() !== (current[key] ?? '').trim());
}

const compact = new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
const percent = new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:0});
export const formatCompact = (value:number | null) => value === null ? '—' : compact.format(value);
export const formatFull = (value:number) => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value);

/** Diferença observado/previsto - 1 em texto e tom; a cor nunca é o único sinal. */
export function formatDelta(ratio:number): {text:string; tone:'up'|'down'|'flat'} {
  if (Math.abs(ratio) < 0.005) return {text:'Igual ao previsto', tone:'flat'};
  const amount = percent.format(Math.abs(ratio));
  return ratio > 0 ? {text:`${amount} acima do previsto`, tone:'up'} : {text:`${amount} abaixo do previsto`, tone:'down'};
}

// Ponte da lateral "Onde caçar?": transforma uma linha do /hunt na hunt e na previsão que o Grindolino aceita.
const rate = (value:number) => Number.isFinite(value) ? Math.max(0,Math.round(value)) : null;
export { huntKey };
export function forecastFromHunt(row:{nome:string; regiao:string; nivel:number; xpPorHora:number; ouroPorHora:number}): {hunt:HuntInput; rates:Pick<ForecastInput,'xpPerHour'|'coinsPerHour'>} {
 const region = row.regiao.trim();
 return {
  hunt:{name:row.nome.trim().slice(0,60).trim(),region:(region.charAt(0).toUpperCase() + region.slice(1)).slice(0,40).trim(),requiredTrainerLevel:Number.isSafeInteger(row.nivel) && row.nivel >= 1 ? row.nivel : null},
  rates:{xpPerHour:rate(row.xpPorHora),coinsPerHour:rate(row.ouroPorHora)},
 };
}
