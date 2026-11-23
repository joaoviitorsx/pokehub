import { describe, expect, it } from 'vitest';
import { summarizeMetrics } from '../electron/diagnostics';
const metrics=[{pid:1,creationTime:100,memory:{workingSetSize:2000},cpu:{percentCPUUsage:12}},{pid:2,creationTime:200,memory:{workingSetSize:3000},cpu:{percentCPUUsage:4}}];
describe('diagnóstico local', () => {
 it('não apresenta CPU na primeira amostra nem em intervalos curtos', () => {
  const first=summarizeMetrics(metrics,100,null);
  expect(first.sample).toEqual({memoryKb:5000,cpuPercent:null,cpuIntervalMs:null,processCount:2});
  const short=summarizeMetrics(metrics,500,first.baseline);
  expect(short.sample.cpuPercent).toBeNull();
  expect(short.sample.cpuIntervalMs).toBeNull();
  const next=summarizeMetrics(metrics,1600,short.baseline);
  expect(next.sample.cpuPercent).toBe(16);
  expect(next.sample.cpuIntervalMs).toBe(1100);
 });
 it('não soma dados ausentes ou apresenta CPU com processos alterados', () => {
  const first=summarizeMetrics(metrics,0,null);
  expect(summarizeMetrics(metrics.slice(0,1),1100,first.baseline).sample.cpuPercent).toBeNull();
  expect(summarizeMetrics([{pid:1,creationTime:100,memory:{workingSetSize:-1},cpu:{percentCPUUsage:5}}],1100,first.baseline).sample.memoryKb).toBeNull();
  expect(summarizeMetrics([],1100,first.baseline).sample.memoryKb).toBeNull();
  const huge=metrics.map(metric=>({...metric,cpu:{percentCPUUsage:Number.MAX_VALUE}}));
  expect(summarizeMetrics(huge,1100,first.baseline).sample.cpuPercent).toBeNull();
  expect(summarizeMetrics([...metrics].reverse(),1100,first.baseline).sample.cpuPercent).toBe(16);
 });
});
