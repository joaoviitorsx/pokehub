// Gerenciar → Acesso remoto e o modal "Parear novo aparelho" (tema madeira). Só fala com o main pelo IPC `window.pokehub.remote`.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { qrMatrix, qrPath } from '../domain/qr';
import type { RemoteAlert, RemoteAuditEntry, RemoteDevice, RemotePurchase, RemoteRequest, RemoteSpend, RemoteStatus } from '../contracts/remote';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
interface RemoteClient {
  status(): Promise<Result<RemoteStatus>>; enable(value: boolean): Promise<Result<RemoteStatus>>; pairStart(): Promise<Result<RemoteStatus>>; pairCancel(): Promise<Result<RemoteStatus>>;
  decide(allow: boolean): Promise<Result<RemoteStatus>>; setPin(pin: string): Promise<Result<RemoteStatus>>; clearPin(): Promise<Result<RemoteStatus>>;
  devices(): Promise<Result<RemoteDevice[]>>; revoke(id: string): Promise<Result<RemoteDevice[]>>; audit(): Promise<Result<RemoteAuditEntry[]>>; onChanged(callback: () => void): () => void;
  allowNetwork(): Promise<Result<RemoteStatus>>; revealCode(): Promise<Result<RemoteStatus>>; setCanAct(id: string, value: boolean): Promise<Result<RemoteDevice[]>>;
  reenableActions(): Promise<Result<RemoteStatus>>; dismissNotice(): Promise<Result<RemoteStatus>>;
  pushTest(id: string): Promise<Result<{sent: number}>>; alerts(): Promise<Result<RemoteAlert[]>>;
  purchases(): Promise<Result<PurchasesInfo>>; setCap(value: number): Promise<Result<PurchasesInfo>>;
}
interface PurchasesInfo { purchases: RemotePurchase[]; spend: RemoteSpend[]; capGold: number }
const client = () => (window.pokehub as unknown as {remote: RemoteClient}).remote;
const ALERT_ICON: Record<string, string> = {shiny: '✨', p5: 'P5', recorde: 'Recorde', nota: 'Nota', conta_caiu: 'Conta caiu', conta_voltou: 'Conta voltou'};
const AUDIT_TEXT: Record<string, string> = {push_assinado: 'Notificações ativadas no aparelho', push_teste: 'Teste de notificação', acesso_remoto_ligado: 'Acesso remoto ligado', acesso_remoto_desligado: 'Acesso remoto desligado', pareamento_iniciado: 'Pareamento iniciado', pareamento_pedido: 'Pedido de pareamento', pareamento_aceito: 'Aparelho aceito', pareamento_negado: 'Aparelho recusado', pareamento_cancelado: 'Pedido cancelado', pareamento_abandonado: 'Celular desistiu do pedido', pareamento_contestado: 'Código usado por mais de um aparelho', pareamento_codigo_errado: 'Código errado', aparelho_revogado: 'Aparelho revogado', aparelho_revogado_pin: 'Aparelho revogado (PIN)', expirado: 'Acesso expirado', saiu: 'Aparelho saiu', pin_definido: 'PIN definido', pin_removido: 'PIN removido', pin_bloqueado: 'PIN bloqueado', acoes_desligadas: 'Ações desligadas (erros de PIN)', acoes_religadas: 'Ações religadas', rede_nova: 'Rede nova detectada', rede_perdida: 'Rede indisponível', rede_fixada: 'Rede doméstica fixada', rede_liberada: 'Rede nova liberada', ca_refeita: 'Certificado refeito', pode_agir_ligado: '“Pode agir” permitido', pode_agir_desligado: '“Pode agir” bloqueado', compra_confirmada: 'Compra feita pelo celular', compra_abortada: 'Compra do celular não concluída', compra_preco_mudou: 'Compra abortada: preço mudou', compra_recusada_teto: 'Compra recusada: teto diário', compra_hash_diferente: 'Confirmação com plano diferente (recusada)', acao_recarregar: 'Conta recarregada pelo celular', acao_suspender: 'Conta suspensa pelo celular', acao_retomar: 'Conta retomada pelo celular', acao_falhou: 'Ação do celular falhou', modo_leve: 'Modo leve mudado pelo celular', elevacao_pin: 'PIN lembrado por 10 min', teto_diario: 'Teto diário de compras alterado'};
const gold = (n: number) => n.toLocaleString('pt-BR');
const when = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}); };
export const ALLOW_DELAY_MS = 1500;
/** "Permitir" só habilita 1,5 s depois que o pedido aparece e depois de qualquer troca de foco da janela (evita o clique por reflexo). */
export const allowReady = (now: number, since: number, focusAt: number, delay = ALLOW_DELAY_MS): boolean => now - Math.max(since, focusAt) >= delay;

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
  const [alerts, setAlerts] = useState<RemoteAlert[]>([]);
  const [shop, setShop] = useState<PurchasesInfo | null>(null), [cap, setCap] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const [s, d, a, al, pu] = await Promise.all([client().status(), client().devices(), client().audit(), client().alerts(), client().purchases()]);
      if (s.ok) setStatus(s.data); else setMessage(s.error);
      if (d.ok) setDevices(d.data); if (a.ok) setAudit(a.data); if (al.ok) setAlerts(al.data); if (pu.ok) setShop(pu.data);
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
  const capValue = /^d{1,10}$/.test(cap.replace(/./g, '')) ? Number(cap.replace(/./g, '')) : null;
  if (!status) return <p role="status">{message || 'Carregando…'}</p>;
  const url = status.urls[0];
  return <section aria-label="Acesso remoto">
    <p>Veja suas contas pelo celular, na mesma rede Wi-Fi. Fica <strong>desligado</strong> até você ativar, só escuta na sua rede doméstica (categoria Privada, adaptador físico; nada na internet) e cada aparelho precisa ser aceito aqui no PC, com um número de conferência.</p>
    <label className="switch"><span>Acesso remoto</span><input type="checkbox" role="switch" checked={status.enabled} disabled={busy} onChange={event => void run(() => client().enable(event.target.checked))}/></label>
    {status.error && <p role="alert">{status.error}</p>}
    {status.enabled && status.network.state === 'rede_nova' && <div className="rm-warn" role="alert"><strong>Rede nova detectada: liberar aqui?</strong>
      <p>O acesso remoto parou porque você não está mais na rede fixada{status.network.label ? ` (“${status.network.label}”)` : ''}. Só libere se esta for a sua rede de casa; o certificado do celular será refeito.</p>
      <div className="actions"><button className="primary" disabled={busy} onClick={() => void run(() => client().allowNetwork())}>Liberar esta rede…</button></div></div>}
    {status.enabled && status.network.state === 'sem_rede' && !status.running && <p className="note" role="status">Sem rede privada no momento. Volta sozinho quando a rede de casa reaparecer.</p>}
    {status.notice && <div className="rm-warn" role="alert"><p>{status.notice}</p><div className="actions"><button disabled={busy} onClick={() => void run(() => client().dismissNotice())}>Entendi</button></div></div>}
    {status.actionsDisabled && <div className="rm-warn" role="alert"><p>As ações pelo celular estão desligadas (muitos erros de PIN). Religue só se foi um engano seu.</p><div className="actions"><button disabled={busy} onClick={() => void run(() => client().reenableActions())}>Religar ações</button></div></div>}
    {!status.aclOk && <p role="alert">Não foi possível restringir a pasta das chaves ao seu usuário. As chaves continuam no seu perfil, mas confira as permissões da pasta do PokéHub.</p>}
    {status.caNotice && <p role="alert">{status.caNotice}</p>}
    {status.enabled && status.running && url && <div className="rm-url">
      <Qr text={url} label={`QR do endereço ${url}`}/>
      <div><h2>Endereço no celular</h2>{status.urls.map(item => <p key={item}><code>{item}</code></p>)}
        {status.network.label && <p className="note">Rede fixada: {status.network.label}</p>}
        <p className="note">Se o Windows perguntar sobre o firewall, permita só em redes <strong>Privadas</strong>. Se o celular não abrir, confira se o Wi-Fi do PC está marcado como rede Privada.</p></div>
    </div>}
    <div className="actions"><button className="primary" disabled={busy || !status.enabled || !status.running} onClick={onPair}>Parear novo aparelho</button></div>
    <h2>PIN de ações</h2>
    <p className="note">O PIN de 6 dígitos libera, no celular, as ações que mudam alguma coisa (compras na Loja, recarregar, suspender, retomar e Modo leve). Depois de digitar, o celular pode “lembrar” o PIN por 10 min (a memória fica aqui, no PC). {status.pinSet ? 'PIN definido. 5 erros bloqueiam o aparelho (15 min, depois 1 h, depois 24 h; o ciclo seguinte revoga o aparelho) e 10 erros no dia desligam as ações até você religar aqui.' : 'Nenhum PIN definido ainda.'}</p>
    <form className="rm-pin" onSubmit={submitPin}><label>{status.pinSet ? 'Novo PIN' : 'PIN'} <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d{6}" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))}/></label>
      <button disabled={busy || pin.length !== 6}>{status.pinSet ? 'Trocar PIN' : 'Definir PIN'}</button>{status.pinSet && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remover o PIN? As ações pelo celular ficam bloqueadas até definir outro.')) void run(() => client().clearPin()); }}>Remover</button>}</form>
    <h2>Aparelhos pareados</h2>
    {devices.length === 0 ? <p className="ext-state" data-on="false">Nenhum aparelho pareado.</p> : <ul className="acc-list">{devices.map(device => <li key={device.id} className="acc"><div className="acc-main"><strong>{device.name}</strong></div><small>Pareado em {when(device.createdAt)} · último acesso {when(device.lastSeen)}</small>
      <small>Notificações: {(device.push ?? 0) > 0 ? `ativas (${device.push})` : 'desativadas'}</small>
      {(device.push ?? 0) > 0 && <div className="actions"><button disabled={busy} onClick={() => void run(async () => { const r = await client().pushTest(device.id); if (r.ok) setMessage(r.data.sent > 0 ? 'Teste enviado. Veja se chegou no celular.' : 'O serviço de notificações não aceitou o teste agora.'); return r; })}>Enviar teste</button></div>}
      <label className="switch"><span>Pode agir: {device.canAct ? 'sim' : 'não'} (compras, recarregar, suspender e Modo leve, sempre com PIN)</span><input type="checkbox" role="switch" checked={device.canAct} disabled={busy} onChange={event => void run(() => client().setCanAct(device.id, event.target.checked))}/></label>
      <div className="actions"><button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Revogar “${device.name}”? Ele perde o acesso na hora.`)) void run(() => client().revoke(device.id)); }}>Revogar</button></div></li>)}</ul>}
    <h2>Compras pelo celular</h2>
    <p className="note">Só no Market (ouro, itens do catálogo da Loja). Nunca no Mercado da Comunidade. Cada compra pede a confirmação do servidor, relê o preço no jogo e aparece aqui, no registro e numa notificação. O teto abaixo só pode ser mudado neste PC.</p>
    <form className="rm-pin" onSubmit={event => { event.preventDefault(); if (capValue !== null) void run(async () => { const r = await client().setCap(capValue); if (r.ok) { setCap(''); setShop(r.data); } return r; }); }}>
      <label>Teto diário por conta (ouro) <input inputMode="numeric" autoComplete="off" placeholder={gold(shop?.capGold ?? status.dailyCapGold)} value={cap} onChange={event => setCap(event.target.value.replace(/[^d.]/g, ''))}/></label>
      <button disabled={busy || capValue === null || capValue === (shop?.capGold ?? status.dailyCapGold)}>Salvar teto</button></form>
    <p className="note">Teto atual: <strong>{gold(shop?.capGold ?? status.dailyCapGold)}</strong> de ouro por conta, por dia (horário do PC). Aumentar pede confirmação do sistema e encerra os PINs lembrados.</p>
    {shop && shop.spend.length > 0 && <ul className="acc-list">{shop.spend.map(s => <li key={s.profileId} className="acc"><div className="acc-main"><strong>{s.label}</strong></div><small>Hoje pelo celular: {gold(s.gold)} de {gold(s.capGold)} de ouro</small></li>)}</ul>}
    <details className="rm-audit"><summary>Compras do celular (últimas 50)</summary>
      {!shop || shop.purchases.length === 0 ? <p className="note">Nenhuma compra pelo celular ainda.</p> : <ul>{shop.purchases.map(p => <li key={p.id}><time>{when(p.at)}</time> · <strong>{p.label}</strong>: {p.qty}× {p.item} a {gold(p.unitPrice)} = {gold(p.total)} · {p.result === 'ok' ? 'ok' : p.result} · {p.deviceName ?? 'aparelho removido'}</li>)}</ul>}</details>
    <details className="rm-audit"><summary>Alertas (últimos 20)</summary>
      {alerts.length === 0 ? <p className="note">Nenhum alerta ainda.</p> : <ul>{alerts.map(alert => <li key={alert.id}><time>{when(alert.at)}</time> · <strong>{ALERT_ICON[alert.kind] ?? alert.kind}</strong> {alert.label}: {alert.text}</li>)}</ul>}</details>
    <details className="rm-audit"><summary>Registro de auditoria (últimos 100)</summary>
      {audit.length === 0 ? <p className="note">Sem registros.</p> : <ul>{audit.map(entry => <li key={entry.id}><time>{when(entry.at)}</time> · {AUDIT_TEXT[entry.action] ?? entry.action}{entry.detail ? ` — ${entry.detail}` : ''}</li>)}</ul>}</details>
    <p className="note">O código de pareamento vale 2 minutos, só funciona uma vez e o aparelho só entra depois que você confere o número e aceita aqui (e confirma na janela do sistema). O acesso vence após 30 dias sem uso e o token é trocado a cada 24 h. Revogar ou desligar corta o acesso na hora. Isso <strong>reduz o risco</strong>, mas não substitui cuidado: use só na sua rede de casa. Para a instalação do app e as notificações, instale o certificado do PokéHub no celular conferindo a impressão digital (o passo aparece ao parear).</p>
    {message && <p role="alert">{message}</p>}
  </section>;
}

/** Pedido "Permitir este aparelho?": número de conferência, nome lido pelo servidor separado do apelido do celular, aviso de código repetido e botão com atraso. */
export function PairRequest({request, ready, onDecide}: {request: RemoteRequest; ready: boolean; onDecide: (allow: boolean) => void}) {
  return <>
    <h1 id="rm-title">Permitir este aparelho?</h1>
    <p className="rm-sas" role="status">O celular deve estar mostrando <strong>{request.sas}</strong></p>
    <ul className="rm-ask">
      <li>Aparelho (lido pelo PC): <strong>{request.ua}</strong></li>
      <li>Apelido informado pelo celular (não confiável): <strong>{request.nickname || '—'}</strong></li>
      <li>Endereço da rede: <code>{request.ip}</code></li>
    </ul>
    {request.contested && <p className="rm-warn" role="alert"><strong>Atenção:</strong> o mesmo código foi digitado por mais de um aparelho. Recomendado: <strong>Recusar</strong> e gerar um código novo.</p>}
    <p>Só aceite se o número acima é o que aparece no celular e foi você quem acabou de digitar o código. Quem for aceito poderá <strong>ver</strong> suas contas.</p>
    <div className="actions"><button autoFocus onClick={() => onDecide(false)}>Recusar</button><button className="primary" disabled={!ready || request.deciding} onClick={() => onDecide(true)}>{request.deciding ? 'Confirme na janela do sistema…' : ready ? 'Permitir' : 'Aguarde…'}</button></div>
  </>;
}

/** Modal de pareamento. 1º aparelho: certificado primeiro (QR + impressão digital), código só depois da conferência. Depois: código, número de conferência e pedido. */
export function PairModal({onClose}: {onClose: () => void}) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [showCa, setShowCa] = useState(false), [checked, setChecked] = useState(false), [hidden, setHidden] = useState(false);
  const [focusAt, setFocusAt] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const refresh = async () => { try { const r = await client().status(); if (r.ok) setStatus(r.data); else setError(r.error); } catch { setError('Não foi possível consultar o acesso remoto.'); } };
  const generate = async () => { setError(''); setChecked(false); try { const r = await client().pairStart(); if (r.ok) setStatus(r.data); else setError(r.error); } catch { setError('Não foi possível gerar o código.'); } };
  useEffect(() => {
    if (!started.current) { started.current = true; void generate(); }
    const tick = window.setInterval(() => setNow(Date.now()), 250), poll = window.setInterval(() => void refresh(), 1000);
    const mark = () => { setFocusAt(Date.now()); setNow(Date.now()); };
    window.addEventListener('focus', mark); window.addEventListener('blur', mark); document.addEventListener('visibilitychange', mark);
    const off = client().onChanged(() => void refresh());
    return () => { clearInterval(tick); clearInterval(poll); window.removeEventListener('focus', mark); window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', mark); off(); void client().pairCancel(); }; // fechar o modal encerra o pareamento
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
  const pairing = status?.pairing ?? null, left = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const request = status?.request;
  const first = status?.firstPairing === true, caStep = (first || showCa || status?.caNotice != null) && pairing;
  const gated = first && pairing?.codeHidden === true;
  const reveal = (value: boolean) => { setChecked(value); if (value) void client().revealCode().then(r => { if (r.ok) setStatus(r.data); else setError(r.error); }); };
  return <main><div className="panel rm-modal" role="dialog" aria-modal="true" aria-labelledby="rm-title" ref={dialog} onKeyDown={onKey}>
    {request ? <PairRequest request={request} ready={allowReady(now, request.since, focusAt)} onDecide={allow => void client().decide(allow).then(r => { if (!r.ok) setError(r.error); })}/> : status?.paired ? <>
      <h1 id="rm-title">Aparelho pareado</h1>
      <p role="status" className="ok">“{status.paired}” agora tem acesso. Você pode revogar em Gerenciar → Acesso remoto.</p>
      <div className="actions"><button className="primary" onClick={onClose}>Concluir</button></div>
    </> : <>
      <h1 id="rm-title">Parear novo aparelho</h1>
      {!status ? <p role="status">Preparando…</p> : !status.running ? <p role="alert">{error || 'O acesso remoto não está ligado.'}</p> : <>
        {caStep && pairing && <div className="rm-ca"><h2>{first ? '1. Instale o certificado no celular e confira a impressão digital' : 'Reinstalar certificado no celular'}</h2>
          <p>Impressão digital (SHA-256) do certificado do PC:</p>
          <p className="rm-fp" aria-label="Impressão digital do certificado">{pairing.fingerprint}</p>
          <ol className="rm-steps"><li>No celular, leia o QR de <strong>endereço</strong> abaixo. O navegador vai avisar que o certificado não é confiável: é normal nesta etapa, mas <strong>não continue ainda</strong>.</li><li>A página mostra a impressão digital esperada. Compare, bloco a bloco, com a de cima.</li><li>Só se forem iguais: baixe e instale o certificado (QRs abaixo) e confira o SHA-256 nos detalhes dele. Se algo diferir, feche: pode ser outra pessoa na rede.</li></ol>
          <div className="rm-url"><figure><Qr text={pairing.bootstrapUrl} size={128} label="QR do endereço com a impressão digital"/><figcaption>Endereço<br/><small>abre a página de pareamento</small></figcaption></figure>
            <figure><Qr text={pairing.caUrl} size={128} label="QR do certificado para Android"/><figcaption>Android<br/><small>Configurações → Segurança → Instalar certificado CA</small></figcaption></figure>
            <figure><Qr text={pairing.iosUrl} size={128} label="QR do perfil para iPhone"/><figcaption>iPhone<br/><small>Instale o perfil e ative em Ajustes → Geral → Sobre → Confiança de certificados</small></figcaption></figure></div>
          <p className="note">Só o certificado <strong>público</strong> é baixado; a chave nunca sai do PC. Os links só funcionam enquanto este pareamento estiver aberto. A restrição de nomes do certificado <strong>reduz o risco</strong> se a chave vazar, mas não o elimina: instale só se a impressão digital conferir.</p>
          {first && <label className="switch"><span>Conferi a impressão digital no celular</span><input type="checkbox" role="switch" checked={checked && !gated} onChange={event => reveal(event.target.checked)}/></label>}</div>}
        {!gated && <>
          {!caStep && <ol className="rm-steps"><li>Com o celular no mesmo Wi-Fi, abra o endereço abaixo (ou leia o QR).</li><li>Digite o código e toque em Parear.</li><li>Confira o número e aceite o pedido aqui no PC.</li></ol>}
          <div className="rm-url">{!caStep && pairing && <Qr text={pairing.bootstrapUrl} label="QR do endereço com a impressão digital"/>}<div>{!caStep && <><h2>Endereço</h2><p><code>{status.urls[0]}</code></p></>}
            <h2>{first ? '2. Código' : 'Código'}</h2>{pairing && left > 0 ? <>{hidden ? <p className="rm-code" aria-label="Código oculto">••••-••••</p> : <p className="rm-code" aria-label={`Código ${pairing.code.replace('-', ' ')}`}>{pairing.code}</p>}
              <p className="note" role="timer" aria-live="off">Vale por mais {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {pairing.attemptsLeft} tentativas no total{pairing.attemptsByIp.length > 0 && ` · por aparelho: ${pairing.attemptsByIp.map(a => `${a.ip} (${a.wrong}/5)`).join(', ')}`}</p>
              <button onClick={() => setHidden(value => !value)} aria-pressed={hidden}>{hidden ? 'Mostrar código' : 'Ocultar código'}</button></> : <p className="rm-expired" role="status">Código expirado ou usado.</p>}</div></div></>}
        {gated && <p className="note" role="status">O código aparece depois que você marcar “Conferi a impressão digital no celular”.</p>}
        <div className="actions"><button className="primary" onClick={() => void generate()}>Gerar outro código</button>{!first && <button onClick={() => setShowCa(open => !open)} aria-expanded={showCa}>{showCa ? 'Ocultar certificado' : 'Instalar certificado no celular'}</button>}<button onClick={onClose}>Fechar</button></div>
        {error && <p role="alert">{error}</p>}
      </>}
      {status && !status.running && <div className="actions"><button onClick={onClose}>Voltar</button></div>}
    </>}
    {request && error && <p role="alert">{error}</p>}
  </div></main>;
}
