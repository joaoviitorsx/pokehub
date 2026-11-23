import { describe, expect, it } from 'vitest';
import { canReadHunt, classifyLoadFailure, classifyLoadRejection, offlineRetryDelay } from '../electron/session-status';

describe('estado de carregamento', () => {
 it('ignora cancelamento normal e diferencia desconexão de outros erros', () => {
  expect(classifyLoadFailure(-3)).toBeNull();
  expect(classifyLoadFailure(-106)).toBe('offline');
  expect(classifyLoadFailure(-105)).toBe('error');
 });
 it('classifica rejeições da promessa sem expor dados da URL', () => {
  expect(classifyLoadRejection({code:'ERR_ABORTED'})).toBeNull();
  expect(classifyLoadRejection({code:'ERR_INTERNET_DISCONNECTED'})).toBe('offline');
  expect(classifyLoadRejection(new Error('erro'))).toBe('error');
  expect(classifyLoadRejection(null)).toBe('error');
 });
 it('limita o retry offline a três tentativas com backoff', () => {
  expect([0,1,2].map(offlineRetryDelay)).toEqual([5000,10000,20000]);
  expect(offlineRetryDelay(3)).toBeNull();
  expect(offlineRetryDelay(10)).toBeNull();
 });
 it('libera a leitura do /hunt com a página pronta ou sem carga do frame principal em curso', () => {
  expect(canReadHunt('ready',true)).toBe(true);
  expect(canReadHunt('loading',false)).toBe(true);
  expect(canReadHunt('loading',true)).toBe(false);
  for (const state of ['offline','error','auth_required','',undefined]) expect(canReadHunt(state,false)).toBe(false);
 });
});
