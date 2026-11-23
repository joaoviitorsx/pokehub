import { describe, expect, it, vi } from 'vitest';
import { debounced, runningCount, stateText, trayAction, trayIconSize, trayMenuItems, trayTooltip } from '../electron/tray';

const on = {onClose:true, onMinimize:true}, off = {onClose:false, onMinimize:false};
describe('bandeja: decisão de fechar e minimizar', () => {
 it('fechar esconde só com a opção ligada e sem estar encerrando', () => {
  for (const platform of ['win32','linux','darwin']) {
   expect(trayAction({event:'close',platform,prefs:on,quitting:false})).toBe('hide');
   expect(trayAction({event:'close',platform,prefs:{onClose:false,onMinimize:true},quitting:false})).toBe('default');
   expect(trayAction({event:'close',platform,prefs:on,quitting:true})).toBe('default'); // Sair do PokéHub / before-quit
  }
 });
 it('minimizar esconde no Windows/Linux e segue o Dock no macOS', () => {
  expect(trayAction({event:'minimize',platform:'win32',prefs:on,quitting:false})).toBe('hide');
  expect(trayAction({event:'minimize',platform:'linux',prefs:on,quitting:false})).toBe('hide');
  expect(trayAction({event:'minimize',platform:'darwin',prefs:on,quitting:false})).toBe('default');
  expect(trayAction({event:'minimize',platform:'win32',prefs:{onClose:true,onMinimize:false},quitting:false})).toBe('default');
  expect(trayAction({event:'minimize',platform:'win32',prefs:off,quitting:true})).toBe('default');
 });
 it('sem ícone na bandeja nunca esconde (a janela não ficaria acessível)', () => {
  expect(trayAction({event:'close',platform:'win32',prefs:on,quitting:false,hasTray:false})).toBe('default');
  expect(trayAction({event:'minimize',platform:'win32',prefs:on,quitting:false,hasTray:false})).toBe('default');
 });
});
describe('bandeja: textos e menu', () => {
 it('tooltip e tamanho do ícone', () => {
  expect(trayTooltip(3)).toBe('PokéHub — 3 contas rodando'); expect(trayTooltip(1)).toBe('PokéHub — 1 conta rodando'); expect(trayTooltip(0)).toBe('PokéHub — 0 contas rodando');
  expect(trayIconSize('win32')).toBe(16); expect(trayIconSize('linux')).toBe(24);
 });
 it('estados em pt-BR e contagem ignora as suspensas', () => {
  expect(['ready','loading','suspended','offline','auth_required','error',undefined].map(stateText)).toEqual(['pronta','carregando','suspensa','sem conexão','precisa entrar','com erro','carregando']);
  expect(runningCount([{id:'a'},{id:'b'},{id:'c'}],new Map([['a','ready'],['b','suspended']]))).toBe(2);
 });
 it('monta Abrir, contas, Modo leve e Sair, com as ações ligadas', () => {
  const calls: string[] = [];
  const items = trayMenuItems({profiles:[{id:'1',label:'Principal'},{id:'2',label:'Farm'}], states:new Map([['1','ready'],['2','suspended']]), lite:false, open:() => calls.push('open'), focus:id => calls.push(`focus ${id}`), setLite:value => calls.push(`lite ${value}`), quit:() => calls.push('quit')});
  expect(items.map(item => item.type === 'separator' ? '-' : item.label)).toEqual(['Abrir PokéHub','-','Principal — pronta','Farm — suspensa','-','Modo leve','Sair do PokéHub']);
  expect(items[5]).toMatchObject({type:'checkbox',checked:false});
  for (const item of items) item.click?.();
  expect(calls).toEqual(['open','focus 1','focus 2','lite true','quit']);
  expect(trayMenuItems({profiles:[],states:new Map(),lite:true,open:() => undefined,focus:() => undefined,setLite:() => undefined,quit:() => undefined}).map(item => item.type === 'separator' ? '-' : item.label)).toEqual(['Abrir PokéHub','-','Modo leve','Sair do PokéHub']);
 });
 it('o debounce junta uma rajada numa única chamada', () => {
  vi.useFakeTimers();
  try {
   const action = vi.fn(); const refresh = debounced(action,300);
   for (let i = 0; i < 20; i++) refresh.call();
   vi.advanceTimersByTime(299); expect(action).not.toHaveBeenCalled();
   vi.advanceTimersByTime(1); expect(action).toHaveBeenCalledTimes(1);
   refresh.call(); refresh.cancel(); vi.advanceTimersByTime(1000); expect(action).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
 });
});
describe('bandeja: acesso remoto', () => {
 it('mostra ligado/desligado e alterna ao clicar; sem acesso remoto o item não existe', () => {
  const base = {profiles:[],states:new Map<string,string>(),lite:false,open:() => undefined,focus:() => undefined,setLite:() => undefined,quit:() => undefined};
  const toggle = vi.fn();
  const off = trayMenuItems({...base,remote:{enabled:false,toggle}}), on = trayMenuItems({...base,remote:{enabled:true,toggle}});
  expect(off.map(item => item.label)).toContain('Acesso remoto: desligado'); expect(on.map(item => item.label)).toContain('Acesso remoto: ligado');
  on.find(item => item.label?.startsWith('Acesso remoto'))!.click?.(); expect(toggle).toHaveBeenCalledTimes(1);
  expect(trayMenuItems(base).some(item => item.label?.startsWith('Acesso remoto'))).toBe(false);
 });
});
