import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertsOf, alertText, captureKey, diffNew, normalizeTime, parseCapture, resolveAt, type Capture, type RawCapture } from '../domain/captures';
import { CAPTURES_MAX, CAPTURES_SCRIPT, createCaptureLog, createCaptureService, parseQuery, sanitizeCaptures } from '../electron/captures';

const raw = (o: Partial<RawCapture> = {}): RawCapture => ({name: 'Charmander', nv: 'Nv 20', hora: '14:53', pot: 'P2', potCls: 'cm-pot p2', iv: 'IV 101', q: 'Q 1,487', n: 'N 2,176', badge: '', cls: 'capturas-linha cap-card nota-tinta mediano', txt: 'Charmander Nv 20 14:53 P2', ...o});
const NOW = new Date(2026, 10, 23, 15, 0, 0);
const cap = (o: Partial<Capture> = {}): Capture => ({profileId: 'a', name: 'Eevee', level: 10, time: '14:00', at: new Date(2026, 10, 23, 14, 0).toISOString(), potencia: 2, iv: 90, quality: 1, nota: 3, shiny: false, record: false, hints: [], ...o});

describe('leitura de uma linha', () => {
  it('converte números pt-BR, nível com milhar e P', () => {
    const c = parseCapture(raw({nv: 'Nv 1.793'}), 'a', NOW)!;
    expect(c).toMatchObject({name: 'Charmander', level: 1793, time: '14:53', potencia: 2, iv: 101, quality: 1.487, nota: 2.176, shiny: false, record: false});
    expect(c.hints).toEqual(['nota-tinta', 'mediano']);
  });
  it('reconhece shiny pela classe, pelo texto e pela estrela; recorde pelo selo', () => {
    expect(parseCapture(raw({cls: 'capturas-linha shiny'}), 'a', NOW)!.shiny).toBe(true);
    expect(parseCapture(raw({txt: '✨ Charmander'}), 'a', NOW)!.shiny).toBe(true);
    expect(parseCapture(raw({name: '✨ Gastly'}), 'a', NOW)).toMatchObject({shiny: true, name: 'Gastly'});
    const r = parseCapture(raw({badge: 'RECORDE', cls: 'capturas-linha recorde'}), 'a', NOW)!;
    expect(r.record).toBe(true); expect(r.hints).toContain('recorde');
  });
  it('P pela classe quando o texto some; campos ausentes viram null; sem nome ou hora válida, descarta', () => {
    expect(parseCapture(raw({pot: '', potCls: 'cm-pot p5'}), 'a', NOW)!.potencia).toBe(5);
    expect(parseCapture(raw({pot: '', potCls: 'cm-pot', iv: '', q: '', n: '', nv: ''}), 'a', NOW)).toMatchObject({potencia: null, iv: null, quality: null, nota: null, level: null});
    expect(parseCapture(raw({name: ' '}), 'a', NOW)).toBeNull();
    expect(parseCapture(raw({hora: '25:61'}), 'a', NOW)).toBeNull();
  });
  it('hora e virada da meia-noite', () => {
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(resolveAt('14:53', NOW)).toBe(new Date(2026, 10, 23, 14, 53).toISOString());
    expect(resolveAt('23:58', new Date(2026, 10, 24, 0, 2))).toBe(new Date(2026, 10, 23, 23, 58).toISOString()); // visto 00:02, capturado 23:58 de ontem
    expect(resolveAt('00:01', new Date(2026, 10, 24, 0, 2))).toBe(new Date(2026, 10, 24, 0, 1).toISOString());
  });
});

describe('deduplicação e alertas', () => {
  it('a chave ignora hints/at e diffNew devolve só o que é novo', () => {
    const a = cap(), b = cap({name: 'Abra'});
    expect(captureKey(a)).toBe(captureKey({...a, at: 'x', hints: ['y']}));
    expect(diffNew([a], [a, b, b]).map(c => c.name)).toEqual(['Abra']);
    expect(diffNew(new Set([captureKey(a)]), [a])).toEqual([]);
  });
  it('classifica shiny, P5, recorde e nota mínima opcional', () => {
    expect(alertsOf(cap())).toEqual([]);
    expect(alertsOf(cap({shiny: true, potencia: 5, record: true}))).toEqual(['shiny', 'p5', 'recorde']);
    expect(alertsOf(cap({nota: 8}), {notaMin: 7})).toEqual(['nota']);
    expect(alertsOf(cap({nota: 6}), {notaMin: 7})).toEqual([]);
    expect(alertText(cap({shiny: true}), ['shiny'])).toBe('Shiny: Eevee Nv 10 P2 · N 3');
  });
});

