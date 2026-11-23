import { describe, expect, it } from 'vitest';
import { createProfile, updateProfile } from '../domain/profiles';
const id = '550e8400-e29b-41d4-a716-446655440000';
const input = {label:'Principal',emailLabel:'player@example.com',characterName:'',colorToken:'#d4a65f'};
describe('perfis locais', () => {
 it('normaliza os dados e mantém o identificador ao editar', () => {
  const profile = createProfile([],input,id,'2026-11-10T00:00:00.000Z');
  expect(updateProfile(profile,{...input,label:'  Farm  '},'2026-11-11T00:00:00.000Z')).toMatchObject({id,label:'Farm',createdAt:'2026-11-10T00:00:00.000Z'});
 });
 it('rejeita quinto perfil e dados inválidos', () => {
  const profile = createProfile([],input,id,'2026-11-10T00:00:00.000Z');
  expect(() => createProfile([profile,profile,profile,profile],input,id,'2026-11-10T00:00:00.000Z')).toThrow();
  expect(() => createProfile([],{...input,emailLabel:'inválido'},id,'2026-11-10T00:00:00.000Z')).toThrow();
  expect(() => createProfile([],input,'../../bad','2026-11-10T00:00:00.000Z')).toThrow();
 });
});
