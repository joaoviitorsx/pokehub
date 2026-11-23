// Gerenciar → Acesso remoto e o modal "Parear novo aparelho" (tema madeira). Só fala com o main pelo IPC `window.pokehub.remote`.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { qrMatrix, qrPath } from '../domain/qr';
import type { RemoteAuditEntry, RemoteDevice, RemoteStatus } from '../contracts/remote';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
interface RemoteClient {
  status(): Promise<Result<RemoteStatus>>; enable(value: boolean): Promise<Result<RemoteStatus>>; pairStart(): Promise<Result<RemoteStatus>>; pairCancel(): Promise<Result<RemoteStatus>>;
  decide(allow: boolean): Promise<Result<RemoteStatus>>; setPin(pin: string): Promise<Result<RemoteStatus>>; clearPin(): Promise<Result<RemoteStatus>>;
  devices(): Promise<Result<RemoteDevice[]>>; revoke(id: string): Promise<Result<RemoteDevice[]>>; audit(): Promise<Result<RemoteAuditEntry[]>>; onChanged(callback: () => void): () => void;
}
const client = () => (window.pokehub as unknown as {remote: RemoteClient}).remote;
const AUDIT_TEXT: Record<string, string> = {acesso_remoto_ligado: 'Acesso remoto ligado', acesso_remoto_desligado: 'Acesso remoto desligado', pareamento_iniciado: 'Pareamento iniciado', pareamento_pedido: 'Pedido de pareamento', pareamento_aceito: 'Aparelho aceito', pareamento_negado: 'Aparelho recusado', pareamento_codigo_errado: 'Código errado', aparelho_revogado: 'Aparelho revogado', saiu: 'Aparelho saiu', pin_definido: 'PIN definido', pin_removido: 'PIN removido', pin_bloqueado: 'PIN bloqueado'};
const when = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}); };

/** QR do texto como SVG (sem innerHTML): módulos escuros sobre fundo branco com margem. */
export function Qr({text, size = 160, label}: {text: string; size?: number; label: string}) {
  const shape = useMemo(() => { try { return qrPath(qrMatrix(text)); } catch { return null; } }, [text]);
  if (!shape) return <p role="alert">Não foi possível gerar o QR.</p>;
  return <svg className="rm-qr" width={size} height={size} viewBox={`0 0 ${shape.size} ${shape.size}`} role="img" aria-label={label} shapeRendering="crispEdges"><rect width={shape.size} height={shape.size} fill="#fff"/><path d={shape.d} fill="#000"/></svg>;
}

