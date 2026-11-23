import { expect, test } from 'vitest';
import { elementOf } from '../src/element';

test('deriva o elemento do matiz da cor do perfil', () => {
  expect(elementOf('#f25f5c')).toBe('flame');
  expect(elementOf('#d4a65f')).toBe('bolt');
  expect(elementOf('#59cd90')).toBe('leaf');
  expect(elementOf('#3fa7d6')).toBe('drop');
  expect(elementOf('#b98cff')).toBe('star');
  expect(elementOf('#ff0040')).toBe('flame');
});
test('cinzas e valores inválidos caem em estrela', () => {
  expect(elementOf('#808080')).toBe('star');
  expect(elementOf('')).toBe('star');
});
