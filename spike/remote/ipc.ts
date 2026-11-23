// IPC do acesso remoto (renderer → main). Só a janela principal; respostas genéricas; nada de chave, token ou caminho.
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { RemoteUserError, type RemoteHub } from './hub';

export function registerRemoteIpc(ipcMain: Pick<IpcMain, 'handle'>, trusted: (event: IpcMainInvokeEvent) => boolean, hub: RemoteHub, changed: () => void = () => undefined) {
  const handle = (channel: string, run: (...args: unknown[]) => unknown) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) return {ok: false, error: 'Origem não autorizada.'};
    try { const data = await run(...args); changed(); return {ok: true, data}; }
    catch (error) { return {ok: false, error: error instanceof RemoteUserError ? error.message : 'Não foi possível concluir a operação.'}; }
  });
  handle('remote:status', () => hub.status());
  handle('remote:enable', async value => { if (typeof value !== 'boolean') throw new Error(); await hub.setEnabled(value); return hub.status(); });
  handle('remote:allow-network', async () => { await hub.allowNetwork(); return hub.status(); });
  handle('remote:pair-start', () => hub.startPairing());
  handle('remote:pair-cancel', () => { hub.cancelPairing(); return hub.status(); });
  handle('remote:reveal-code', () => hub.revealCode());
  handle('remote:decide', async allow => { if (typeof allow !== 'boolean') throw new Error(); await hub.decide(allow); return hub.status(); });
  handle('remote:set-pin', async pin => { await hub.setPin(pin); return hub.status(); });
  handle('remote:clear-pin', () => { hub.clearPin(); return hub.status(); });
  handle('remote:reenable-actions', () => { hub.reenableActions(); return hub.status(); });
  handle('remote:dismiss-notice', () => { hub.dismissNotice(); return hub.status(); });
  handle('remote:devices', () => hub.devices());
  handle('remote:set-can-act', (id, value) => hub.setCanAct(id, value));
  handle('remote:revoke', id => { if (!hub.revoke(id)) throw new RemoteUserError('Aparelho não encontrado.'); return hub.devices(); });
  handle('remote:audit', () => hub.audit());
  handle('remote:push-test', id => hub.pushTest(id));
  handle('remote:alerts', () => hub.alerts(20));
  handle('remote:screen-end', mode => { if (mode !== 'control' && mode !== 'all') throw new Error(); if (mode === 'control') hub.endControl(); else hub.endScreen(); return hub.status(); });
}
