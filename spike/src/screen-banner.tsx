// Faixa do hub enquanto um celular vê ou controla uma conta (R5): quem, qual conta, e o botão que corta na hora. Atalho global: Ctrl+Shift+F12 encerra o controle.
import { useEffect, useState } from 'react';
import type { RemoteScreenSession } from '../contracts/screen';
import type { RemoteStatus } from '../contracts/remote';
import './screen-banner.css';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
interface Client { status(): Promise<Result<RemoteStatus>>; screenEnd(mode: 'control' | 'all'): Promise<Result<RemoteStatus>>; onChanged(callback: () => void): () => void }
const client = () => (window.pokehub as unknown as {remote: Client}).remote;
const clock = (ms: number | null) => ms === null ? '' : new Date(ms).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});

/** Texto da faixa (puro, testável). */
export function bannerText(list: readonly RemoteScreenSession[]): string {
  const first = list[0]; if (!first) return '';
  const more = list.length > 1 ? ` (+${list.length - 1})` : '', ctl = list.some(s => s.control);
  const who = ctl ? list.find(s => s.control)! : first;
  return `Celular ${who.device} ${who.control ? 'está CONTROLANDO' : 'está vendo'} ${who.account}${who.control && who.controlUntil ? ` até ${clock(who.controlUntil)}` : ''}${more}`;
}
export function ScreenBanner() {
  const [list, setList] = useState<RemoteScreenSession[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await client().status(); if (alive && r.ok) setList(r.data.screen ?? []); } catch { /* sem acesso remoto */ } };
    void load(); const off = client().onChanged(() => { void load(); });
    return () => { alive = false; off(); };
  }, []);
  if (!list.length) return null;
  const control = list.some(s => s.control), text = bannerText(list);
  return <div className="screen-banner" data-control={control} role="status" aria-live="polite"><i className="dot" aria-hidden="true"/><span title={text}>{text}</span>
    {control && <button className="danger" title="Encerrar controle (Ctrl+Shift+F12)" onClick={() => { void client().screenEnd('control'); }}>Encerrar controle</button>}
    <button title="Cortar a tela remota" onClick={() => { void client().screenEnd('all'); }}>Cortar</button></div>;
}
