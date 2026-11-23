import { describe, expect, it } from 'vitest';
import { profileFormChanged } from '../src/profile-form';
const initial={label:'Conta',emailLabel:'a@example.com',characterName:'',colorToken:'#d4a65f'};
describe('edição de perfil', () => {
 it('identifica alterações em cada campo sem alterar os dados originais', () => {
  expect(profileFormChanged(initial,{...initial})).toBe(false);
  for (const field of ['label','emailLabel','characterName','colorToken'] as const) {
   expect(profileFormChanged(initial,{...initial,[field]:'alterado'})).toBe(true);
  }
  expect(initial.label).toBe('Conta');
 });
});
