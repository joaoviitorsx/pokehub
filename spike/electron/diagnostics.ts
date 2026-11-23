import type { DiagnosticsValues, ProcessesSample, ProcessGroup } from '../contracts/diagnostics';

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

export interface ProcessMetric extends Metric { type?: string; memory?: {workingSetSize?: number; privateBytes?: number} }
const KB = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = (values: (number | null)[]) => values.some(value => value === null) || values.length === 0 ? null : (values as number[]).reduce((total,value) => total + value,0);
function group(metrics: readonly ProcessMetric[]): ProcessGroup {
  return {cpuPercent:sum(metrics.map(metric => KB(metric.cpu?.percentCPUUsage))), privateKb:sum(metrics.map(metric => KB(metric.memory?.privateBytes) ?? KB(metric.memory?.workingSetSize))), workingSetKb:sum(metrics.map(metric => KB(metric.memory?.workingSetSize))), count:metrics.length};
}
/** Agrupa os processos do app por conta (pelo pid do renderer da view), hub (principal + janela), GPU e o resto. A CPU só vale a partir da segunda leitura. */
export function groupMetrics(metrics: readonly ProcessMetric[], accountPids: ReadonlyMap<string, number | null>, hubPid: number | null, first = false): Omit<ProcessesSample,'sampledAt'> {
  const owner = new Map<number, string>();
  for (const [id,pid] of accountPids) if (pid !== null && pid > 0) owner.set(pid,id);
  const perAccount = new Map<string, ProcessMetric[]>(), hub: ProcessMetric[] = [], gpu: ProcessMetric[] = [], other: ProcessMetric[] = [];
  for (const metric of metrics) {
    const id = owner.get(metric.pid);
    if (id !== undefined) perAccount.set(id,[...(perAccount.get(id) ?? []),metric]);
    else if (metric.type === 'Browser' || metric.pid === hubPid) hub.push(metric);
    else if (metric.type === 'GPU') gpu.push(metric);
    else other.push(metric);
  }
  const noCpu = (value: ProcessGroup): ProcessGroup => first ? {...value,cpuPercent:null} : value;
  return {
    accounts:[...accountPids.keys()].map(id => { const found = noCpu(group(perAccount.get(id) ?? [])); return {id,cpuPercent:found.cpuPercent,privateKb:found.privateKb,workingSetKb:found.workingSetKb}; }),
    hub:noCpu(group(hub)), gpu:noCpu(group(gpu)), other:noCpu(group(other)),
  };
}
