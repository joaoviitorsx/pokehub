import { expect, it } from 'vitest';
import { axisTicks, contrast, lineColor, spread } from '../src/analytics-chart';

it('gradua o eixo a partir de zero em passos redondos', () => {
  expect(axisTicks(1_234_000)).toEqual([0,500_000,1_000_000,1_500_000]);
  expect(axisTicks(100)).toEqual([0,25,50,75,100]);
  expect(axisTicks(0.37)).toEqual([0,0.1,0.2,0.3,0.4]);
  expect(axisTicks(0)).toEqual([0,1]);
  expect(axisTicks(NaN)).toEqual([0,1]);
});
it('espalha os rótulos do eixo sem inventar datas', () => {
  expect(spread(['a','b','c'],5)).toEqual(['a','b','c']);
  expect(spread([0,1,2,3,4,5,6,7,8,9,10],3)).toEqual([0,5,10]);
  expect(spread(['a','b','c'],1)).toEqual(['a']);
});
it('mantém cores legíveis e clareia as escuras até 3:1 sobre a superfície', () => {
  expect(lineColor('#ffca3a')).toBe('#ffca3a');
  for (const dark of ['#000000','#161a23','#1b2a6b','#5a1010']) expect(contrast(lineColor(dark),'#161a23')).toBeGreaterThanOrEqual(3);
  expect(lineColor('vermelho')).toBe('#aab3c2');
});
