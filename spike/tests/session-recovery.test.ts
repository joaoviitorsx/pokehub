import { describe, expect, it } from 'vitest';
import { resetSession } from '../electron/session-recovery';

describe('limpeza de sessão', () => {
 it('fecha, limpa e reabre a mesma sessão nessa ordem', async () => {
  const events:string[]=[];
  await resetSession({close:()=>{events.push('close');},clear:async()=>{events.push('clear');},open:()=>{events.push('open');}});
  expect(events).toEqual(['close','clear','open']);
 });
 it('reabre e informa falha quando a limpeza falha', async () => {
  const events:string[]=[];
  await expect(resetSession({close:()=>{events.push('close');},clear:async()=>{events.push('clear');throw new Error('falhou');},open:()=>{events.push('open');}})).rejects.toThrow('falhou');
  expect(events).toEqual(['close','clear','open']);
 });
});

describe('reinício de sessão', () => {
 it('fecha apenas a sessão selecionada e a reabre', async () => {
  const { restartSession } = await import('../electron/session-recovery');
  const events:string[]=[];
  await restartSession('perfil-a',{close:id => {events.push(`close:${id}`);},open:id => {events.push(`open:${id}`);}});
  expect(events).toEqual(['close:perfil-a','open:perfil-a']);
 });
 it('não reabre quando o encerramento falha', async () => {
  const { restartSession } = await import('../electron/session-recovery');
  const events:string[]=[];
  await expect(restartSession('perfil-a',{close:()=>{throw new Error('erro');},open:id=>{events.push(id);}})).rejects.toThrow('erro');
  expect(events).toEqual([]);
 });
});

describe('abertura isolada', () => {
 it('informa falha e continua quando a view não pode ser criada', async () => {
  const { openSessionSafely } = await import('../electron/session-recovery');
  const events:string[]=[];
  expect(openSessionSafely('a',{open:()=>{throw new Error('falha');},cleanup:id=>events.push(`cleanup:${id}`),cleanupFailed:()=>events.push('cleanupFailed'),failed:id=>events.push(`failed:${id}`)})).toBe(false);
  expect(events).toEqual(['cleanup:a','failed:a']);
 });
 it('retorna sucesso quando a view é aberta', async () => {
  const { openSessionSafely } = await import('../electron/session-recovery');
  const events:string[]=[];
  expect(openSessionSafely('a',{open:id=>events.push(`open:${id}`),cleanup:id=>events.push(`cleanup:${id}`),cleanupFailed:()=>events.push('cleanupFailed'),failed:id=>events.push(`failed:${id}`)})).toBe(true);
  expect(events).toEqual(['open:a']);
 });
});

describe('criação da view', () => {
 it('fecha a view quando a configuração falha antes de anexar', async () => {
  const { mountSessionView } = await import('../electron/session-recovery');
  const events:string[]=[];
  expect(() => mountSessionView({configure:()=>{throw new Error('configuração');},attach:()=>events.push('attach'),dispose:()=>events.push('dispose')})).toThrow('configuração');
  expect(events).toEqual(['dispose']);
 });
 it('fecha a view quando a anexação falha', async () => {
  const { mountSessionView } = await import('../electron/session-recovery');
  const events:string[]=[];
  expect(() => mountSessionView({configure:()=>events.push('configure'),attach:()=>{throw new Error('anexação');},dispose:()=>events.push('dispose')})).toThrow('anexação');
  expect(events).toEqual(['configure','dispose']);
 });
});

it('sinaliza falha de limpeza sem impedir isolamento de outras sessões', async () => {
 const { openSessionSafely } = await import('../electron/session-recovery');
 const events:string[]=[];
 expect(openSessionSafely('a',{open:()=>{throw new Error('abrir');},cleanup:()=>{throw new Error('fechar');},cleanupFailed:()=>events.push('cleanupFailed'),failed:id=>events.push(`failed:${id}`)})).toBe(false);
 expect(events).toEqual(['cleanupFailed','failed:a']);
});

it('aguarda a destruição antes de limpar os dados', async () => {
 const events:string[]=[]; let release: (() => void) | undefined;
 const closed = new Promise<void>(resolve => {release=resolve;});
 const pending = resetSession({close:async()=>{events.push('closing');await closed;events.push('closed');},clear:async()=>{events.push('clear');},open:()=>{events.push('open');}});
 await Promise.resolve(); expect(events).toEqual(['closing']);
 release?.(); await pending; expect(events).toEqual(['closing','closed','clear','open']);
});

it('aguarda a destruição antes de reabrir a sessão', async () => {
 const { restartSession } = await import('../electron/session-recovery');
 const events:string[]=[]; let release: (() => void) | undefined;
 const closed = new Promise<void>(resolve => {release=resolve;});
 const pending = restartSession('a',{close:async()=>{events.push('closing');await closed;},open:()=>{events.push('open');}});
 await Promise.resolve(); expect(events).toEqual(['closing']);
 release?.(); await pending; expect(events).toEqual(['closing','open']);
});
