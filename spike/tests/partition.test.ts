import { describe, expect, it } from 'vitest';
import { partitionFor } from '../electron/partition';

describe('partição da sessão', () => {
 it('usa o UUID local de forma estável', () => {
  const id='550e8400-e29b-41d4-a716-446655440000';
  expect(partitionFor(id)).toBe(`persist:pokehub-${id}`);
 });
 it('rejeita identificadores inválidos antes de criar a partição', () => {
  for(const id of ['', '../other', 'a@example.com', '550e8400-e29b-11d4-a716-446655440000']) expect(() => partitionFor(id)).toThrow();
 });
});
