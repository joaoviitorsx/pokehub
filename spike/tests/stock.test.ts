import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOCK_RULES, lowCats, lowText, recovered, sanitizeRules, sanitizeStock, STOCK_SCRIPT } from '../domain/stock';
import { PreferencesStore } from '../electron/preferences-store';

// retorno real do jogo (2026-11-24): Ultra 36.529 e Poke 33 em uso; Beast Ball (não comprável) já fica fora no script
const REAL = {gold:58_319_819, bolas:[{nome:'Ultra Ball', qtd:36_529}, {nome:'Poke Ball', qtd:33}], pocoes:10_247, revives:77, usaPocao:true, usaRevive:true};

describe('reposição assistida: leitura', () => {
  it('aceita o formato real e soma as pokébolas em uso', () => {
    const s = sanitizeStock(REAL)!;
    expect(s.gold).toBe(58_319_819);
    expect(s.cats.Pokebolas).toEqual({total:36_562, itens:REAL.bolas});
    expect([s.cats.Poções.total, s.cats.Revives.total]).toEqual([10_247, 77]);
  });
  it('descarta lixo', () => {
    expect(sanitizeStock(null)).toBeNull();
    expect(sanitizeStock({...REAL, pocoes:-1})).toBeNull();
    expect(sanitizeStock({...REAL, bolas:[{nome:'‮'.repeat(40), qtd:1}, {nome:'Ok', qtd:'x'}]})!.cats.Pokebolas.total).toBe(0);
  });
  it('script fixo, sem clique nem escrita', () => {
    expect(() => new Function(`return ${STOCK_SCRIPT}`)).not.toThrow();
    for (const banned of ['.click(', 'fetch(', 'innerHTML', 'emit(', 'localStorage']) expect(STOCK_SCRIPT).not.toContain(banned);
  });
});

describe('reposição assistida: regras', () => {
  const s = sanitizeStock({...REAL, revives:12})!;
  it('baixo = abaixo do mínimo; mínimo 0 não vigia; desligado não avisa', () => {
    expect(lowCats(s, DEFAULT_STOCK_RULES)).toEqual(['Revives']);
    expect(lowCats(s, {...DEFAULT_STOCK_RULES, min:{...DEFAULT_STOCK_RULES.min, Revives:0}})).toEqual([]);
    expect(lowCats(s, {...DEFAULT_STOCK_RULES, on:false})).toEqual([]);
  });
  it('só sai do baixo com 20% de folga (não avisa a cada pokébola)', () => {
    const rules = {...DEFAULT_STOCK_RULES, min:{...DEFAULT_STOCK_RULES.min, Revives:20}};
    expect(recovered(sanitizeStock({...REAL, revives:22})!, rules, 'Revives')).toBe(false);
    expect(recovered(sanitizeStock({...REAL, revives:24})!, rules, 'Revives')).toBe(true);
  });
  it('texto do aviso e validação das regras', () => {
    expect(lowText(s, ['Revives'], DEFAULT_STOCK_RULES)).toBe('Revives: restam 12 (mínimo 20)');
    expect(sanitizeRules({on:false, min:{Pokebolas:50, Poções:-5, Revives:'x'}})).toEqual({...DEFAULT_STOCK_RULES, on:false, min:{Pokebolas:50, Poções:100, Revives:20}});
    expect(sanitizeRules('lixo')).toEqual(DEFAULT_STOCK_RULES);
  });
});

describe('migração 1.1.1 → 1.1.2', () => {
  it('banco v17 ganha stock_rules (padrão) e vai para v18', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-v17-'));
    const path = join(dir, 'app.sqlite');
    try {
      new PreferencesStore(path).close();
      const db = new DatabaseSync(path);
      db.exec('ALTER TABLE workspace_settings DROP COLUMN stock_rules; PRAGMA user_version=17;'); // estado exato da 1.1.1
      db.close();
      const prefs = new PreferencesStore(path);
      expect(prefs.getStockRules()).toEqual(DEFAULT_STOCK_RULES);
      expect(prefs.setStockRules({...DEFAULT_STOCK_RULES, min:{Pokebolas:500, Poções:100, Revives:20}}).min.Pokebolas).toBe(500);
      expect(prefs.getStockRules().min.Pokebolas).toBe(500);
      prefs.close();
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({user_version:18});
      check.close();
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
});
