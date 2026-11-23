export interface DiagnosticsValues {
  memoryKb: number | null;
  cpuPercent: number | null;
  cpuIntervalMs: number | null;
  processCount: number;
}
export interface DiagnosticsSample extends DiagnosticsValues {
  sampledAt: string;
}
/** Uso de uma conta (o processo renderer da página do jogo). privateKb: memória privada (Windows) ou, sem ela, o conjunto de trabalho. */
export interface AccountMetric { id: string; cpuPercent: number | null; privateKb: number | null; workingSetKb: number | null }
export interface ProcessGroup { cpuPercent: number | null; privateKb: number | null; workingSetKb: number | null; count: number }
/** Monitor por conta: o hub é o processo principal mais o renderer da janela do PokéHub. */
export interface ProcessesSample { sampledAt: string; accounts: AccountMetric[]; hub: ProcessGroup; gpu: ProcessGroup; other: ProcessGroup }
