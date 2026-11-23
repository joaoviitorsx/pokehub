import { describe, expect, it } from 'vitest';
import { isSideShortcut, shortcutFocus, shortcutIndex } from '../electron/workspace-shortcuts';
const key = {type:'keyDown',key:'1',control:true,alt:false,shift:false,meta:false,isAutoRepeat:false,isComposing:false};
describe('atalhos do workspace', () => {
 it('seleciona a sessão disponível e a grade', () => {
  expect(shortcutIndex(key)).toBe(1);
  expect(shortcutFocus(key,['a','b'])).toBe('a');
  expect(shortcutFocus({...key,key:'2'},['a','b'])).toBe('b');
  expect(shortcutFocus({...key,key:'0'},['a','b'])).toBeNull();
  expect(shortcutFocus({...key,key:'3'},['a','b'])).toBeUndefined();
 });
 it('não intercepta outras teclas, modificadores ou repetição', () => {
  for (const input of [{...key,control:false},{...key,alt:true},{...key,shift:true},{...key,meta:true},{...key,isAutoRepeat:true},{...key,isComposing:true},{...key,type:'keyUp'},{...key,key:'x'}]) {
   expect(shortcutIndex(input)).toBeUndefined();
   expect(shortcutFocus(input,['a'])).toBeUndefined();
  }
 });
 it('Ctrl+H alterna a lateral e não colide com os atalhos de sessão', () => {
  expect(isSideShortcut({...key,key:'h'})).toBe(true);
  expect(isSideShortcut({...key,key:'H'})).toBe(true);
  expect(shortcutIndex({...key,key:'h'})).toBeUndefined();
  for (const input of [key,{...key,key:'h',control:false},{...key,key:'h',shift:true},{...key,key:'h',alt:true},{...key,key:'h',isAutoRepeat:true},{...key,key:'h',type:'keyUp'}]) expect(isSideShortcut(input)).toBe(false);
 });
});
