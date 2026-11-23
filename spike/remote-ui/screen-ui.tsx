// Conta → Jogo: tela ao vivo (JPEG por WebSocket `ph.v1`), zoom/pan com pinça, "Controlar" com PIN (10 min), toque = clique, arrastar = arrastar,
// dois dedos = rolar/zoom, teclado para chat e Esc. Pausa sozinha com o app em segundo plano. Nada de clique direito (menu de contexto) nem atalhos.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { SCREEN_PROTOCOL, decodeFrame, type ClientMsg, type ControlEndReason, type InputEvent as PhInput, type ScreenHello, type ScreenState, type ServerMsg } from '../contracts/screen';
import { DENIED_TEXT, DOUBLE_MS, DOUBLE_SLOP, END_TEXT, FIT, MOVE_HZ, STATE_LABEL, TAP_MS, TAP_SLOP, countdown, inputFromBefore, keyTap, pan, pinch, toImage, toggleZoom, twoFingerKind, wheelDelta, type View } from './screen-helpers';
import './screen.css';

type Phase = 'connecting' | 'open' | 'closed';
interface Stats { fps: number; kbps: number; rtt: number | null }
interface Ctl { token: string; until: number }
const wsUrl = (id: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/screen/${encodeURIComponent(id)}`;
const dist = (a: {x: number; y: number}, b: {x: number; y: number}) => Math.hypot(a.x - b.x, a.y - b.y);
const nf = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1});

/** Teclado numérico de PIN (6 dígitos, envia sozinho no sexto). */
export function PinPad({onSubmit, onCancel, error, busy}: {onSubmit: (pin: string) => void; onCancel: () => void; error: string; busy: boolean}) {
  const [digits, setDigits] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpa os pontos quando o PC recusa o PIN
    if (error) setDigits('');
  }, [error]);
  const press = (d: string) => { if (busy) return; const next = (digits + d).slice(0, 6); setDigits(next); if (next.length === 6) onSubmit(next); };
  return <div className="sv-pin" role="dialog" aria-modal="true" aria-label="PIN para controlar">
    <h2>PIN para controlar</h2>
    <div className="sv-dots" role="img" aria-label={`${digits.length} de 6 dígitos`}>{Array.from({length: 6}, (_, i) => <i key={i} data-on={i < digits.length || undefined}/>)}</div>
    <p className="msg" role="alert">{error}</p>
    <div className="sv-keys">{['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} disabled={busy} onClick={() => press(d)}>{d}</button>)}
      <button disabled={busy} aria-label="Apagar" onClick={() => setDigits(digits.slice(0, -1))}>⌫</button><button disabled={busy} onClick={() => press('0')}>0</button><button className="secondary" onClick={onCancel}>Cancelar</button></div>
    <p className="hint">O PIN vale só para controlar, por 10 min.</p></div>;
}

export function GameView({id, label}: {id: string; label: string}) {
  const [phase, setPhase] = useState<Phase>('connecting'), [state, setState] = useState<ScreenState>('starting'), [hello, setHello] = useState<ScreenHello | null>(null), [stats, setStats] = useState<Stats | null>(null);
  const [ctl, setCtl] = useState<Ctl | null>(null), [note, setNote] = useState(''), [pad, setPad] = useState(false), [padError, setPadError] = useState(''), [padBusy, setPadBusy] = useState(false), [kb, setKb] = useState(false);
  const [view, setViewState] = useState<View>(FIT), [now, setNow] = useState(() => Date.now()), [userPaused, setUserPaused] = useState(false), [nonce, setNonce] = useState(0), [fps, setFps] = useState(0), [full, setFull] = useState(false), [ratio, setRatio] = useState(16 / 9);
  const ws = useRef<WebSocket | null>(null), canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null), kbInput = useRef<HTMLInputElement>(null);
  const ttl = useRef(0), frame = useRef({w: 0, h: 0}), viewRef = useRef<View>(FIT), ctlRef = useRef<Ctl | null>(null), autoPaused = useRef(false), shown = useRef(0), closing = useRef(false), bye = useRef('');
  const gesture = useRef({pts: new Map<number, {x: number; y: number}>(), one: null as null | {id: number; sx: number; sy: number; lx: number; ly: number; t: number; moved: boolean; drag: boolean}, two: null as null | {d0: number; c0: {x: number; y: number}; kind: 'pinch' | 'scroll' | null; last: {cx: number; cy: number; d: number}},
    lastTap: null as null | {x: number; y: number; t: number}, lastMove: 0, wheel: {dx: 0, dy: 0, at: 0}, ignore: false});
  const setView = useCallback((v: View) => { viewRef.current = v; setViewState(v); }, []);
  const send = useCallback((m: ClientMsg) => { const s = ws.current; if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m)); }, []);
  const sendIn = useCallback((e: PhInput) => { const c = ctlRef.current; if (c) send({t: 'in', token: c.token, e}); }, [send]);
  const setControl = useCallback((c: Ctl | null) => { ctlRef.current = c; setCtl(c); }, []);

  useEffect(() => {
    closing.current = false; bye.current = '';
    let socket: WebSocket; try { socket = new WebSocket(wsUrl(id), [SCREEN_PROTOCOL]); } catch { queueMicrotask(() => { setPhase('closed'); setNote('Não foi possível abrir a tela.'); }); return; }
    socket.binaryType = 'arraybuffer'; ws.current = socket;
    let opened = false, last = 0;
    socket.onopen = () => { opened = true; setPhase('open'); setNote(''); };
    socket.onmessage = event => {
      if (typeof event.data !== 'string') {
        const f = decodeFrame(event.data as ArrayBuffer); if (!f) return;
        if (f.header.seq <= last) return; last = f.header.seq;
        socket.send(JSON.stringify({t: 'ack', seq: f.header.seq} satisfies ClientMsg)); // confirma o recebimento (sem ack em 10 s o PC pausa)
        const hdr = f.header, bytes = new Uint8Array(f.jpeg); // cópia: o buffer original pode ser reaproveitado
        void createImageBitmap(new Blob([bytes], {type: 'image/jpeg'})).then(bmp => {
          const c = canvas.current, g = c?.getContext('2d'); if (!c || !g || closing.current) { bmp.close(); return; }
          if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
          g.drawImage(bmp, 0, 0); bmp.close(); if (frame.current.w !== hdr.w || frame.current.h !== hdr.h) setRatio(hdr.w / hdr.h); frame.current = {w: hdr.w, h: hdr.h}; shown.current++;
        }).catch(() => undefined);
        return;
      }
      let m: ServerMsg; try { m = JSON.parse(event.data) as ServerMsg; } catch { return; }
      if (m.t === 'hello') { setHello(m); ttl.current = m.ttlMs; }
      else if (m.t === 'status') { setState(m.state); if (m.state === 'protected' || m.state === 'password') { const c = canvas.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); frame.current = {w: 0, h: 0}; } }
      else if (m.t === 'stats') setStats({fps: m.fps, kbps: m.kbps, rtt: m.rtt});
      else if (m.t === 'control') {
        if (m.on) { setControl({token: m.token, until: Date.now() + (ttl.current || 600_000)}); setPad(false); setPadBusy(false); setPadError(''); setNote(''); }
        else { setControl(null); setKb(false); setNote(END_TEXT[m.reason satisfies ControlEndReason] ?? 'Controle encerrado.'); }
      } else if (m.t === 'denied') {
        setPadBusy(false); const left = m.attemptsLeft !== undefined ? ` Restam ${m.attemptsLeft}.` : '', wait = m.retryAfterMs ? ` Tente em ${Math.ceil(m.retryAfterMs / 60_000)} min.` : '';
        const text = (DENIED_TEXT[m.code] ?? 'Não foi possível controlar.') + left + wait; if (m.code === 'pin' || m.code === 'bloqueado') setPadError(text); else { setPad(false); setNote(text); }
      } else if (m.t === 'bye') bye.current = m.reason;
    };
    socket.onclose = () => { setPhase('closed'); setControl(null); setKb(false); if (!closing.current) setNote(bye.current ? `Tela encerrada: ${bye.current}.` : opened ? 'Conexão perdida.' : 'Não foi possível abrir a tela (conta em uso por outro aparelho, suspensa ou limite de espectadores).'); };
    const keep = window.setInterval(() => { setFps(shown.current); shown.current = 0; }, 1000);
    const dim = window.setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { if (document.hidden) { if (!autoPaused.current) { autoPaused.current = true; send({t: 'pause', why: 'oculto'}); } } else if (autoPaused.current) { autoPaused.current = false; send({t: 'resume'}); } };
    const onHide = () => { closing.current = true; socket.close(1000); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('pagehide', onHide);
    if (document.hidden) onVis();
    return () => { closing.current = true; window.clearInterval(keep); window.clearInterval(dim); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); socket.onmessage = null; socket.onclose = null; try { socket.close(1000); } catch { /* já fechado */ } ws.current = null; };
  }, [id, nonce, send, setControl]);

  // --- teclado do celular → eventos de texto/Backspace/Enter ---
  useEffect(() => {
    const el = kbInput.current; if (!kb || !el) return;
    el.focus();
    const before = (e: InputEvent) => { if (e.inputType === 'insertCompositionText') return; e.preventDefault(); for (const ev of inputFromBefore(e.inputType, e.data)) sendIn(ev); };
    const done = (e: CompositionEvent) => { for (const ev of inputFromBefore('insertText', e.data)) sendIn(ev); el.value = ''; };
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); for (const ev of keyTap('Enter')) sendIn(ev); } else if (e.key === 'Backspace') { e.preventDefault(); for (const ev of keyTap('Backspace')) sendIn(ev); } };
    el.addEventListener('beforeinput', before as EventListener); el.addEventListener('compositionend', done); el.addEventListener('keydown', key);
    return () => { el.removeEventListener('beforeinput', before as EventListener); el.removeEventListener('compositionend', done); el.removeEventListener('keydown', key); };
  }, [kb, sendIn]);

  // --- gestos ---
  const rectOf = () => stage.current?.getBoundingClientRect() ?? new DOMRect();
  const imagePoint = (cx: number, cy: number) => { const c = canvas.current; return c ? toImage(cx, cy, c.getBoundingClientRect(), frame.current.w ? frame.current : {w: c.width, h: c.height}) : null; };
  const down = (e: RPointerEvent) => {
    const g = gesture.current; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); g.pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (g.pts.size === 1) { g.ignore = false; g.one = {id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false, drag: false}; }
    else if (g.pts.size === 2) {
      if (g.one?.drag) { const p = imagePoint(g.one.lx, g.one.ly); if (p) sendIn({k: 'mu', ...p}); }
      g.one = null; const [a, b] = [...g.pts.values()] as [{x: number; y: number}, {x: number; y: number}], d = dist(a, b), r = rectOf(), c = {x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top};
      g.two = {d0: d, c0: c, kind: null, last: {cx: c.x, cy: c.y, d}};
    } else g.ignore = true;
  };
  const move = (e: RPointerEvent) => {
    const g = gesture.current; if (!g.pts.has(e.pointerId) || g.ignore) return; g.pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const r = rectOf(), controlling = ctlRef.current !== null;
    if (g.pts.size === 1 && g.one) {
      const o = g.one; if (!o.moved && dist({x: e.clientX, y: e.clientY}, {x: o.sx, y: o.sy}) > TAP_SLOP) o.moved = true;
      if (!o.moved) return;
      if (controlling) {
        if (!o.drag) { o.drag = true; const p = imagePoint(o.sx, o.sy); if (p) sendIn({k: 'md', ...p}); }
        const t = performance.now(); if (t - g.lastMove >= 1000 / MOVE_HZ) { g.lastMove = t; const p = imagePoint(e.clientX, e.clientY); if (p) sendIn({k: 'mm', ...p, down: true}); }
      } else setView(pan(viewRef.current, e.clientX - o.lx, e.clientY - o.ly, r.width, r.height));
      o.lx = e.clientX; o.ly = e.clientY;
    } else if (g.pts.size === 2 && g.two) {
      const [a, b] = [...g.pts.values()] as [{x: number; y: number}, {x: number; y: number}], d = dist(a, b), cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top, w = g.two;
      w.kind ??= twoFingerKind(w.d0, d, Math.hypot(cx - w.c0.x, cy - w.c0.y));
      if (w.kind === 'pinch' || (w.kind === 'scroll' && !controlling)) setView(w.kind === 'pinch' ? pinch(viewRef.current, w.last, {cx, cy, d}, r.width, r.height) : pan(viewRef.current, cx - w.last.cx, cy - w.last.cy, r.width, r.height));
      else if (w.kind === 'scroll') {
        const dlt = wheelDelta(cx - w.last.cx, cy - w.last.cy); g.wheel.dx += dlt.dx; g.wheel.dy += dlt.dy; const t = performance.now();
        if (t - g.wheel.at >= 1000 / MOVE_HZ && (g.wheel.dx || g.wheel.dy)) { const p = imagePoint(a.x / 2 + b.x / 2, a.y / 2 + b.y / 2); if (p) sendIn({k: 'wh', ...p, dx: g.wheel.dx, dy: g.wheel.dy}); g.wheel = {dx: 0, dy: 0, at: t}; }
      }
      w.last = {cx, cy, d};
    }
  };
  const up = (e: RPointerEvent) => {
    const g = gesture.current; const had = g.pts.delete(e.pointerId); if (!had) return;
    if (g.pts.size === 0) {
      const o = g.one; g.one = null; g.two = null; g.wheel = {dx: 0, dy: 0, at: 0};
      if (g.ignore || !o || e.type === 'pointercancel') { g.ignore = false; if (o?.drag) { const p = imagePoint(o.lx, o.ly); if (p) sendIn({k: 'mu', ...p}); } return; }
      const controlling = ctlRef.current !== null, dt = performance.now() - o.t;
      if (o.drag) { const p = imagePoint(e.clientX, e.clientY) ?? imagePoint(o.lx, o.ly); if (p) sendIn({k: 'mu', ...p}); return; }
      if (o.moved || dt > TAP_MS) return; // toque longo: ignorado (o botão direito abriria o menu de contexto, e não existe)
      const t = performance.now(), prev = g.lastTap, twice = prev && t - prev.t < DOUBLE_MS && dist({x: e.clientX, y: e.clientY}, prev) < DOUBLE_SLOP;
      g.lastTap = twice ? null : {x: e.clientX, y: e.clientY, t};
      if (controlling) { const p = imagePoint(o.sx, o.sy); if (p) { const n = twice ? 2 : 1; sendIn({k: 'md', ...p, n}); sendIn({k: 'mu', ...p, n}); if (navigator.vibrate) navigator.vibrate(8); } }
      else if (twice) { const r = rectOf(); setView(toggleZoom(viewRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height)); }
    } else { g.two = null; g.one = null; g.ignore = true; }
  };

  const live = phase === 'open', controlling = ctl !== null;
  const remaining = ctl ? ctl.until - now : 0;
  const togglePause = () => { if (userPaused) { setUserPaused(false); send({t: 'resume'}); } else { setUserPaused(true); send({t: 'pause', why: 'usuario'}); } };
  const blocked = !hello ? 'Conectando…' : !hello.canAct ? DENIED_TEXT['sem-permissao']! : !hello.pinSet ? DENIED_TEXT['sem-pin']! : state !== 'streaming' ? DENIED_TEXT.indisponivel! : '';
  const overlay = !live ? (phase === 'connecting' ? 'Conectando…' : 'Desconectado') : state === 'streaming' ? '' : state === 'paused' ? (userPaused ? 'Pausado' : 'Pausado (sem confirmação ou app em segundo plano)') : STATE_LABEL[state] ?? '';
  const submitPin = (pin: string) => { setPadBusy(true); setPadError(''); send({t: 'control', pin}); };

  return <section className="screen" data-control={controlling || undefined} data-full={full || undefined} style={{'--ratio': ratio} as React.CSSProperties} aria-label={`Jogo de ${label}`}>
    <div className="sv-head"><span className="sv-chip" data-state={live ? state : 'closed'} role="status">{controlling ? `Controlando · ${countdown(remaining)}` : live ? STATE_LABEL[state] ?? '' : phase === 'connecting' ? 'Conectando…' : 'Desconectado'}</span>
      <small className="muted" aria-label="Qualidade da conexão">{live && stats ? `${nf.format(fps || stats.fps)} qps · ${stats.rtt === null ? '—' : `${stats.rtt} ms`} · ${stats.kbps} kbps` : ''}</small>
      <button className="sv-full" aria-pressed={full} onClick={() => setFull(!full)}>{full ? 'Sair' : 'Tela cheia'}</button></div>
    <div className="sv-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={e => e.preventDefault()} data-live={state === 'streaming' || undefined}>
      <canvas ref={canvas} width={16} height={9} style={{transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`}} aria-label={`Tela do jogo de ${label}`}/>
      {overlay && <div className="sv-over" role="status"><PixelLock/><strong>{overlay}</strong>{state === 'protected' && live && <small>Esta página não é o jogo (login ou outro site). Nada é transmitido.</small>}{state === 'password' && live && <small>Um campo de senha está com foco no PC.</small>}{state === 'hidden' && live && <small>O PC não conseguiu capturar agora. Abra a conta no PC se persistir.</small>}</div>}
      {controlling && <div className="sv-badge" aria-hidden="true">CONTROLANDO</div>}
    </div>
    {note && <p className="msg" role="alert">{note}</p>}
    {kb && controlling && <input ref={kbInput} className="sv-kb" inputMode="text" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" placeholder="Digite aqui (vai para o jogo)" aria-label="Digitar no jogo"/>}
    <div className="sv-bar" role="group" aria-label="Controles da tela">
      {!controlling ? <>
        <button onClick={togglePause} disabled={!live}>{userPaused ? 'Retomar' : 'Pausar'}</button>
        <button onClick={() => setView(FIT)} disabled={view.scale === 1}>Ajustar</button>
        {live ? <button className="primary" disabled={blocked !== '' || userPaused} onClick={() => { setNote(''); setPadError(''); setPad(true); }}>Controlar</button> : <button className="primary" onClick={() => { setPhase('connecting'); setNote(''); setNonce(n => n + 1); }}>Reconectar</button>}
      </> : <>
        <button onClick={() => { for (const ev of keyTap('Escape')) sendIn(ev); }}>Esc</button>
        <button aria-pressed={kb} onClick={() => setKb(!kb)}>Teclado</button>
        <button onClick={() => setView(FIT)} disabled={view.scale === 1}>Ajustar</button>
        <button className="danger" onClick={() => send({t: 'end-control'})}>Voltar ao jogo</button>
      </>}
    </div>
    {!controlling && live && blocked && state === 'streaming' && <p className="hint">{blocked}</p>}
    {controlling && <p className="hint">Toque = clique · arraste = arrastar · dois dedos: rolar ou zoom. Voltar ao jogo encerra o controle.</p>}
    {pad && <PinPad onSubmit={submitPin} onCancel={() => { setPad(false); setPadError(''); }} error={padError} busy={padBusy}/>}
  </section>;
}
function PixelLock() { return <svg className="sv-lock" viewBox="0 0 12 12" width="36" height="36" shapeRendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 1h4v1h1v3h1v6H2V5h1V2h1zm1 1v3h2V2z"/></svg>; }
