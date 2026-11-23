// Faixa do hub enquanto um celular vê ou controla uma conta (R5): quem, qual conta, e o botão que corta na hora. Atalho global: Ctrl+Shift+F12 encerra o controle.
import { useEffect, useState } from 'react';
import type { RemoteScreenSession } from '../contracts/screen';
import type { RemoteStatus } from '../contracts/remote';
import './screen-banner.css';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
export interface BannerClient { status(): Promise<Result<RemoteStatus>>; screenEnd(mode: 'control' | 'all'): Promise<Result<RemoteStatus>>; onChanged(callback: () => void): () => void }
const client = () => (window.pokehub as unknown as {remote: BannerClient}).remote;
const clock = (ms: number | null) => ms === null ? '' : new Date(ms).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});

/** Texto da faixa (puro, testável). */
export function bannerText(list: readonly RemoteScreenSession[]): string {
  const first = list[0]; if (!first) return '';
  const more = list.length > 1 ? ` (+${list.length - 1})` : '', ctl = list.some(s => s.control);
  const who = ctl ? list.find(s => s.control)! : first;
  return `Celular ${who.device} ${who.control ? 'está CONTROLANDO' : 'está vendo'} ${who.account}${who.control && who.controlUntil ? ` até ${clock(who.controlUntil)}` : ''}${more}`;
}
export interface BannerState { list: RemoteScreenSession[]; shortcutDown: boolean }
/** Mantém o estado da faixa: carrega ao iniciar e a CADA `remote:changed` (o hub avisa quando alguém começa/termina de ver ou controlar). Devolve quem desliga. */
export function startBanner(c: Pick<BannerClient, 'status' | 'onChanged'>, set: (state: BannerState) => void): () => void {
  let alive = true;
  const load = async () => { try { const r = await c.status(); if (alive && r.ok) set({list: r.data.screen ?? [], shortcutDown: r.data.shortcutDown === true}); } catch { /* sem acesso remoto */ } };
  void load(); const off = c.onChanged(() => { void load(); });
  return () => { alive = false; off(); };
}
export function BannerView({state, onEndControl, onEndAll}: {state: BannerState; onEndControl(): void; onEndAll(): void}) {
  const {list, shortcutDown} = state;
  if (!list.length) return null;
  const control = list.some(s => s.control), text = bannerText(list);
  return <div className="screen-banner" data-control={control} role="status" aria-live="polite"><i className="dot" aria-hidden="true"/><span title={text}>{text}</span>
    {control && shortcutDown && <span className="warn" role="alert">Atalho Ctrl+Shift+F12 indisponível (outro app o usa): use o botão</span>}
    {control && <button className="danger" title="Encerrar controle (Ctrl+Shift+F12)" onClick={onEndControl}>Encerrar controle</button>}
    <button title="Cortar a tela remota" onClick={onEndAll}>Cortar</button></div>;
}
export function ScreenBanner() {
  const [state, setState] = useState<BannerState>({list: [], shortcutDown: false});
  useEffect(() => startBanner(client(), setState), []);
  return <BannerView state={state} onEndControl={() => { void client().screenEnd('control'); }} onEndAll={() => { void client().screenEnd('all'); }}/>;
}
