// Histórico e Analytics (Etapa 3). Só agrega medições e previsões já gravadas pelo Grindolino; nada novo é coletado do jogo.

export type Metric = 'xp' | 'coins' | 'kills' | 'shiny';
export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

export interface SeriesRequest {
  accountId: string | null; // null = todas as contas, lado a lado (nunca somadas)
  huntId: string | null; // null = todas as hunts da conta; o previsto só existe com uma hunt escolhida
  metric: Metric;
  range: AnalyticsRange;
}

/** Um dia (ou semana) local. `bucket` é a data local AAAA-MM-DD do início do período. */
export interface SeriesPoint {
  bucket: string;
  /** Observado: soma dos ganhos / soma dos minutos das medições que informaram a métrica. null = só há previsão no período. */
  perHour: number | null;
  samples: number;
  minutes: number;
  small: boolean; // menos de SMALL_SAMPLE_MINUTES medidos no período
  /** Previsão do jogo vigente no período: a mais recente lida até o fim dele. Nunca somada ao observado. */
  forecastPerHour: number | null;
}
export interface SeriesSummary {
  perHour: number | null;
  samples: number;
  minutes: number;
  small: boolean;
  forecastPerHour: number | null; // previsão mais recente
  deltaRatio: number | null; // observado/previsto - 1
}
export interface AccountSeries { accountId: string; points: SeriesPoint[]; summary: SeriesSummary }
export interface SeriesResult {
  metric: Metric;
  granularity: 'day' | 'week'; // semana (segunda a domingo) quando os dados cobrem mais de 60 dias
  series: AccountSeries[]; // uma por conta pedida, na ordem dos perfis
  duplicatesIgnored: number;
}

export interface ExportRequest {
  format: 'csv' | 'json';
  scope: Pick<SeriesRequest, 'accountId' | 'huntId' | 'range'>;
}
export interface ExportResult { saved: boolean; fileName: string | null; rows: number }

export const SMALL_SAMPLE_MINUTES = 30;
export const METRIC_UNITS: Record<Metric, string> = {xp:'XP/h', coins:'Ouro/h', kills:'abates/h', shiny:'shiny/h'};

/** API exposta em window.pokehub.analytics (Result {ok:true,data}|{ok:false,error}). */
export interface AnalyticsApi {
  series(request: SeriesRequest): Promise<unknown>; // SeriesResult
  export(request: ExportRequest): Promise<unknown>; // ExportResult; o main abre o diálogo de salvar
}
