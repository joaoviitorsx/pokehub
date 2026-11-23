import { describe, expect, it } from 'vitest';
import { acquireSingleInstance } from '../electron/single-instance';

describe('instância única', () => {
 it('encerra a segunda instância sem iniciar o aplicativo', () => {
  const calls:string[]=[];
  const app = {requestSingleInstanceLock:()=>false, quit:()=>calls.push('quit'), on:()=>calls.push('listen')};
  expect(acquireSingleInstance(app,()=>calls.push('focus'))).toBe(false);
  expect(calls).toEqual(['quit']);
 });
 it('entrega evento de segunda instância à janela existente', () => {
  let listener: (() => void) | undefined; const calls:string[]=[];
  const app = {requestSingleInstanceLock:()=>true, quit:()=>calls.push('quit'), on:(_event:'second-instance',callback:()=>void)=>{listener=callback;}};
  expect(acquireSingleInstance(app,()=>calls.push('focus'))).toBe(true);
  listener?.(); expect(calls).toEqual(['focus']);
 });
});
