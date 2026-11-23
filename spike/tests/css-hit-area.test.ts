import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regressão: um ::after `position:absolute` com `inset` cujo dono não é posicionado se estica até o painel e rouba os cliques
// (bug do Gerenciar: clicar em "Extensões" acertava "Remover"/"Limpar dados"). Todo dono desses ::after precisa de position.
// Vale para todos os CSS do app (desktop, celular e o tema compartilhado). A auditoria dinâmica fica em scripts/ui-hit-audit.cjs.
const FILES = [...readdirSync('spike/src').filter(f => f.endsWith('.css')).map(f => `spike/src/${f}`), ...readdirSync('spike/remote-ui').filter(f => f.endsWith('.css')).map(f => `spike/remote-ui/${f}`), 'spike/shared/dna.css'];
const parse = (file: string) => {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // regras aninhadas (@media/@container/@supports) entram "achatadas": basta casar `seletor { corpo }` sem chaves dentro
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({selectors: m[1]!.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean), body: m[2]!}));
};
// variações de estado (`.st[data-state=ready] b`) herdam o position da regra base (`.st b`): compara sem atributos nem :pseudo-classes
const base = (selector: string) => selector.replace(/\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim();
const PSEUDO = /::(after|before)$/;
// "interativo": o último elemento do seletor é um controle (ou o próprio seletor mira um) — só nele o cursor pode virar mão
const INTERACTIVE = /(^|[\s>+~])(button|a|select|summary|label|input|textarea)(?![\w-])|\[role=(button|tab|switch|checkbox|menuitem)\]|\[type=(button|checkbox|radio|color|range|submit)\]/;
// classes que são <label> ou controles por contrato do app (ver o markup): `.switch` e `.shop-acc-pick` são <label>
const INTERACTIVE_CLASSES = new Set(['.switch', '.shop-acc-pick']);

for (const file of FILES) {
  const rules = parse(file);
  const positioned = new Set(rules.filter(r => /position\s*:\s*(relative|absolute|fixed|sticky)/.test(r.body)).flatMap(r => r.selectors).map(base));
  describe(`CSS: ${file}`, () => {
    // pseudo que sai da caixa do dono: absolute/fixed com inset negativo, 100% ou inset:0 — sem dono posicionado vira um retângulo do tamanho do painel
    const owners = rules.filter(r => /position\s*:\s*(absolute|fixed)/.test(r.body) && /(inset\s*:\s*-|(?:top|left|right|bottom)\s*:\s*-|inset\s*:\s*0|width\s*:\s*100%|height\s*:\s*100%)/.test(r.body))
      .flatMap(r => r.selectors.filter(s => PSEUDO.test(s) && !/pointer-events\s*:\s*none/.test(r.body)).map(s => s.replace(PSEUDO, '')));
    for (const owner of owners) it(`"${owner}" é posicionado (o pseudo-elemento clicável não vaza para o painel)`, () => { expect(positioned.has(base(owner))).toBe(true); });
    it('cursor: pointer só em elementos interativos', () => {
      const bad = rules.filter(r => /cursor\s*:\s*pointer/.test(r.body)).flatMap(r => r.selectors).filter(s => !INTERACTIVE.test(s) && ![...INTERACTIVE_CLASSES].some(c => s === c || s.startsWith(`${c} `)));
      expect(bad).toEqual([]);
    });
  });
}

describe('CSS: áreas de clique invisíveis (Gerenciar)', () => {
  const rules = parse('spike/src/style.css');
  it('encontra as regras de área de clique', () => {
    const found = rules.filter(r => /position\s*:\s*absolute/.test(r.body) && /inset\s*:\s*-/.test(r.body) && r.selectors.some(s => PSEUDO.test(s)));
    expect(found.length).toBeGreaterThan(0);
  });
});
