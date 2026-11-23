import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regressão: um ::after `position:absolute` com `inset` cujo dono não é posicionado se estica até o painel e rouba os cliques
// (bug do Gerenciar: clicar em "Extensões" acertava "Remover"/"Limpar dados"). Todo dono desses ::after precisa de position.
const css = readFileSync('spike/src/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({selectors: m[1]!.split(',').map(s => s.trim()).filter(Boolean), body: m[2]!}));
const positioned = new Set(rules.filter(r => /position\s*:\s*(relative|absolute|fixed|sticky)/.test(r.body)).flatMap(r => r.selectors));

describe('CSS: áreas de clique invisíveis', () => {
  const owners = rules.filter(r => /position\s*:\s*absolute/.test(r.body) && /inset\s*:\s*-/.test(r.body))
    .flatMap(r => r.selectors.filter(s => s.endsWith('::after') || s.endsWith('::before')).map(s => s.replace(/::(after|before)$/, '')));
  it('encontra as regras de área de clique', () => { expect(owners.length).toBeGreaterThan(0); });
  for (const owner of owners) it(`"${owner}" é posicionado (o ::after não vaza para o painel)`, () => { expect(positioned.has(owner)).toBe(true); });
});
