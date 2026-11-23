import { describe, expect, it } from 'vitest';
import { removeProfileAndData } from '../src/remove-profile';

describe('remoção de perfil e dados', () => {
 it('remove o perfil somente após a limpeza bem-sucedida', async () => {
  const events: string[] = [];
  const result = await removeProfileAndData({clear:async()=>{events.push('clear');return true;},remove:async()=>{events.push('remove');return true;}});
  expect(result).toBe('removed');
  expect(events).toEqual(['clear','remove']);
 });
 it('mantém o perfil quando a limpeza falha', async () => {
  const events:string[]=[];
  const result = await removeProfileAndData({clear:async()=>false,remove:async()=>{events.push('remove');return true;}});
  expect(result).toBe('clear-failed'); expect(events).toEqual([]);
 });
 it('informa remoção incompleta após limpeza', async () => {
  const result = await removeProfileAndData({clear:async()=>true,remove:async()=>false});
  expect(result).toBe('remove-failed');
 });
 it('trata falha de comunicação após limpar como remoção incompleta', async () => {
  const result = await removeProfileAndData({clear:async()=>true,remove:async()=>{throw new Error('disconnected');}});
  expect(result).toBe('remove-failed');
 });
});