export function RemoteSection({onPair}: {onPair: () => void}) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [audit, setAudit] = useState<RemoteAuditEntry[]>([]);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const [s, d, a] = await Promise.all([client().status(), client().devices(), client().audit()]);
      if (s.ok) setStatus(s.data); else setMessage(s.error);
      if (d.ok) setDevices(d.data); if (a.ok) setAudit(a.data);
    } catch { setMessage('Não foi possível consultar o acesso remoto.'); }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial assíncrona via IPC
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 3000);
    const off = client().onChanged(() => void load());
    return () => { clearInterval(timer); off(); };
  }, []);
  const run = async (action: () => Promise<Result<unknown>>) => {
    if (busy) return; setBusy(true); setMessage('');
    try { const result = await action(); if (!result.ok) setMessage(result.error); await load(); } catch { setMessage('Não foi possível concluir a operação.'); } finally { setBusy(false); }
  };
  const submitPin = (event: FormEvent) => { event.preventDefault(); if (!/^\d{6}$/.test(pin)) { setMessage('O PIN precisa ter 6 dígitos.'); return; } void run(async () => { const r = await client().setPin(pin); if (r.ok) setPin(''); return r; }); };
  if (!status) return <p role="status">{message || 'Carregando…'}</p>;
  const url = status.urls[0];
  return <section aria-label="Acesso remoto">
    <p>Veja suas contas pelo celular, na mesma rede Wi-Fi. Fica <strong>desligado</strong> até você ativar, só aceita aparelhos da sua rede local (nada na internet) e cada aparelho precisa ser aceito aqui no PC.</p>
    <label className="switch"><span>Acesso remoto</span><input type="checkbox" role="switch" checked={status.enabled} disabled={busy} onChange={event => void run(() => client().enable(event.target.checked))}/></label>
    {status.error && <p role="alert">{status.error}</p>}
    {status.enabled && status.running && url && <div className="rm-url">
      <Qr text={url} label={`QR do endereço ${url}`}/>
      <div><h2>Endereço no celular</h2>{status.urls.map(item => <p key={item}><code>{item}</code></p>)}
        <p className="note">Se o Windows perguntar sobre o firewall, permita só em redes <strong>Privadas</strong>. Se o celular não abrir, confira se o Wi-Fi do PC está marcado como rede Privada.</p></div>
    </div>}
    <div className="actions"><button className="primary" disabled={busy || !status.enabled || !status.running} onClick={onPair}>Parear novo aparelho</button></div>
    <h2>PIN de ações</h2>
    <p className="note">O PIN de 6 dígitos libera, no celular, as ações que mudam alguma coisa (nas próximas versões). {status.pinSet ? 'PIN definido. 5 erros bloqueiam o aparelho por 15 minutos.' : 'Nenhum PIN definido ainda.'}</p>
    <form className="rm-pin" onSubmit={submitPin}><label>{status.pinSet ? 'Novo PIN' : 'PIN'} <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d{6}" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))}/></label>
      <button disabled={busy || pin.length !== 6}>{status.pinSet ? 'Trocar PIN' : 'Definir PIN'}</button>{status.pinSet && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remover o PIN? As ações pelo celular ficam bloqueadas até definir outro.')) void run(() => client().clearPin()); }}>Remover</button>}</form>
    <h2>Aparelhos pareados</h2>
    {devices.length === 0 ? <p className="ext-state" data-on="false">Nenhum aparelho pareado.</p> : <ul className="acc-list">{devices.map(device => <li key={device.id} className="acc"><div className="acc-main"><strong>{device.name}</strong></div><small>Pareado em {when(device.createdAt)} · último acesso {when(device.lastSeen)}</small>
      <div className="actions"><button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Revogar “${device.name}”? Ele perde o acesso na hora.`)) void run(() => client().revoke(device.id)); }}>Revogar</button></div></li>)}</ul>}
    <details className="rm-audit"><summary>Registro de auditoria (últimos 100)</summary>
      {audit.length === 0 ? <p className="note">Sem registros.</p> : <ul>{audit.map(entry => <li key={entry.id}><time>{when(entry.at)}</time> · {AUDIT_TEXT[entry.action] ?? entry.action}{entry.detail ? ` — ${entry.detail}` : ''}</li>)}</ul>}</details>
    <p className="note">Por segurança, o código de pareamento vale 2 minutos, só funciona uma vez e o aparelho só entra depois que você aceita aqui. Revogar ou desligar corta o acesso na hora. Para a notificação e a instalação do app no celular funcionarem, instale o certificado do PokéHub no aparelho (o passo aparece ao parear).</p>
    {message && <p role="alert">{message}</p>}
  </section>;
}

/** Modal de pareamento: endereço + QR, código grande com contagem, pedido "Permitir este aparelho?" e (1ª vez) o passo do certificado. */
export function PairModal({onClose}: {onClose: () => void}) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [showCa, setShowCa] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const refresh = async () => { try { const r = await client().status(); if (r.ok) setStatus(r.data); else setError(r.error); } catch { setError('Não foi possível consultar o acesso remoto.'); } };
  const generate = async () => { setError(''); try { const r = await client().pairStart(); if (r.ok) setStatus(r.data); else setError(r.error); } catch { setError('Não foi possível gerar o código.'); } };
  useEffect(() => {
    if (!started.current) { started.current = true; void generate(); }
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 1000);
    const off = client().onChanged(() => void refresh());
    return () => { clearInterval(timer); off(); void client().pairCancel(); }; // fechar o modal encerra o pareamento
  }, []);
  const hasRequest = status?.request != null, paired = status?.paired ?? null;
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('button')?.focus(); }, [hasRequest, paired]);
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); if (status?.request) void client().decide(false); else onClose(); return; }
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, summary')]; if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const url = status?.urls[0], pairing = status?.pairing ?? null, left = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const request = status?.request;
  return <main><div className="panel rm-modal" role="dialog" aria-modal="true" aria-labelledby="rm-title" ref={dialog} onKeyDown={onKey}>
    {request ? <>
      <h1 id="rm-title">Permitir este aparelho?</h1>
      <p className="rm-ask"><strong>{request.name}</strong><br/><span>Endereço da rede: {request.ip}</span></p>
      <p>Só aceite se foi você quem acabou de digitar o código no celular. Quem for aceito poderá <strong>ver</strong> suas contas.</p>
      <div className="actions"><button autoFocus onClick={() => void client().decide(false)}>Recusar</button><button className="primary" onClick={() => void client().decide(true)}>Permitir</button></div>
    </> : status?.paired ? <>
      <h1 id="rm-title">Aparelho pareado</h1>
      <p role="status" className="ok">“{status.paired}” agora tem acesso. Você pode revogar em Gerenciar → Acesso remoto.</p>
      <div className="actions"><button className="primary" onClick={onClose}>Concluir</button></div>
    </> : <>
      <h1 id="rm-title">Parear novo aparelho</h1>
      {!status ? <p role="status">Preparando…</p> : !status.running ? <p role="alert">{error || 'O acesso remoto não está ligado.'}</p> : <>
        <ol className="rm-steps"><li>Com o celular no mesmo Wi-Fi, abra o endereço abaixo (ou leia o QR).</li><li>Digite o código e toque em Parear.</li><li>Aceite o pedido aqui no PC.</li></ol>
        <div className="rm-url">{url && <Qr text={url} label={`QR do endereço ${url}`}/>}<div><h2>Endereço</h2><p><code>{url}</code></p>
          <h2>Código</h2>{pairing && left > 0 ? <><p className="rm-code" aria-label={`Código ${pairing.code.replace('-', ' ')}`}>{pairing.code}</p><p className="note" role="timer" aria-live="off">Vale por mais {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {pairing.attemptsLeft} tentativas</p></> : <p className="rm-expired" role="status">Código expirado ou usado.</p>}</div></div>
        <div className="actions"><button className="primary" onClick={() => void generate()}>Gerar outro código</button><button onClick={() => setShowCa(open => !open)} aria-expanded={showCa}>{showCa ? 'Ocultar certificado' : 'Instalar certificado no celular'}</button><button onClick={onClose}>Fechar</button></div>
        {(showCa || status.firstPairing) && pairing && <div className="rm-ca"><h2>Instalar certificado no celular (só na primeira vez)</h2>
          <p>Sem isso o celular mostra um aviso de segurança e não instala o app nem recebe notificações. Só o certificado <strong>público</strong> é baixado; a chave nunca sai do PC.</p>
          <div className="rm-url"><figure><Qr text={pairing.caUrl} size={128} label="QR do certificado para Android"/><figcaption>Android<br/><small>Baixe e instale em Configurações → Segurança → Instalar certificado CA</small></figcaption></figure>
            <figure><Qr text={pairing.iosUrl} size={128} label="QR do perfil para iPhone"/><figcaption>iPhone<br/><small>Instale o perfil e ative em Ajustes → Geral → Sobre → Confiança de certificados</small></figcaption></figure></div>
          <p className="note">Os links só funcionam enquanto este código estiver válido. O celular pode avisar que o site não é confiável nesta etapa; é esperado.</p></div>}
        {error && <p role="alert">{error}</p>}
      </>}
      {status && !status.running && <div className="actions"><button onClick={onClose}>Voltar</button></div>}
    </>}
  </div></main>;
}
