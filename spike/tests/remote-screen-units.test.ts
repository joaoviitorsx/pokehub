import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptKey, offeredProtocols, validHandshake } from '../remote/ws';
import { ALLOWED_KEYS, BLOCKED_SHORTCUTS, InputLimiter, isBlockedShortcut, mapPoint, sanitizeInput } from '../remote/screen-input';
import { isGameOrigin } from '../remote/screen';
import { decodeFrame, encodeFrame } from '../contracts/screen';
import { FIT, MAX_SCALE, clampView, countdown, inputFromBefore, pan, pinch, toImage, toggleZoom, twoFingerKind, wheelDelta } from '../remote-ui/screen-helpers';
import { bannerText } from '../src/screen-banner';
import { PASSWORD_SCRIPT, createGhostWindow, createScreenTarget } from '../electron/screen-target';

describe('WebSocket: handshake', () => {
  it('Sec-WebSocket-Accept do exemplo da RFC 6455', () => expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo='));
  it('valida método, Upgrade, Connection, versão 13 e chave de 16 bytes', () => {
    const ok = {method: 'GET', headers: {upgrade: 'WebSocket', connection: 'keep-alive, Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='}};
    expect(validHandshake(ok)).toBe(true);
    for (const bad of [{...ok, method: 'POST'}, {...ok, headers: {...ok.headers, upgrade: 'h2c'}}, {...ok, headers: {...ok.headers, connection: 'close'}}, {...ok, headers: {...ok.headers, 'sec-websocket-version': '8'}}, {...ok, headers: {...ok.headers, 'sec-websocket-key': 'curta'}}]) expect(validHandshake(bad)).toBe(false);
    expect(offeredProtocols({headers: {'sec-websocket-protocol': 'a, ph.v1 ,b'}})).toEqual(['a', 'ph.v1', 'b']);
  });
});
describe('quadro binário', () => {
  it('ida e volta; rejeita cabeçalho malformado ou sem imagem', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), data = encodeFrame({seq: 7, w: 640, h: 360, at: 123}, jpeg), back = decodeFrame(data)!;
    expect(back.header).toEqual({seq: 7, w: 640, h: 360, at: 123}); expect([...back.jpeg]).toEqual([...jpeg]);
    expect(decodeFrame(new Uint8Array([0, 0, 0, 2, 1, 2]))).toBeNull(); expect(decodeFrame(new Uint8Array(3))).toBeNull(); expect(decodeFrame(encodeFrame({seq: 1, w: 1, h: 1, at: 1}, new Uint8Array(0)))).toBeNull();
    const bad = new Uint8Array(30); new DataView(bad.buffer).setUint32(0, 10); bad.set(new TextEncoder().encode('{"seq":"x"}').subarray(0, 10), 4); expect(decodeFrame(bad)).toBeNull();
  });
});
describe('origem do jogo', () => {
  it('só https://pokeidle.io exato', () => {
    expect(isGameOrigin('https://pokeidle.io/')).toBe(true); expect(isGameOrigin('https://pokeidle.io/x?y=1#z')).toBe(true);
    for (const u of ['http://pokeidle.io', 'https://pokeidle.io:444', 'https://www.pokeidle.io', 'https://pokeidle.io.evil.com', 'https://evil.com/?https://pokeidle.io', 'https://user@evil.com', 'file:///pokeidle.io', '', 'lixo']) expect(isGameOrigin(u), u).toBe(false);
  });
});