describe('leitor do processo principal', () => {
  it('o script é constante e só lê (sem cliques, escrita ou rede)', () => {
    expect(CAPTURES_SCRIPT).toContain('.capturas-corpo .capturas-linhas');
    expect(CAPTURES_SCRIPT).not.toMatch(/\.click\(|dispatchEvent|fetch\(|XMLHttp|localStorage|cookie|\.value\s*=/);
  });
  it('sanitiza o retorno remoto', () => {
    expect(sanitizeCaptures(null, 'a')).toBeNull();
    expect(sanitizeCaptures({open: false}, 'a')).toEqual({open: false, captures: []});
    expect(sanitizeCaptures({open: true, rows: 'x'}, 'a')).toBeNull();
    const out = sanitizeCaptures({open: true, rows: [raw(), 7, {name: 5}, {...raw({name: 'Evil‮\u0000Mon'}), iv: 'IV 99999999'}, ...Array(60).fill(raw({name: 'X'}))]}, 'a', NOW)!;
    expect(out.captures.length).toBeLessThanOrEqual(50); expect(out.captures[0]!.name).toBe('Charmander');
    expect(out.captures[1]).toMatchObject({name: 'Evil Mon', iv: null});
    expect(sanitizeCaptures({open: true, rows: [raw({name: 'a'.repeat(500)})]}, 'a', NOW)!.captures[0]!.name.length).toBe(40);
  });
  it('valida a consulta IPC', () => {
    expect(parseQuery(undefined, ['a'])).toEqual({});
    expect(parseQuery({profileId: 'a', onlyAlerts: true, limit: 20}, ['a'])).toEqual({profileId: 'a', onlyAlerts: true, limit: 20});
    for (const bad of [{profileId: 'z'}, {limit: 0}, {limit: 501}, {onlyAlerts: 'x'}, 'x', {notaMin: -1}]) expect(parseQuery(bad, ['a'])).toBeNull();
  });
});

describe('registro e persistência', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-'));
  it('guarda, deduplica, filtra por alerta e limpa', () => {
    const log = createCaptureLog({known: () => ['a', 'b'], now: () => NOW});
    expect(log.add('a', [cap(), cap({name: 'Abra', shiny: true})]).length).toBe(2);
    expect(log.add('a', [cap()])).toEqual([]);
    log.add('b', [cap({profileId: 'b', potencia: 5, time: '14:30', at: new Date(2026, 10, 23, 14, 30).toISOString()})]);
    expect(log.list({}).length).toBe(3); expect(log.list({}).at(0)!.profileId).toBe('b'); // mais recente primeiro
    expect(log.list({onlyAlerts: true}).map(c => c.name).sort()).toEqual(['Abra', 'Eevee']);
    expect(log.list({profileId: 'a', limit: 1}).length).toBe(1);
    log.clear(); expect(log.list({})).toEqual([]);
  });
  it('limita por quantidade e descarta o que passou de 7 dias; contas removidas somem da lista', () => {
    const log = createCaptureLog({known: () => ['a'], now: () => NOW});
    log.add('a', Array.from({length: 1200}, (_, i) => cap({name: `P${i}`, at: new Date(NOW.getTime() - i * 1000).toISOString()})));
    expect(log.size()).toBeLessThanOrEqual(1000); expect(CAPTURES_MAX).toBe(5000);
    expect(createCaptureLog({known: () => []}).list()).toEqual([]);
  });
  it('grava com atraso, de forma atômica, e recarrega validando', () => {
    const file = join(dir, 'captures.json');
    const log = createCaptureLog({file, known: () => ['a'], now: () => NOW});
    log.add('a', [cap(), cap({name: 'Velha', at: new Date(2026, 10, 1).toISOString()})]);
    expect(existsSync(file)).toBe(false); log.flush();
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {items: Capture[]};
    expect(saved.items.map(c => c.name)).toEqual(['Eevee']); // a de mais de 7 dias não vai
    const again = createCaptureLog({file, known: () => ['a'], now: () => NOW});
    expect(again.list().map(c => c.name)).toEqual(['Eevee']);
    writeFileSync(file, JSON.stringify({v: 1, items: [saved.items[0], {profileId: 'a', name: 5}, {...saved.items[0], profileId: 'fantasma'}, {...saved.items[0], iv: -4}]}));
    expect(createCaptureLog({file, known: () => ['a'], now: () => NOW}).list().length).toBe(1);
    writeFileSync(file, '{ quebrado');
    expect(createCaptureLog({file, known: () => ['a'], now: () => NOW}).list()).toEqual([]);
    rmSync(dir, {recursive: true, force: true});
  });
});

describe('observador', () => {
  const url = 'https://pokeidle.io/app';
  function setup(over: {lite?: boolean; known?: string[]; suspended?: string[]} = {}) {
    const timers: {fn: () => void; ms: number}[] = [], page = {rows: [raw()] as RawCapture[], open: true, reads: 0, scripts: [] as string[], url};
    const events: Capture[][] = [];
    const service = createCaptureService({known: () => over.known ?? ['a'], now: () => NOW, lite: () => over.lite ?? false, suspended: id => over.suspended?.includes(id) ?? false,
      target: () => ({url: page.url, run: async script => { page.reads++; page.scripts.push(script); return {open: page.open, rows: page.rows}; }}),
      setTimer: (fn, ms) => { const t = {fn: () => { timers.splice(timers.indexOf(t), 1); fn(); }, ms}; timers.push(t); return t; }, clearTimer: h => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); }});
    return {service, timers, page, events, settle: () => new Promise(r => setTimeout(r, 0))};
  }
  it('não lê nada sem painel aberto nem assinante', async () => {
    const t = setup(); await t.settle();
    expect(t.page.reads).toBe(0); expect(t.timers.length).toBe(0); expect(t.service.watcher.active()).toBe(false);
  });
  it('com o painel aberto lê já e a cada 30 s; a primeira leitura é só base, as seguintes emitem', async () => {
    const t = setup(), seen: Capture[][] = [], off = t.service.subscribe(e => seen.push(e.captures));
    await t.settle();
    expect(t.page.reads).toBe(1); expect(seen).toEqual([]); expect(t.service.list().length).toBe(1);
    expect(t.timers.map(x => x.ms)).toEqual([30_000]);
    t.page.rows = [raw({name: 'Gastly', cls: 'capturas-linha shiny'}), raw()];
    t.timers[0]!.fn(); await t.settle();
    expect(seen.length).toBe(1); expect(seen[0]!.map(c => c.name)).toEqual(['Gastly']); expect(seen[0]![0]!.shiny).toBe(true);
    t.timers[0]!.fn(); await t.settle(); expect(seen.length).toBe(1); // nada novo: sem evento
    off(); expect(t.timers.length).toBe(0); expect(t.service.watcher.active()).toBe(false);
  });
  it('Modo leve lê a cada 60 s; desktop conta como necessidade e fechar para tudo', async () => {
    const t = setup({lite: true});
    t.service.setDesktop(true); await t.settle();
    expect(t.timers.map(x => x.ms)).toEqual([60_000]);
    t.service.setDesktop(false); expect(t.timers.length).toBe(0);
    const reads = t.page.reads; await t.settle(); expect(t.page.reads).toBe(reads);
  });
  it('pula contas suspensas, páginas de outro site e painel do jogo ausente (sem virar base)', async () => {
    const s = setup({suspended: ['a']}); s.service.setDesktop(true); await s.settle(); expect(s.page.reads).toBe(0); s.service.stop();
    const o = setup(); o.page.url = 'https://accounts.example.com/login'; o.service.setDesktop(true); await o.settle(); expect(o.page.reads).toBe(0); o.service.stop();
    const c = setup(), seen: Capture[][] = [], off = c.service.subscribe(e => seen.push(e.captures));
    c.page.open = false; await c.settle(); c.page.open = true; c.timers[0]!.fn(); await c.settle();
    expect(seen).toEqual([]); expect(c.service.list().length).toBe(1); off();
  });
  it('assinante com defeito não derruba os outros e onEvent não conta como necessidade', async () => {
    const t = setup(), seen: Capture[][] = [];
    t.service.subscribe(() => { throw new Error('x'); }); t.service.subscribe(e => seen.push(e.captures)); await t.settle();
    t.page.rows = [raw({name: 'Novo'})]; t.timers[0]!.fn(); await t.settle();
    expect(seen.length).toBe(1);
  });
});
