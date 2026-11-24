import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Canais que a interface (renderer) pode usar. Adicionar um canal exige atualizar esta lista de propósito (revisão de segurança).
const INVOKE = ['captures:clear', 'captures:list', 'captures:watch', 'daytype:notify', 'daytype:setNotify', 'deadlines:get', 'deadlines:notify', 'deadlines:refresh', 'deadlines:setNotify', 'diagnostics:processes', 'diagnostics:sample', 'extensions:add', 'extensions:approve', 'extensions:detect', 'extensions:list', 'extensions:remove', 'extensions:store', 'extensions:toggle', 'ficha:review', 'ficha:setReview', 'hunt:snapshot', 'hunt:team', 'market:alerts', 'market:badges', 'market:locate', 'market:readAll', 'market:removeAlert', 'market:saveAlert', 'market:setBadges', 'market:testToast', 'market:scan', 'market:stop', 'network:allow', 'network:disallow', 'network:get', 'network:mode', 'performance:get', 'performance:set', 'preferences:get', 'preferences:set', 'profiles:create', 'profiles:list', 'profiles:orphans', 'profiles:remove', 'profiles:update', 'profiles:wipeOrphans', 'remote:alerts', 'remote:allow-network', 'remote:audit', 'remote:clear-pin', 'remote:decide', 'remote:devices', 'remote:dismiss-notice', 'remote:enable', 'remote:pair-cancel', 'remote:pair-start', 'remote:purchases', 'remote:push-test', 'remote:reenable-actions', 'remote:reveal-code', 'remote:revoke', 'remote:screen-end', 'remote:set-can-act', 'remote:set-can-control', 'remote:set-cap', 'remote:set-pin', 'remote:status', 'session:clear', 'session:drag', 'session:layout', 'session:reload', 'session:restart', 'session:resume', 'session:states', 'session:suspend', 'shop:read', 'shop:run', 'shop:stop', 'stock:get', 'stock:refresh', 'stock:setRules', 'tray:get', 'tray:set', 'stream:browser', 'stream:channel', 'stream:get', 'stream:hide', 'stream:link', 'stream:rewards', 'stream:show', 'stream:unlink', 'stream:update', 'update:auto', 'update:check', 'update:download', 'update:get', 'update:install', 'window:close', 'window:minimize', 'window:state', 'window:toggleMaximize', 'workspace:auto-focus', 'workspace:initial-focus'];
const LISTEN = ['captures:new', 'deadlines:changed', 'market:alertHit', 'market:openAlerts', 'market:progress', 'performance:changed', 'remote:changed', 'session:status', 'shop:progress', 'stock:changed', 'stock:openRestock', 'stream:changed', 'update:status', 'window:state', 'workspace:auto-focus', 'workspace:focus', 'workspace:toggle-expand', 'workspace:toggle-side'];
const read = (file: string) => readFileSync(resolve('spike/electron', file), 'utf8');
const names = (source: string, call: RegExp) => [...new Set([...source.matchAll(call)].map(match => match[1]!))].sort();

describe('canais do preload', () => {
  const preload = read('preload.ts'), main = read('main.ts'), remoteIpc = readFileSync(resolve('spike/remote/ipc.ts'), 'utf8');
  it('o preload só expõe os canais da lista (invoke e listeners)', () => {
    expect(names(preload, /ipcRenderer\.invoke\('([^']+)'/g)).toEqual([...INVOKE].sort());
    expect(names(preload, /ipcRenderer\.on\('([^']+)'/g)).toEqual([...LISTEN].sort());
  });
  it('todo canal exposto tem handler no main e vice-versa (nada exposto à toa)', () => {
    // o acesso remoto registra os seus canais em spike/remote/ipc.ts (mesma checagem de origem confiável)
    expect([...new Set([...names(main, /ipcMain\.handle\('([^']+)'/g), ...names(remoteIpc, /\bhandle\('([^']+)'/g)])].sort()).toEqual([...INVOKE].sort());
  });
  it('shop:buy não é mais exposto; a compra única é interna', () => {
    expect(preload).not.toContain('shop:buy');
    expect(main).not.toContain('shop:buy');
  });
  it('o preload não importa nada além do electron', () => {
    expect([...preload.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['electron']);
  });
});

describe('main: travas de runtime', () => {
  const main = read('main.ts');
  it('Market, Loja e Capturas rodam no mundo isolado; só o /hunt usa o mundo principal', () => {
    expect(main).toContain('executeJavaScriptInIsolatedWorld(999,');
    expect([...main.matchAll(/\.executeJavaScript\(/g)]).toHaveLength(1); // huntTarget
  });
  it('as views do jogo usam safeDialogs e o IPC confere a URL do quadro', () => {
    expect(main).toContain('...SAFE_DIALOGS');
    expect(main).toContain('isAppFrameUrl(event.senderFrame.url,appUrl)');
  });
  it('a fila de apagamento roda antes de criar o banco/sessões', () => {
    expect(main.indexOf('runPendingWipes(')).toBeGreaterThan(0);
    expect(main.indexOf('runPendingWipes(')).toBeLessThan(main.indexOf('new ProfileStore('));
  });
});