describe('entrada: coordenadas e atalhos', () => {
  const frame = {w: 640, h: 360}, view = {width: 1000, height: 500};
  it('mapPoint escala e prende dentro da view', () => {
    expect(mapPoint(320, 180, frame, view)).toEqual({x: 500, y: 250}); expect(mapPoint(640, 360, frame, view)).toEqual({x: 999, y: 499}); expect(mapPoint(0, 0, frame, view)).toEqual({x: 0, y: 0});
    expect(mapPoint(1e9, -1e9, frame, view)).toEqual({x: 999, y: 0}); expect(mapPoint(NaN, 1, frame, view)).toBeNull(); expect(mapPoint(Infinity, 1, frame, view)).toBeNull(); expect(mapPoint(1, 1, {w: 0, h: 0}, view)).toBeNull(); expect(mapPoint(1, 1, frame, {width: 0, height: 5})).toBeNull();
  });
  it('todos os atalhos documentados estão bloqueados', () => {
    const parse = (s: string) => { const parts = s.split('+'), key = parts.pop()!; return {key: key === 'Left' ? 'ArrowLeft' : key === 'Right' ? 'ArrowRight' : key, mods: parts.map(p => p.toLowerCase())}; };
    for (const sc of BLOCKED_SHORTCUTS) { const {key, mods} = parse(sc); expect(isBlockedShortcut(key, mods), sc).toBe(true); expect(sanitizeInput({k: 'kd', key, ...(mods.length ? {m: mods} : {})}, frame, view).ok, sc).toBe(false); }
    expect([...ALLOWED_KEYS].every(k => !isBlockedShortcut(k))).toBe(true); expect(isBlockedShortcut('a', ['shift'])).toBe(false);
  });
  it('sem quadro ainda (nada foi mostrado ao celular): o mouse é recusado', () => expect(sanitizeInput({k: 'md', x: 1, y: 1}, null, view)).toEqual({ok: false, reason: 'quadro'}));
  it('limitador: 30/s e 500 caracteres/min com relógio injetado', () => {
    let t = 0; const l = new InputLimiter(() => t); let ok = 0; for (let i = 0; i < 50; i++) if (l.allow(0)) ok++; expect(ok).toBe(30); t += 1000; expect(l.allow(0)).toBe(true);
    t += 10_000; const c = new InputLimiter(() => t); let chars = 0; for (let i = 0; i < 40; i++) { t += 100; if (c.allow(16)) chars += 16; } expect(chars).toBe(496); t += 60_001; expect(c.allow(16)).toBe(true);
  });
});

describe('celular: gestos e contas', () => {
  const W = 360, H = 202;
  it('zoom nunca passa de 5× nem deixa borda vazia; pan respeita os limites', () => {
    const z = pinch(FIT, {cx: 180, cy: 100, d: 50}, {cx: 180, cy: 100, d: 5000}, W, H); expect(z.scale).toBe(MAX_SCALE); expect(z.tx).toBeLessThanOrEqual(0); expect(z.tx).toBeGreaterThanOrEqual(W - W * MAX_SCALE);
    expect(pan(FIT, 500, 500, W, H)).toEqual(FIT); const p = pan({scale: 2, tx: 0, ty: 0}, -9999, -9999, W, H); expect(p).toEqual({scale: 2, tx: -W, ty: -H}); expect(clampView({scale: 0.2, tx: 50, ty: 50}, W, H)).toEqual(FIT);
  });
  it('pinça mantém o ponto sob os dedos; duplo toque alterna 2,5× e volta', () => {
    const v = pinch(FIT, {cx: 100, cy: 50, d: 100}, {cx: 100, cy: 50, d: 200}, W, H), img = (100 - v.tx) / v.scale; expect(img).toBeCloseTo(100, 5);
    const z = toggleZoom(FIT, 180, 101, W, H); expect(z.scale).toBe(2.5); expect(toggleZoom(z, 0, 0, W, H)).toEqual(FIT);
  });
  it('toque → pixel da imagem; fora da imagem não vira clique', () => {
    const rect = {left: 10, top: 20, width: 320, height: 180}; expect(toImage(170, 110, rect, {w: 640, h: 360})).toEqual({x: 320, y: 180}); expect(toImage(5, 110, rect, {w: 640, h: 360})).toBeNull(); expect(toImage(170, 500, rect, {w: 640, h: 360})).toBeNull(); expect(toImage(1, 1, {left: 0, top: 0, width: 0, height: 0}, {w: 1, h: 1})).toBeNull();
  });
  it('dois dedos: pinça × rolagem × nada; roda do mouse segue o sentido do dedo', () => {
    expect(twoFingerKind(100, 140, 0)).toBe('pinch'); expect(twoFingerKind(100, 104, 30)).toBe('scroll'); expect(twoFingerKind(100, 104, 3)).toBeNull(); expect(wheelDelta(0, -10).dy).toBe(20); expect(wheelDelta(5, 0).dx).toBe(-10);
  });
  it('teclado do celular: texto vira `ch` em blocos de ≤16, Backspace/Enter viram teclas, o resto some', () => {
    expect(inputFromBefore('insertText', 'oi')).toEqual([{k: 'ch', text: 'oi'}]); expect(inputFromBefore('insertFromPaste', 'x'.repeat(40))).toHaveLength(3); expect(inputFromBefore('insertText', 'a\u0007b\n')).toEqual([{k: 'ch', text: 'ab'}]);
    expect(inputFromBefore('deleteContentBackward', null)).toEqual([{k: 'kd', key: 'Backspace'}, {k: 'ku', key: 'Backspace'}]); expect(inputFromBefore('insertLineBreak', null)).toHaveLength(2); expect(inputFromBefore('historyUndo', null)).toEqual([]);
  });
  it('contagem regressiva', () => { expect(countdown(600_000)).toBe('10:00'); expect(countdown(61_001)).toBe('1:02'); expect(countdown(-5)).toBe('0:00'); });
  it('banner do PC: quem vê, quem controla (e até quando), sem e-mail', () => {
    const one = {deviceId: 'd', device: 'Pixel', account: 'Principal', profileId: 'p', control: false, since: 1, controlUntil: null};
    expect(bannerText([])).toBe(''); expect(bannerText([one])).toBe('Celular Pixel está vendo Principal');
    const t = bannerText([one, {deviceId: 'e', device: 'iPhone', account: 'Farm', profileId: 'q', control: true, since: 1, controlUntil: Date.now() + 60_000}]);
    expect(t).toMatch(/^Celular iPhone está CONTROLANDO Farm até \d{2}:\d{2} \(\+1\)$/);
  });
});

