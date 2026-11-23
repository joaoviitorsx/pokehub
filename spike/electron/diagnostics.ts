import type { DiagnosticsValues } from '../contracts/diagnostics';

interface Metric {
  pid: number;
  creationTime: number;
  memory?: {workingSetSize?: number};
  cpu?: {percentCPUUsage?: number};
}
export interface DiagnosticsBaseline {atMs: number; processKeys: string[] | null}

export function summarizeMetrics(metrics: readonly Metric[], atMs: number, previous: DiagnosticsBaseline | null): {sample: DiagnosticsValues; baseline: DiagnosticsBaseline} {
  const keys = metrics.map(metric => Number.isSafeInteger(metric.pid) && metric.pid > 0 && Number.isFinite(metric.creationTime) ? `${metric.pid}:${metric.creationTime}` : null);
  const validKeys = keys.every((key): key is string => key !== null) && new Set(keys).size === keys.length ? keys.slice().sort() : null;
  const memory = metrics.map(metric => metric.memory?.workingSetSize);
  const validMemory = metrics.length > 0 && memory.every((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  const sumMemory = validMemory ? memory.reduce((sum,value) => sum + value,0) : null;
  const cpu = metrics.map(metric => metric.cpu?.percentCPUUsage);
  const sameProcesses = validKeys !== null && previous?.processKeys !== null && previous?.processKeys !== undefined && validKeys.length === previous.processKeys.length && validKeys.every((key,index) => key === previous.processKeys?.[index]);
  const validCpu = metrics.length > 0 && cpu.every((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const elapsed = previous ? atMs - previous.atMs : 0;
  const sumCpu = validCpu ? cpu.reduce((sum,value) => sum + value,0) : null;
  const cpuAvailable = sameProcesses && Number.isFinite(elapsed) && elapsed >= 1000 && sumCpu !== null && Number.isFinite(sumCpu);
  return {
    sample: {memoryKb: sumMemory !== null && Number.isSafeInteger(sumMemory) ? sumMemory : null, cpuPercent: cpuAvailable ? sumCpu : null, cpuIntervalMs: cpuAvailable ? elapsed : null, processCount:metrics.length},
    baseline: {atMs,processKeys:validKeys},
  };
}
