// Professor Grindolino — modo básico (Etapa B). Só dados digitados pelo usuário; nenhum cálculo de combate.
// Fonte dos números: "previsão" = lida no Hunt Analyser do próprio jogo; "medição" = ganho observado pelo usuário.

export interface Hunt {
  id: string; // UUID local
  name: string; // 1–60 caracteres
  region: string; // 0–40 caracteres, livre
  requiredTrainerLevel: number | null; // inteiro >= 1, null = desconhecido
  createdAt: string;
}
export type HuntInput = Pick<Hunt, 'name' | 'region' | 'requiredTrainerLevel'>;

/** Previsão exibida pelo jogo e digitada pelo usuário (taxas por hora, inteiros >= 0). */
export interface Forecast {
  id: string;
  accountId: string;
  huntId: string;
  xpPerHour: number | null;
  coinsPerHour: number | null;
  readAt: string; // ISO
}
export type ForecastInput = Pick<Forecast, 'accountId' | 'huntId' | 'xpPerHour' | 'coinsPerHour'>;

/** Sessão de medição (digitada ou ao vivo): ganhos totais em um intervalo. xpGained é XP do treinador nas medições ao vivo. */
export interface Measurement {
  id: string;
  accountId: string;
  huntId: string;
  minutes: number; // inteiro 1–1440
  xpGained: number | null; // inteiro >= 0
  coinsGained: number | null;
  killCount: number | null; // abates no intervalo; null = não informado (medição digitada)
  shinyCount: number | null; // capturas Shiny no intervalo; null = não informado
  /** Pokémon em campo durante a medição ao vivo (id da instância que o jogo informa); null = desconhecido. */
  pokemonKey: string | null; // 1–40 caracteres
  pokemonName: string | null; // 1–60 caracteres
  pokemonLevel: number | null; // nível no início
  pokemonLevelEnd: number | null; // nível no fim
  recordedAt: string;
}
export type MeasurementInput = Pick<Measurement, 'accountId' | 'huntId' | 'minutes' | 'xpGained' | 'coinsGained'> & Partial<Pick<Measurement, 'killCount' | 'shinyCount' | 'pokemonKey' | 'pokemonName' | 'pokemonLevel' | 'pokemonLevelEnd'>>;

export type Objective = 'xp' | 'coins';
export type RateSource = 'forecast' | 'observed';

/** Linha do ranking de uma conta. Previsto e observado nunca são somados. */
export interface RankRow {
  hunt: Hunt;
  eligible: boolean;
  ineligibleReason: string | null; // ex.: "Requer nível 200; conta informou 150"
  forecast: { xpPerHour: number | null; coinsPerHour: number | null; readAt: string } | null;
  /** killsPerHour e shinyPerHour só consideram as medições que informaram a contagem. */
  observed: { xpPerHour: number | null; coinsPerHour: number | null; killsPerHour: number | null; shinyPerHour: number | null; samples: number; totalMinutes: number } | null;
  /** Valor usado para ordenar e de onde veio; observado tem prioridade quando existir. */
  sortValue: number | null;
  sortSource: RateSource | null;
  /** observado/previsto - 1, só quando ambos existem para o objetivo. */
  deltaRatio: number | null;
  warnings: string[];
}

export interface RankRequest {
  accountId: string;
  objective: Objective;
  trainerLevel: number | null;
}

/** Comparação entre contas (spec 9.9): uma linha por hunt, uma célula por conta. Sem soma entre contas. */
export interface CompareCell {
  accountId: string;
  forecastPerHour: number | null; // do objetivo pedido
  observedPerHour: number | null;
  killsPerHour: number | null; // observados, independentes do objetivo
  shinyPerHour: number | null;
  samples: number;
  totalMinutes: number;
}
export interface CompareRow {
  hunt: Hunt;
  cells: CompareCell[]; // mesma ordem de perfis de profiles:list
  /** Conta com maior valor do objetivo (observado > previsto), null se nenhuma tem dado. */
  bestAccountId: string | null;
  missingAccountIds: string[]; // contas sem previsão nem medição para o objetivo
}
export interface CompareRequest { objective: Objective }

export const GRINDOLINO_MODEL_VERSION = 'grindolino-basic-1';

/** API exposta em window.pokehub.grindolino (todas retornam Result {ok:true,data}|{ok:false,error}). */
export interface GrindolinoApi {
  listHunts(): Promise<unknown>; // Hunt[]
  createHunt(input: HuntInput): Promise<unknown>; // Hunt
  updateHunt(id: string, input: HuntInput): Promise<unknown>; // Hunt
  removeHunt(id: string): Promise<unknown>; // void; remove previsões/medições da hunt
  addForecast(input: ForecastInput): Promise<unknown>; // Forecast
  addMeasurement(input: MeasurementInput): Promise<unknown>; // Measurement
  removeMeasurement(id: string): Promise<unknown>; // void
  listMeasurements(accountId: string): Promise<unknown>; // Measurement[] mais recentes primeiro
  rank(request: RankRequest): Promise<unknown>; // RankRow[]
  compare(request: CompareRequest): Promise<unknown>; // CompareRow[] ordenado por nome da hunt
}
