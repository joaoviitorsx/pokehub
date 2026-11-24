import { describe, expect, it } from 'vitest';
import { DEADLINE_SCRIPT, deadlineTitle, dueReminders, restante, sanitizeDeadlines, urgencia } from '../domain/deadlines';
import { boxScript } from '../electron/hunt-snapshot';

const H = 3_600_000, NOW = 1_795_600_000_000;
describe('prazos dos bônus', () => {
  it('valida o retorno da página', () => {
    const raw = [{tipo:'vip', nome:'+50% XP', ate:NOW + 17 * 24 * H}, {tipo:'<x>', nome:'a', ate:NOW + H}, {tipo:'guild-boss', nome:'Boss\u202e', ate:'amanhã'}, {tipo:'kick', nome:'Kick', ate:NOW + 3 * 365 * 24 * H}];
    expect(sanitizeDeadlines(raw, NOW)).toEqual([{tipo:'vip', nome:'+50% XP', ate:NOW + 17 * 24 * H}]);
    expect(sanitizeDeadlines('x', NOW)).toBeNull();
  });
  it('avisa 1 dia e depois 1 hora antes, uma vez cada; renovar zera', () => {
    const vip = {tipo:'vip', nome:'+50% XP', ate:NOW + 20 * H};
    const first = dueReminders([vip], NOW, new Set(), 'p1');
    expect(first.map(r => r.rotulo)).toEqual(['1 dia']);
    expect(dueReminders([vip], NOW, new Set([first[0]!.key]), 'p1')).toEqual([]);
    const later = dueReminders([vip], NOW + 19.5 * H, new Set([first[0]!.key]), 'p1');
    expect(later.map(r => r.rotulo)).toEqual(['1 hora']);
    expect(dueReminders([{...vip, ate:NOW + 40 * H}], NOW, new Set(), 'p1')).toEqual([]); // longe: nada
    expect(dueReminders([{...vip, ate:NOW - 1}], NOW, new Set(), 'p1')).toEqual([]); // acabou: nada
    expect(dueReminders([{...vip, ate:NOW + 20 * H + 1}], NOW, new Set([first[0]!.key]), 'p1')).toHaveLength(1); // renovado: avisa de novo
  });
  it('textos e urgência', () => {
    expect(restante(NOW + 17 * 24 * H, NOW)).toBe('17 dias');
    expect(restante(NOW + 50 * H, NOW)).toBe('2 d 2 h');
    expect(restante(NOW + 5 * H + 20 * 60_000, NOW)).toBe('5 h 20');
    expect(restante(NOW + 12 * 60_000, NOW)).toBe('12 min');
    expect([urgencia(NOW + 30 * 60_000, NOW), urgencia(NOW + 5 * H, NOW), urgencia(NOW + 30 * H, NOW)]).toEqual(['agora', 'perto', 'ok']);
    expect(deadlineTitle({tipo:'guild-boss', nome:'', ate:0})).toBe('Boss Raid da Guild');
  });
  it('scripts fixos válidos e sem escrita', () => {
    for (const code of [DEADLINE_SCRIPT, boxScript([{k:'a', url:'https://pokeidle.io/a.webp', x:1, y:2, w:32, h:32}])]) {
      expect(() => new Function(`return ${code}`)).not.toThrow();
      for (const banned of ['.click(', 'fetch(', 'innerHTML', 'localStorage', 'appendChild']) expect(code).not.toContain(banned);
    }
  });
});
