import type { DatabaseSync as Database } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database';
import { compareAccounts, GrindolinoError, parseCompareRequest, parseForecastInput, parseHuntInput, parseId, parseMeasurementInput, parseRankRequest, rankHunts } from '../domain/grindolino';
import type { CompareRow, Forecast, Hunt, Measurement, RankRow } from '../contracts/grindolino';
import { buildExport, buildSeries, exportCsv, parseExportRequest, parseSeriesRequest, rangeStart } from '../domain/analytics';
import type { ExportRequest, SeriesResult } from '../contracts/analytics';

const HUNTS = 'SELECT id, name, region, required_trainer_level AS requiredTrainerLevel, created_at AS createdAt FROM grindolino_hunts';
const FORECASTS = 'SELECT id, account_id AS accountId, hunt_id AS huntId, xp_per_hour AS xpPerHour, coins_per_hour AS coinsPerHour, read_at AS readAt FROM grindolino_forecasts';
const MEASUREMENTS = 'SELECT id, account_id AS accountId, hunt_id AS huntId, minutes, xp_gained AS xpGained, coins_gained AS coinsGained, kill_count AS killCount, shiny_count AS shinyCount, pokemon_key AS pokemonKey, pokemon_name AS pokemonName, pokemon_level AS pokemonLevel, pokemon_level_end AS pokemonLevelEnd, recorded_at AS recordedAt FROM grindolino_measurements';

