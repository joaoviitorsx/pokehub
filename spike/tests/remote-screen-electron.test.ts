import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createControlShortcut, createGhostWindow, installNavigationLock } from '../electron/screen-target';
import { createChangeNotifier, screenNotice } from '../electron/screen-notify';
import { BannerView, startBanner } from '../src/screen-banner';

class FakeWin extends EventEmitter {
  visible = false; opacity = 1; mouse = true; focusable = true; skip = false;
  isDestroyed() { return false; } isVisible() { return this.visible; } isMinimized() { return false; }
  setSkipTaskbar(v: boolean) { this.skip = v; } setOpacity(v: number) { this.opacity = v; } setIgnoreMouseEvents(v: boolean) { this.mouse = !v; } setFocusable(v: boolean) { this.focusable = v; }
  showInactive() { this.visible = true; } hide() { this.visible = false; }
}
describe('janela fantasma', () => {
  it('focar a janela fantasma restaura opacidade, mouse e foco', () => {
    const w = new FakeWin(), g = createGhostWindow(w as never); g.acquire(); expect(g.active()).toBe(true); expect(w.opacity).toBe(0); expect(w.focusable).toBe(false);
    w.emit('focus'); expect(g.active()).toBe(false); expect([w.opacity, w.mouse, w.focusable]).toEqual([1, true, true]);
  });
  it('o show assíncrono do showInactive não desfaz o fantasma; o show seguinte (usuário) sim', () => {
    const w = new FakeWin(), g = createGhostWindow(w as never); g.acquire(); w.emit('show'); expect(g.active()).toBe(true); w.emit('show'); expect(g.active()).toBe(false);
  });
});
describe('atalho, navegação, avisos e faixa', () => {
  it('register falso vira indisponível', () => {
    const r: boolean[] = [], sync = createControlShortcut({register: () => false, unregister: () => undefined}, 'X', () => undefined, d => r.push(d)); sync(1); sync(0); expect(r).toEqual([true, false]);
  });
  it('durante o controle, navegar para fora do jogo volta ao jogo e encerra o controle', () => {
    const c = new EventEmitter() as EventEmitter & {loadURL: ReturnType<typeof vi.fn>}; c.loadURL = vi.fn(async () => undefined); const bad: string[] = [];
    installNavigationLock(c as never, {id: 'a', controlling: () => true, allowedSession: () => true, allowedGame: u => u.startsWith('https://pokeidle.io'), gameUrl: 'https://pokeidle.io/app', onViolation: id => bad.push(id)});
    const ev = {url: 'https://evil.example/', isMainFrame: true, preventDefault: vi.fn()}; c.emit('will-frame-navigate', ev); expect(ev.preventDefault).toHaveBeenCalled();
    c.emit('did-navigate-in-page', {}, 'https://evil.example/x', true); expect(c.loadURL).toHaveBeenCalledWith('https://pokeidle.io/app'); expect(bad).toEqual(['a']);
  });
  it('remote:changed sai UMA vez por rajada; texto da notificação', () => {
    vi.useFakeTimers(); const send = vi.fn(), n = createChangeNotifier({send, refresh: () => undefined}); for (let i = 0; i < 20; i++) n.notify(); vi.advanceTimersByTime(400); expect(send).toHaveBeenCalledTimes(1); vi.useRealTimers();
    expect(screenNotice('controle', 'Pixel', 'Principal').body).toBe('Celular Pixel está CONTROLANDO Principal — Ctrl+Shift+F12 encerra');
  });
  it('faixa recarrega a cada onChanged e mostra/oculta a sessão', async () => {
    let cb: () => void = () => undefined, list: unknown[] = []; const states: unknown[] = [];
    const stop = startBanner({status: async () => ({ok: true as const, data: {screen: list} as never}), onChanged: f => { cb = f; return () => undefined; }}, s => states.push(s));
    await new Promise(r => setTimeout(r, 5)); list = [{deviceId: 'd', device: 'Pixel', account: 'Principal', profileId: 'p', control: true, since: 1, controlUntil: null}]; cb(); await new Promise(r => setTimeout(r, 5)); stop();
    expect(states).toHaveLength(2); const html = (s: unknown) => renderToStaticMarkup(createElement(BannerView, {state: s as never, onEndControl: () => undefined, onEndAll: () => undefined}));
    expect(html(states[0])).toBe(''); expect(html({...(states[1] as object), shortcutDown: true})).toMatch(/CONTROLANDO Principal.*indisponível/);
  });
});
