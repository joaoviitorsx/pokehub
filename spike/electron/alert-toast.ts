/*
 * Aviso visual dos alertas do RMT por cima das sessões do jogo: as views do jogo ficam acima da interface do PokéHub, então o aviso
 * é uma janelinha transparente, filha da janela principal, que aparece no canto sem roubar o foco (showInactive, focusable:false)
 * e some sozinha. Conteúdo montado aqui com texto escapado (data: URL, sem preload, sem rede, JavaScript desligado).
 * Clicar em "Ver" foca o PokéHub e abre o Assistente → Mercado (navegação para `pokehub-toast:ver`, cancelada e tratada aqui).
 */
import { BrowserWindow } from 'electron';

export interface ToastItem { conta: string; cor: string; nome: string; detalhe: string; preco: string; moeda: 'orb' | 'gold' | null; shiny: boolean }
const W = 340, ROW = 62, HEAD = 34, PAD = 10, SHOW_MS = 8_000;
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#ba5ad1';

export function toastHtml(items: readonly ToastItem[], extra: number): string {
  const rows = items.map(i => `<div class="row${i.shiny ? ' sh' : ''}" style="--c:${color(i.cor)}">
    <div class="who"><i></i>${esc(i.conta)}</div>
    <div class="top"><b class="nome">${i.shiny ? '✨ ' : ''}${esc(i.nome)}</b><b class="preco${i.moeda === 'orb' ? ' orb' : ''}">${esc(i.preco)}</b></div>
    <div class="det">${esc(i.detalhe)}</div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
  html,body{margin:0;background:transparent;overflow:hidden;font:12px "Segoe UI",system-ui,sans-serif;color:#fff6ef;user-select:none}
  .card{margin:6px;border-radius:10px;padding:0 0 8px;background:linear-gradient(#462b39,#33202b);box-shadow:inset 0 0 0 2px #480e1e,inset 0 0 0 4px #ba5ad1,0 6px 14px #0008;animation:in .28s cubic-bezier(.34,1.56,.64,1) both}
  @keyframes in{from{opacity:0;transform:translateX(30px) scale(.96)}}
  .head{display:flex;align-items:center;gap:8px;height:${HEAD}px;padding:0 10px;border-radius:9px 9px 0 0;background:linear-gradient(#e77ad2,#ba5ad1 55%,#8d49b8);box-shadow:inset 0 -2px 0 #480e1e}
  .bell{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#480e1e66;animation:ring .9s ease-in-out 1}
  @keyframes ring{20%{transform:rotate(18deg)}40%{transform:rotate(-14deg)}60%{transform:rotate(9deg)}80%{transform:rotate(-4deg)}}
  .bell svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .tit{flex:1;font:900 12px Tahoma,Verdana,sans-serif;letter-spacing:.8px;text-transform:uppercase;text-shadow:0 2px 0 #480e1e,1px 0 0 #480e1e,-1px 0 0 #480e1e}
  a{color:#4a3608;text-decoration:none;font:800 10px Tahoma,Verdana,sans-serif;letter-spacing:.5px;text-transform:uppercase;padding:3px 9px;border-radius:6px;background:linear-gradient(#ffe07a,#fccb0f 60%,#e8a800);box-shadow:inset 0 0 0 1.5px #480e1e,0 2px 0 #480e1e}
  .x{color:#fff;background:none;box-shadow:none;font-size:14px;padding:0 4px}
  .row{margin:8px 10px 0;padding:6px 9px 6px 11px;border-radius:7px;background:#231520;box-shadow:inset 3px 0 0 var(--c),inset 0 0 0 1px #480e1e}
  .row.sh{box-shadow:inset 3px 0 0 var(--c),inset 0 0 0 1px #e8a800}
  .who{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#c9a9b4}.who i{width:7px;height:7px;border-radius:50%;background:var(--c);box-shadow:0 0 0 1.5px #480e1e}
  .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.nome{font:800 13px Tahoma,Verdana,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .preco{flex:none;font:800 13px Tahoma,Verdana,sans-serif;color:#fccb0f;text-shadow:0 1px 0 #480e1e}.preco.orb{color:#ffdef0}
  .det{font-size:11px;color:#f5cdb9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mais{margin:6px 12px 0;font-size:11px;color:#c9a9b4}
  </style></head><body><div class="card"><div class="head"><span class="bell"><svg viewBox="0 0 16 16"><path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.5 1.5h-11zM6.5 14h3"/></svg></span><span class="tit">Alerta do RMT</span><a href="pokehub-toast:ver">Ver</a><a class="x" href="pokehub-toast:fechar" aria-label="Fechar">×</a></div>${rows}${extra > 0 ? `<div class="mais">+${extra} outro${extra > 1 ? 's' : ''} anúncio${extra > 1 ? 's' : ''}</div>` : ''}</div></body></html>`;
}

export function createAlertToast(parent: () => BrowserWindow | null, onOpen: () => void, topBar: number) {
  let win: BrowserWindow | null = null, hide: ReturnType<typeof setTimeout> | undefined;
  const ensure = () => {
    if (win && !win.isDestroyed()) return win;
    const owner = parent();
    if (!owner || owner.isDestroyed()) return null;
    win = new BrowserWindow({parent:owner, width:W, height:200, show:false, frame:false, transparent:true, resizable:false, movable:false, minimizable:false, maximizable:false, focusable:false, skipTaskbar:true, hasShadow:false, alwaysOnTop:false,
      webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false, javascript:false, spellcheck:false, devTools:false}});
    win.setIgnoreMouseEvents(false);
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({action:'deny'}));
    contents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (url === 'pokehub-toast:ver') { close(); onOpen(); }
      else if (url === 'pokehub-toast:fechar') close();
    });
    win.on('closed', () => { win = null; });
    return win;
  };
  function close() { clearTimeout(hide); if (win && !win.isDestroyed()) win.hide(); }
  return {
    show(items: ToastItem[]) {
      const owner = parent();
      if (!owner || owner.isDestroyed() || !owner.isVisible() || owner.isMinimized()) return false; // escondido: fica só a notificação do sistema
      const w = ensure();
      if (!w) return false;
      const shown = items.slice(0, 3), height = 12 + HEAD + shown.length * ROW + (items.length > 3 ? 24 : 0) + PAD + 6;
      const b = owner.getContentBounds();
      w.setBounds({x: b.x + b.width - W - 14, y: b.y + topBar + 10, width: W, height});
      void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastHtml(shown, items.length - shown.length))}`).then(() => { if (!w.isDestroyed()) w.showInactive(); }).catch(() => undefined);
      clearTimeout(hide);
      hide = setTimeout(close, SHOW_MS);
      return true;
    },
    close,
    dispose() { clearTimeout(hide); if (win && !win.isDestroyed()) win.destroy(); win = null; },
  };
}
