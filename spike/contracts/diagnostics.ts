export interface DiagnosticsValues {
  memoryKb: number | null;
  cpuPercent: number | null;
  cpuIntervalMs: number | null;
  processCount: number;
}
export interface DiagnosticsSample extends DiagnosticsValues {
  sampledAt: string;
}