// Entradas chegam do renderer como unknown; toda validação é do domínio. Conta e hunt inexistentes viram GrindolinoError antes de chegar às FKs.
export class GrindolinoStore {
  private db: Database;
  constructor(path: string) { this.db = openDatabase(path); }
  // A FK continua sendo a garantia; esta checagem só dá a mensagem certa (a corrida com outra conexão cai no erro genérico).
  private requireRefs(input: {accountId: string; huntId: string}): void {
    if (!this.db.prepare('SELECT 1 FROM profiles WHERE id=?').get(input.accountId)) throw new GrindolinoError('Conta não encontrada');
    if (!this.db.prepare('SELECT 1 FROM grindolino_hunts WHERE id=?').get(input.huntId)) throw new GrindolinoError('Hunt não encontrada');
  }
  listHunts(): Hunt[] {
    return this.db.prepare(`${HUNTS} ORDER BY created_at, rowid`).all() as unknown as Hunt[];
  }
  createHunt(input: unknown): Hunt {
    const hunt = {...parseHuntInput(input),id:randomUUID(),createdAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO grindolino_hunts VALUES (?, ?, ?, ?, ?)').run(hunt.id,hunt.name,hunt.region,hunt.requiredTrainerLevel,hunt.createdAt);
    return hunt;
  }
  updateHunt(id: unknown, input: unknown): Hunt {
    const huntId = parseId(id,'Hunt inválida'); const clean = parseHuntInput(input);
    if (this.db.prepare('UPDATE grindolino_hunts SET name=?, region=?, required_trainer_level=? WHERE id=?').run(clean.name,clean.region,clean.requiredTrainerLevel,huntId).changes !== 1) throw new GrindolinoError('Hunt não encontrada');
    return this.db.prepare(`${HUNTS} WHERE id=?`).get(huntId) as unknown as Hunt;
  }
  removeHunt(id: unknown): void {
    if (this.db.prepare('DELETE FROM grindolino_hunts WHERE id=?').run(parseId(id,'Hunt inválida')).changes !== 1) throw new GrindolinoError('Hunt não encontrada');
  }
  addForecast(input: unknown): Forecast {
    const forecast = {...parseForecastInput(input),id:randomUUID(),readAt:new Date().toISOString()};
    this.requireRefs(forecast);
    this.db.prepare('INSERT INTO grindolino_forecasts VALUES (?, ?, ?, ?, ?, ?)').run(forecast.id,forecast.accountId,forecast.huntId,forecast.xpPerHour,forecast.coinsPerHour,forecast.readAt);
    return forecast;
  }
  addMeasurement(input: unknown): Measurement {
    const measurement = {...parseMeasurementInput(input),id:randomUUID(),recordedAt:new Date().toISOString()};
    this.requireRefs(measurement);
    this.db.prepare('INSERT INTO grindolino_measurements (id, account_id, hunt_id, minutes, xp_gained, coins_gained, recorded_at, kill_count, shiny_count, pokemon_key, pokemon_name, pokemon_level, pokemon_level_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(measurement.id,measurement.accountId,measurement.huntId,measurement.minutes,measurement.xpGained,measurement.coinsGained,measurement.recordedAt,measurement.killCount,measurement.shinyCount,measurement.pokemonKey,measurement.pokemonName,measurement.pokemonLevel,measurement.pokemonLevelEnd);
    return measurement;
  }
  removeMeasurement(id: unknown): void {
    if (this.db.prepare('DELETE FROM grindolino_measurements WHERE id=?').run(parseId(id,'Medição inválida')).changes !== 1) throw new GrindolinoError('Medição não encontrada');
  }
  listMeasurements(accountId: unknown): Measurement[] {
    return this.db.prepare(`${MEASUREMENTS} WHERE account_id=? ORDER BY recorded_at DESC, rowid DESC`).all(parseId(accountId,'Conta inválida')) as unknown as Measurement[];
  }
  rank(request: unknown): RankRow[] {
    const clean = parseRankRequest(request);
    return rankHunts(this.listHunts(), this.db.prepare(`${FORECASTS} WHERE account_id=?`).all(clean.accountId) as unknown as Forecast[], this.listMeasurements(clean.accountId), clean);
  }
  compare(request: unknown): CompareRow[] {
    const clean = parseCompareRequest(request);
    const accountIds = (this.db.prepare('SELECT id FROM profiles ORDER BY createdAt, rowid').all() as {id: string}[]).map(row => row.id); // mesma ordem de ProfileStore.list
    return compareAccounts(this.listHunts(), this.db.prepare(FORECASTS).all() as unknown as Forecast[], this.db.prepare(MEASUREMENTS).all() as unknown as Measurement[], accountIds, clean.objective);
  }
  // Analytics: o período e a conta filtram no índice (account_id, recorded_at); previsões anteriores ao período continuam valendo como "vigentes".
  private history(scope: ExportRequest['scope'], now: Date) {
    const accounts = this.db.prepare('SELECT id, label AS name FROM profiles ORDER BY createdAt, rowid').all() as {id: string; name: string}[]; // mesma ordem de ProfileStore.list
    const ids = scope.accountId === null ? accounts.map(account => account.id) : [scope.accountId];
    const from = rangeStart(scope.range,now) ?? '';
    const measurements = this.db.prepare(`${MEASUREMENTS} WHERE account_id=? AND recorded_at>=? ORDER BY recorded_at`), forecasts = this.db.prepare(`${FORECASTS} WHERE account_id=?`);
    return {accounts, measurements:ids.flatMap(id => measurements.all(id,from) as unknown as Measurement[]), forecasts:ids.flatMap(id => forecasts.all(id) as unknown as Forecast[])};
  }
  series(request: unknown, now = new Date()): SeriesResult {
    const clean = parseSeriesRequest(request);
    const {accounts,measurements,forecasts} = this.history(clean,now);
    return buildSeries(measurements,forecasts,accounts.map(account => account.id),clean,now);
  }
  /** Conteúdo do arquivo de exportação: só apelidos, nomes de hunt, medições, previsões e agregados. */
  exportFile(request: unknown, now = new Date()): {format: 'csv' | 'json'; content: string; rows: number} {
    const clean = parseExportRequest(request);
    const {accounts,measurements,forecasts} = this.history(clean.scope,now);
    const data = buildExport(measurements,forecasts,accounts,this.listHunts(),clean.scope,now);
    return {format:clean.format, content:clean.format === 'csv' ? exportCsv(data) : `${JSON.stringify(data,null,2)}\n`, rows:data.measurements.length + data.forecasts.length};
  }
  close(): void { this.db.close(); }
}