describe('ponte do Electron (alvos falsos)', () => {
  const fakeImage = (w: number): unknown => ({isEmpty: () => false, getSize: () => ({width: w, height: w / 2}), resize: ({width}: {width: number}) => fakeImage(width), toBitmap: () => Buffer.from([1, 2, 3]), toJPEG: (q: number) => Buffer.from([0xff, 0xd8, q])});
  const fakeContents = () => {
    const c = {captured: 0, js: [] as string[], sent: [] as unknown[], destroyed: false, empty: false, width: 1920, isDestroyed: () => c.destroyed, isCrashed: () => false, getURL: () => 'https://pokeidle.io/',
      capturePage: async () => { c.captured++; return c.empty ? {isEmpty: () => true} : fakeImage(c.width); },
      executeJavaScriptInIsolatedWorld: async (_w: number, scripts: {code: string}[]): Promise<unknown> => { c.js.push(scripts[0]!.code); return false; }, sendInputEvent: (e: unknown) => { c.sent.push(e); }};
    return c;
  };
  const fakeView = (c: ReturnType<typeof fakeContents>, bounds = {x: 0, y: 40, width: 800, height: 450}) => { const v = {webContents: c, bounds: {...bounds}, getBounds: () => ({...v.bounds}), setBounds: (b: typeof bounds) => { v.bounds = {...b}; }}; return v; };
  const ghostStub = () => { const g = {acquired: 0, released: 0, acquire: () => { g.acquired++; return () => { g.released++; }; }, reveal: () => undefined, active: () => false}; return g; };
  it('nunca cria alvo para o webContents do hub', () => { const hub = fakeContents(); expect(() => createScreenTarget(fakeView(hub) as never, hub as never, ghostStub())).toThrow(/hub/); });
  it('captura só o webContents da conta, reduz a 1280 de largura e codifica JPEG com a qualidade pedida', async () => {
    const hub = fakeContents(), acc = fakeContents(), t = createScreenTarget(fakeView(acc) as never, hub as never, ghostStub());
    const f = (await t.capture({maxWidth: 1280, quality: 60}))!; expect(f.width).toBe(1280); expect(f.height).toBe(640); expect(f.jpeg()[2]).toBe(60); expect(acc.captured).toBe(1); expect(hub.captured).toBe(0); expect(t.key).toBe(acc);
    acc.width = 800; expect((await t.capture({maxWidth: 1280, quality: 60}))!.width).toBe(800); acc.empty = true; expect(await t.capture({maxWidth: 1280, quality: 60})).toBeNull();
  });
  it('verificação de senha: script constante no mundo isolado; qualquer resultado diferente de false conta como senha', async () => {
    const acc = fakeContents(), t = createScreenTarget(fakeView(acc) as never, fakeContents() as never, ghostStub()); expect(await t.passwordFocused()).toBe(false); expect(acc.js).toEqual([PASSWORD_SCRIPT]);
    acc.executeJavaScriptInIsolatedWorld = async () => true; expect(await t.passwordFocused()).toBe(true); acc.executeJavaScriptInIsolatedWorld = async () => { throw new Error('x'); }; await expect(t.passwordFocused()).rejects.toThrow(); // o serviço trata o erro como "senha"
    expect(PASSWORD_SCRIPT).not.toMatch(/\$\{|fetch|XMLHttp|\.value/);
  });
  it('input vai ao webContents da conta; hold devolve exatamente os limites que mudou', () => {
    const hub = fakeContents(), acc = fakeContents(), g = ghostStub(), view = fakeView(acc, {x: 0, y: 0, width: 0, height: 0}), t = createScreenTarget(view as never, hub as never, g);
    t.input({type: 'keyDown', keyCode: 'Enter'}); expect(acc.sent).toEqual([{type: 'keyDown', keyCode: 'Enter'}]); expect(hub.sent).toEqual([]);
    const release = t.hold!(); expect(g.acquired).toBe(1); expect(view.bounds.width).toBe(1280); release(); expect(g.released).toBe(1); expect(view.bounds).toEqual({x: 0, y: 0, width: 0, height: 0});
    const r2 = t.hold!(); view.setBounds({x: 5, y: 5, width: 700, height: 400}); r2(); expect(view.bounds).toEqual({x: 5, y: 5, width: 700, height: 400}); // alguém (o layout) mexeu: não desfaz
  });
  it('janela fantasma: só age com a janela escondida e restaura exatamente (opacidade, mouse, barra de tarefas, escondida)', async () => {
    const calls: string[] = [];
    const w = Object.assign(new EventEmitter(), {visible: false, minimized: false, isDestroyed: () => false, isVisible: () => w.visible, isMinimized: () => w.minimized,
      setSkipTaskbar: (v: boolean) => calls.push(`skip:${v}`), setOpacity: (v: number) => calls.push(`opacity:${v}`), setIgnoreMouseEvents: (v: boolean) => calls.push(`ignore:${v}`), showInactive: () => { w.visible = true; calls.push('showInactive'); }, hide: () => { w.visible = false; calls.push('hide'); }});
    const ghost = createGhostWindow(w as never), release = ghost.acquire(); expect(ghost.active()).toBe(true); expect(calls).toEqual(['skip:true', 'opacity:0', 'ignore:true', 'showInactive']);
    calls.length = 0; release(); expect(ghost.active()).toBe(false); expect(calls).toEqual(['hide', 'opacity:1', 'ignore:false', 'skip:false']); // volta escondida e normal
    calls.length = 0; w.visible = true; const r2 = ghost.acquire(); expect(calls).toEqual([]); r2(); expect(calls).toEqual([]); // janela visível: não mexe em nada
    w.visible = false; const r3 = ghost.acquire(); calls.length = 0; ghost.reveal(); expect(calls).toEqual(['opacity:1', 'ignore:false', 'skip:false']); r3(); expect(calls).not.toContain('hide'); // o usuário abriu a janela de verdade
    w.visible = false; calls.length = 0; const r4 = ghost.acquire(); calls.length = 0; w.visible = false; ghost.reveal(); w.visible = false; w.emit('hide'); await new Promise(resolve => setImmediate(resolve));
    expect(calls).toContain('showInactive'); r4(); // voltou para a bandeja com alguém assistindo: reaplica
  });
  it('arquitetura: sem desktopCapturer e sem captura de nada além do webContents da conta', () => {
    const code = (f: string) => readFileSync(resolve(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, ''); // sem comentários
    const src = ['spike/electron/screen-target.ts', 'spike/electron/main.ts', 'spike/remote/screen.ts', 'spike/remote/hub.ts'].map(code).join('\n');
    expect(src).not.toMatch(/desktopCapturer|getSources|window\.webContents\.capturePage|window\.capturePage/); expect(code('spike/electron/screen-target.ts').match(/capturePage\(/g)).toHaveLength(1);
    expect(readFileSync(resolve('spike/electron/main.ts'), 'utf8')).toMatch(/forbidden:\(\) => window\.isDestroyed\(\) \? \[\] : \[window\.webContents\]/);
  });
});
