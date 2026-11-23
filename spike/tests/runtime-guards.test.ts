import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_BUSY, createAccountLock } from '../electron/account-lock';
import { MAX_SPRITES_BYTES, readJsonBounded } from '../electron/bounded-body';
import { createMarketReader } from '../electron/market-read';
import { createShop } from '../electron/shop';
import { guardNewContents, isAppFrameUrl, lockSession, SAFE_DIALOGS } from '../electron/runtime-guards';

describe('lockSession', () => {
  it('cancela downloads, nega permissões (pedido e checagem) e não duplica listeners', () => {
    const emitter = new EventEmitter();
    let request: ((...a: unknown[]) => void) | undefined, check: (() => boolean) | undefined;
    const session = Object.assign(emitter, {setPermissionRequestHandler: (h: (...a: unknown[]) => void) => { request = h; }, setPermissionCheckHandler: (h: () => boolean) => { check = h; }});
    lockSession(session); lockSession(session);
    expect(emitter.listenerCount('will-download')).toBe(1);
    const event = {preventDefault: vi.fn()};
    emitter.emit('will-download', event);
    expect(event.preventDefault).toHaveBeenCalled();
    const callback = vi.fn(); request!({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(check!()).toBe(false);
  });
});

describe('guardNewContents', () => {
  it('todo WebContents novo nega janelas e webviews', () => {
    const app = new EventEmitter();
    guardNewContents(app as never);
    const contents = Object.assign(new EventEmitter(), {setWindowOpenHandler: vi.fn()});
    app.emit('web-contents-created', {}, contents);
    expect(contents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({action: 'deny'});
    const event = {preventDefault: vi.fn()};
    contents.emit('will-attach-webview', event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
  it('safeDialogs vem com mensagem', () => { expect(SAFE_DIALOGS).toMatchObject({safeDialogs: true}); expect(SAFE_DIALOGS.safeDialogsMessage.length).toBeGreaterThan(5); });
});

describe('isAppFrameUrl', () => {
  const app = 'file:///E:/app/dist/index.html';
  it('aceita só a interface local (com ou sem hash/query)', () => {
    expect(isAppFrameUrl(app, app)).toBe(true);
    expect(isAppFrameUrl(`${app}#/x`, app)).toBe(true);
    expect(isAppFrameUrl(`${app}?a=1`, app)).toBe(true);
    for (const url of ['https://pokeidle.io/app', 'file:///E:/app/dist/index.html.evil/x', 'file:///E:/outra/index.html', `${app}x`, '', undefined, null, 5]) expect(isAppFrameUrl(url, app)).toBe(false);
    expect(isAppFrameUrl(app, '')).toBe(false);
  });
});

describe('readJsonBounded', () => {
  const streamOf = (chunks: Uint8Array[], onPull?: () => void) => { let i = 0, cancelled = false; const stream = new ReadableStream<Uint8Array>({pull(controller) { onPull?.(); if (cancelled || i >= chunks.length) { controller.close(); return; } controller.enqueue(chunks[i++]!); }, cancel() { cancelled = true; }}); return stream; };
  const response = (body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) => ({body, headers: {get: (name: string) => headers[name.toLowerCase()] ?? null}});
  it('lê JSON pequeno em vários pedaços', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({retratos: {1: {x: 1}}}));
    expect(await readJsonBounded(response(streamOf([bytes.slice(0, 5), bytes.slice(5)])))).toEqual({retratos: {1: {x: 1}}});
  });
  it('aborta um corpo de mais de 1 MB sem content-length, lendo poucos pedaços', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(65); let pulls = 0;
    const body = streamOf(Array.from({length: 80}, () => chunk), () => { pulls++; }); // 80 × 16 KB = 1,25 MB
    await expect(readJsonBounded(response(body))).rejects.toThrow();
    expect(pulls).toBeLessThan(10); // parou perto de 64 KB, não leu o resto
    expect(MAX_SPRITES_BYTES).toBe(65536);
  });
  it('recusa content-length declarado acima do limite e corpo ausente', async () => {
    await expect(readJsonBounded(response(streamOf([new Uint8Array(2)]), {'content-length': '70000'}))).rejects.toThrow();
    await expect(readJsonBounded(response(null))).rejects.toThrow();
    await expect(readJsonBounded(response(streamOf([new TextEncoder().encode('não é json')])))).rejects.toThrow();
  });
});

describe('trava única por conta', () => {
  it('acquire é exclusivo por conta e o release é idempotente', () => {
    const lock = createAccountLock();
    const release = lock.acquire('a')!;
    expect(lock.acquire('a')).toBeNull(); expect(lock.acquire('b')).not.toBeNull();
    release(); release();
    expect(lock.acquire('a')).not.toBeNull();
  });
  it('Loja e leitura do Market na mesma conta: a segunda responde "Conta ocupada com outra ação"', async () => {
    const lock = createAccountLock();
    let release!: (v: unknown) => void;
    const shop = createShop({known: () => ['a', 'b'], lock, emit: () => undefined, sleep: async () => undefined, target: () => ({url: 'https://pokeidle.io/app', run: () => new Promise(resolve => { release = resolve; })})});
    const reader = createMarketReader({known: () => ['a', 'b'], lock, emit: () => undefined, sleep: async () => undefined, target: () => ({url: 'https://pokeidle.io/app', run: async () => ({open: false, cards: [], pag: '', query: ''})})});
    const reading = shop.read('a');
    expect(await reader.readAll('a')).toEqual({ok: false, error: ACCOUNT_BUSY});
    expect(await shop.read('a')).toEqual({ok: false, error: ACCOUNT_BUSY});
    expect(await shop.run([{id: 'a', lines: [{cat: 'Pokebolas', name: 'Ultra Ball', qty: 1, unitPrice: 5, total: 5}]}])).toEqual({ok: false, error: ACCOUNT_BUSY});
    expect(await reader.readAll('b')).not.toEqual({ok: false, error: ACCOUNT_BUSY}); // outra conta segue livre
    release({gold: '1', items: []}); await reading;
    expect(await reader.readAll('a')).not.toEqual({ok: false, error: ACCOUNT_BUSY}); // liberou
  });
  it('a leitura do Market em andamento segura a conta até terminar e a Loja é recusada', async () => {
    const lock = createAccountLock();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const page = {open: true, pag: '1 de 2', query: 'Venusaur', cards: [{name: 'Venusaur', preco: '100', moeda: 'gold', id: 'x', cls: '', sub: 'Nv 5', pot: 'P1', nota: '5'}]};
    const reader = createMarketReader({known: () => ['a'], lock, emit: () => undefined, sleep: async () => { await gate; }, target: () => ({url: 'https://pokeidle.io/app', run: async () => page})});
    expect((await reader.readAll('a')).ok).toBe(true);
    const shop = createShop({known: () => ['a'], lock, emit: () => undefined, target: () => ({url: 'https://pokeidle.io/app', run: async () => ({})})});
    expect(await shop.read('a')).toEqual({ok: false, error: ACCOUNT_BUSY});
    reader.stop('a'); finish(); await reader.whenDone('a');
    expect(lock.busy('a')).toBe(false);
  });
});
