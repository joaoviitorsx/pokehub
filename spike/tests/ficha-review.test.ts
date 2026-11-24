import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avaliarFicha, FICHA_PROBE, fichaScript, type FichaDados, type Stats } from '../domain/ficha-review';
import { PreferencesStore } from '../electron/preferences-store';

const todos = (v: number | null): Stats => ({hp:v, atk:v, def:v, spAtk:v, spDef:v, spd:v});
const BLASTOISE: Stats = {hp:79, atk:83, def:100, spAtk:85, spDef:105, spd:78}; // valores reais da ficha (2026-11-24)
const ESPECIAL: Stats = {hp:60, atk:60, def:60, spAtk:120, spDef:80, spd:100};
const FISICO: Stats = {hp:80, atk:130, def:80, spAtk:60, spDef:70, spd:90};
const ficha = (over: Partial<FichaDados>): FichaDados => ({nota:5, quality:1.2, potencia:1, ivs:todos(16), base:BLASTOISE, ...over});

describe('avaliarFicha: perfil pelos stats-base', () => {
  it('físico, especial e misto (diferença de 15%)', () => {
    expect(avaliarFicha(ficha({base:FISICO})).perfil).toBe('fisico');
    expect(avaliarFicha(ficha({base:ESPECIAL})).perfil).toBe('especial');
    expect(avaliarFicha(ficha({base:BLASTOISE})).perfil).toBe('misto');
    expect(avaliarFicha(ficha({base:todos(null)})).perfil).toBe('misto');
  });
  it('destaca o ataque que pesa e o SPD', () => {
    expect(avaliarFicha(ficha({base:ESPECIAL})).ivs.filter(i => i.chave).map(i => i.k)).toEqual(['spAtk', 'spd']);
    expect(avaliarFicha(ficha({base:FISICO})).ivs.filter(i => i.chave).map(i => i.k)).toEqual(['atk', 'spd']);
  });
});

describe('avaliarFicha: o caso da nota que engana', () => {
  it('nota alta com SP.ATK ruim num atacante especial: avisa e não dá "ótimo"', () => {
    const a = avaliarFicha({nota:8.2, quality:1.3, potencia:3, ivs:{hp:28, atk:30, def:29, spAtk:5, spDef:27, spd:25}, base:ESPECIAL});
    expect(a.titulo).toBe('Nota alta, mas fraco no ataque');
    expect(a.faixa).not.toBe('otimo');
    expect(a.motivos[0]).toMatchObject({tom:'ruim'});
    expect(a.motivos[0]!.texto).toContain('SP.ATK 5/32');
    expect(a.motivos.some(m => m.texto.includes('ATK alto quase não ajuda'))).toBe(true);
  });
  it('mesmos IVs, perfil oposto: o físico com ATK 30 é bem melhor para caçar', () => {
    const ivs = {hp:28, atk:30, def:29, spAtk:5, spDef:27, spd:25};
    expect(avaliarFicha({nota:8.2, quality:1.3, potencia:3, ivs, base:FISICO}).score).toBeGreaterThan(avaliarFicha({nota:8.2, quality:1.3, potencia:3, ivs, base:ESPECIAL}).score + 15);
  });
});

describe('avaliarFicha: pontuação', () => {
  it('Blastoise real (IV 27 em tudo, qualidade 1,600, P2) = 76, ótimo', () => {
    const a = avaliarFicha({nota:3.698, quality:1.6, potencia:2, ivs:todos(27), base:BLASTOISE});
    expect(a).toMatchObject({score:76, faixa:'otimo', perfil:'misto'});
    expect(a.motivos).toHaveLength(3);
  });
  it('limites: tudo no máximo = 100, tudo no mínimo = 0', () => {
    expect(avaliarFicha({nota:10, quality:1.8, potencia:5, ivs:todos(32), base:FISICO}).score).toBe(100);
    expect(avaliarFicha({nota:0, quality:0.8, potencia:1, ivs:todos(1), base:FISICO}).score).toBe(0);
  });
  it('SPD pesa mais em espécie rápida', () => {
    const lento = {...FISICO, spd:40}, rapido = {...FISICO, spd:130};
    const ivs = {...todos(16), spd:32};
    expect(avaliarFicha(ficha({ivs, base:rapido})).score).toBeGreaterThan(avaliarFicha(ficha({ivs, base:lento})).score);
  });
  it('dados faltando não quebram e no máximo 3 motivos', () => {
    const a = avaliarFicha({nota:null, quality:null, potencia:null, ivs:{...todos(null), atk:4, spd:3, hp:2}, base:FISICO});
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.motivos.length).toBeLessThanOrEqual(3);
    expect(a.motivos.every(m => m.tom === 'ruim')).toBe(true);
  });
});

describe('script da ficha', () => {
  it('é JavaScript válido (ligado, desligado e a sonda)', () => {
    for (const code of [fichaScript(true), fichaScript(false), FICHA_PROBE]) expect(() => new Function(`return ${code}`)).not.toThrow();
  });
  it('não clica (refino gasta pedras), não faz rede, não lê campos nem storage', () => {
    const code = fichaScript(true);
    for (const banned of ['.click(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'document.cookie', 'innerHTML', 'fi-refino-bt']) expect(code).not.toContain(banned);
    expect(code).not.toMatch(/\.value(?![a-zA-Z])/); // campo de formulário (Object.values é outra coisa)
  });
  it('a avaliação embutida é a mesma função testada aqui', () => {
    expect(fichaScript(true)).toContain(avaliarFicha.toString());
  });
});

describe('preferência da análise', () => {
  it('ligada por padrão; só booleano', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-ficha-'));
    const prefs = new PreferencesStore(join(dir, 'app.sqlite'));
    try {
      expect(prefs.getFichaReview()).toBe(true);
      expect(prefs.setFichaReview(false)).toBe(false);
      expect(prefs.getFichaReview()).toBe(false);
      expect(() => prefs.setFichaReview(1)).toThrow();
    } finally { prefs.close(); rmSync(dir, {recursive:true, force:true}); }
  });
});

describe('conselho de refino', () => {
  it('ataque que ele usa primeiro, depois HP; SPD nunca entra', () => {
    expect(avaliarFicha(ficha({base:FISICO})).refino.ordem.slice(0, 2)).toEqual(['atk', 'hp']);
    expect(avaliarFicha(ficha({base:ESPECIAL})).refino.ordem.slice(0, 2)).toEqual(['spAtk', 'hp']);
    const misto = avaliarFicha(ficha({base:BLASTOISE})).refino;
    expect(misto.ordem.slice(0, 3)).toEqual(['spAtk', 'atk', 'hp']); // SP.ATK base 85 > ATK 83
    expect(misto.texto).toContain('golpes mistos');
    for (const base of [FISICO, ESPECIAL, BLASTOISE]) expect(avaliarFicha(ficha({base})).refino.ordem).not.toContain('spd');
  });
  it('avisa refino gasto no ataque que ele não usa', () => {
    const a = avaliarFicha(ficha({base:FISICO, refino:{...todos(0), spAtk:4}}));
    expect(a.refino.aviso).toContain('SP.ATK já tem +4');
    expect(avaliarFicha(ficha({base:FISICO, refino:{...todos(0), atk:4}})).refino.aviso).toBeNull();
  });
});
