#!/usr/bin/env node
// Auditoria automática de cliques da interface (desktop + celular) via Chrome DevTools Protocol, sem dependências novas.
// Para cada tela/estado e viewport: todo elemento interativo visível precisa receber o clique no próprio centro
// (document.elementFromPoint), nada com cursor "pointer" pode cobrir mais de 30% da tela, pseudo-elementos absolutos
// não podem vazar do dono, não pode haver estouro horizontal, e com modal aberto só o modal recebe cliques.
//
// Uso: suba os servidores de prévia e rode
//   bun x vite --host 127.0.0.1 --port 5179                                  (desktop: /preview.html)
//   npx vite --config spike/dev/remote-mock.ts --port 5180                   (celular: /remote.html)
//   node scripts/ui-hit-audit.cjs [--only=<trecho do nome>] [--desktop=http://127.0.0.1:5179] [--phone=http://127.0.0.1:5180] [--chrome=<exe>] [--port=9333]
// Imprime um relatório JSON; sai com código 1 se houver problemas.
'use strict';
/* global document, getComputedStyle, innerWidth, innerHeight -- pageAudit() roda dentro do navegador */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const DESKTOP = args.desktop || 'http://127.0.0.1:5179', PHONE = args.phone || 'http://127.0.0.1:5180', PORT = Number(args.port || 9333);
const CHROME = args.chrome || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));

const DESKTOP_VIEWPORTS = [[1920, 1025], [1366, 768], [700, 480]], PHONE_VIEWPORTS = [[390, 844], [360, 800]];
// Passos: {click: 'texto (regex, case-insensitive)' | css, in: seletor-escopo opcional}, {wait: ms}, {js: 'código'}.
const dsk = (name, query, steps = []) => ({ name, url: `${DESKTOP}/preview.html${query}`, viewports: DESKTOP_VIEWPORTS, steps, kind: 'desktop' });
const mobile = (name, hash, steps = []) => ({ name, url: `${PHONE}/remote.html${hash}`, viewports: PHONE_VIEWPORTS, steps, kind: 'phone' });
const R = '?allready=1&accounts=2';
const manage = section => dsk(`gerenciar:${section}`, `?panel=manage&section=${section}`, [{ wait: 1800 }]);
const SCENARIOS = [
  dsk('lista:4-contas', '?accounts=4'), dsk('lista:1-conta', '?accounts=1'), dsk('lista:todas-prontas', '?allready=1'), dsk('lista:vazia', '?state=empty'),
  dsk('lista:nomes-longos', '?long=1&accounts=4'),
  dsk('foco', '?accounts=3', [{ click: '^\\s*Foco' }, { wait: 500 }]),
  dsk('lateral:cacar', '?panel=side&allready=1'), dsk('lateral:mercado', '?panel=market&allready=1'), dsk('lateral:capturas', '?panel=captures&allready=1'), dsk('lateral:capturas-vazia', '?panel=captures&captures=0'),
  dsk('lateral:loja', `?panel=shop${R.replace('?', '&')}`, [{ wait: 3500 }]), dsk('lateral:loja-confirmacao', `?panel=shopconfirm${R.replace('?', '&')}`, [{ wait: 6500 }]),
  dsk('lateral:loja-progresso', `?panel=shoprun${R.replace('?', '&')}`, [{ wait: 14000 }]), dsk('lateral:loja-kit', `?panel=shopkit${R.replace('?', '&')}`, [{ wait: 7000 }]),
  dsk('lateral:larga', '?panel=side&allready=1&sidew=520&rows=20'), dsk('lateral:compacta', '?panel=side&allready=1&compact=1&sidew=280&rows=5'),
  ...['ext', 'upd', 'layout', 'diag', 'remote'].map(manage), dsk('gerenciar:inicio', '?panel=manage&orphans=1', [{ wait: 1200 }]),
  dsk('gerenciar:remover-dialogo', '?panel=manage', [{ wait: 1200 }, { click: '^\\s*Remover' }, { wait: 400 }]),
  ...['pair', 'request', 'ca'].map(m => dsk(`gerenciar:pareamento-${m}`, `?panel=manage&section=remote&remote=${m}`, [{ wait: 3200 }])),
  dsk('formulario:novo', '?panel=form&accounts=2', [{ wait: 1800 }]), dsk('formulario:editar', '?accounts=2', [{ wait: 800 }, { click: 'Editar|Perfil|Configurar' }, { wait: 500 }]),
  mobile('celular:contas', '#contas'), mobile('celular:conta-cacar', '#conta/00000000-0000-4000-8000-000000000001', [{ wait: 800 }]),
  mobile('celular:conta-jogo', '#conta/00000000-0000-4000-8000-000000000001', [{ wait: 600 }, { click: '^Jogo$' }, { wait: 1500 }]),
  mobile('celular:conta-capturas', '#conta/00000000-0000-4000-8000-000000000001', [{ wait: 600 }, { click: '^Capturas$' }, { wait: 800 }]),
  mobile('celular:loja', '#loja', [{ wait: 800 }]),
  mobile('celular:loja-plano', '#loja', [{ wait: 800 }, { click: 'Repor|Kit|Planejar|Ver plano' }, { wait: 2500 }]),
  mobile('celular:mercado', '#mercado', [{ wait: 800 }]), mobile('celular:alertas', '#alertas', [{ wait: 800 }]),
];

// ---------------------------------------------------------------- código que roda na página
function pageAudit() {
  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const CLICKABLE = INTERACTIVE + ', label, [onclick], [role=link], [role=option]';
  const vw = innerWidth, vh = innerHeight;
  const describe = el => { if (!el) return 'null'; let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''; if (c) s += '.' + c; const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28); return t ? `${s} "${t}"` : s; };
  const visible = el => { try { return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }); } catch { return true; } };
  const issues = [], push = (type, el, detail) => issues.push({ type, el: describe(el), ...(detail ? { detail } : {}) });
  const modals = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible);
  const inModal = el => modals.some(m => m.contains(el));
  // o modal vale para a sua região (o <main> que o contém, ou ele mesmo: a confirmação da loja cobre só a lateral; o pareamento cobre o conteúdo e deixa a barra de título/abas usável); só o que fica sob essa região precisa estar bloqueado
  const modalRects = modals.map(m => (m.closest('main') || m).getBoundingClientRect());
  const underModal = (x, y) => modalRects.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  // avisos transitórios (role=status/alert, ex.: toast de captura) podem cobrir de leve o que está atrás e somem sozinhos ou têm botão de fechar
  const transient = n => !!(n && n.closest && n.closest('[role=status], [role=alert]'));
  const rectOf = el => { const r = el.getBoundingClientRect(); return { r, w: r.width, h: r.height }; };

  // 1) todo interativo visível recebe o clique no centro (modal aberto: só o modal; o resto precisa estar bloqueado)
  let tested = 0, blocked = 0;
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el) || el.closest('[inert]')) continue;
    let { r, w, h } = rectOf(el); if (w < 2 || h < 2) continue;
    const cs = getComputedStyle(el); if (cs.pointerEvents === 'none') continue;
    let outside = modals.length > 0 && !inModal(el);
    if (!outside) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); ({ r, w, h } = rectOf(el)); }
    const x = Math.min(Math.max(r.left + w / 2, 0), vw - 1), y = Math.min(Math.max(r.top + h / 2, 0), vh - 1);
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) { if (!outside) push('interativo-fora-da-tela', el, `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(w)}x${Math.round(h)}`); continue; }
    const hit = document.elementFromPoint(x, y);
    const own = hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest('label') && hit.closest('label').contains(el)) || (el.labels && [...el.labels].some(l => l.contains(hit))));
    if (outside && (!underModal(x, y) || transient(el))) continue;
    if (outside) { if (own) push('clicavel-atras-do-modal', el, `recebe clique com modal aberto`); else blocked++; continue; }
    tested++;
    if (!own && !transient(hit)) push('coberto', el, `no centro (${Math.round(x)},${Math.round(y)}) quem recebe é ${describe(hit)}`);
    else if (w < 24 || h < 24) { /* alvo pequeno: só aviso de toque */ if (innerWidth < 500 && (w < 28 || h < 28)) push('alvo-pequeno-toque', el, `${Math.round(w)}x${Math.round(h)}`); }
  }

  // 2) cursor pointer cobrindo > 30% da tela, ou pointer em algo não interativo
  const closestClickable = el => el.closest(CLICKABLE);
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || modals.length) break;
    const cs = getComputedStyle(el); if (cs.cursor !== 'pointer' || cs.display === 'contents') continue;
    const { w, h } = rectOf(el); if (w * h > 0.3 * vw * vh) push('cursor-pointer-cobre-tela', el, `${Math.round(w * h / (vw * vh) * 100)}% da tela`);
  }
  const seen = new Set();
  if (!modals.length) for (let i = 0; i < 32; i++) for (let j = 0; j < 20; j++) {
    const el = document.elementFromPoint((i + 0.5) * vw / 32, (j + 0.5) * vh / 20);
    if (!el || seen.has(el)) continue; seen.add(el);
    if (getComputedStyle(el).cursor === 'pointer' && !closestClickable(el)) push('cursor-pointer-sem-interativo', el);
  }

  // 3) pseudo-elementos absolutos/fixos que vazam do dono (dono estático ou grande demais)
  for (const el of document.querySelectorAll('body, body *')) {
    if (!visible(el)) continue;
    for (const ps of ['::before', '::after']) {
      const p = getComputedStyle(el, ps); if (p.content === 'none' || p.content === 'normal' || (p.position !== 'absolute' && p.position !== 'fixed') || p.pointerEvents === 'none' || p.display === 'none') continue;
      const { w, h } = rectOf(el), pw = parseFloat(p.width), ph = parseFloat(p.height); if (Number.isNaN(pw) || Number.isNaN(ph)) continue;
      const owner = getComputedStyle(el).position, big = pw > w + 12 || ph > h + 12, loose = owner === 'static' && (pw > w + 2 || ph > h + 2);
      if (big || loose) push('pseudo-vaza-do-dono', el, `${ps} ${Math.round(pw)}x${Math.round(ph)} sobre dono ${Math.round(w)}x${Math.round(h)} (position:${owner})`);
    }
  }

  // 4) estouro horizontal
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 4) push('estouro-horizontal-pagina', de, `scrollWidth ${de.scrollWidth} > ${de.clientWidth}`);
  for (const el of document.querySelectorAll('body, #root, [class*=panel], [class*=manage], [class*=side], [class*=modal], [class*=dialog], [class*=tabs], main')) {
    if (!visible(el)) continue; const ox = getComputedStyle(el).overflowX;
    if (el.scrollWidth > el.clientWidth + 4 && ox !== 'auto' && ox !== 'scroll') push('estouro-horizontal', el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth} (overflow-x:${ox})`);
  }
  const scrollsX = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el) || (modals.length && !inModal(el))) continue; const { r, w, h } = rectOf(el); if (w < 2 || h < 2) continue;
    if ((r.right > vw + 1 || r.left < -1) && r.top < vh && r.bottom > 0 && !scrollsX(el)) push('interativo-cortado-na-lateral', el, `left ${Math.round(r.left)} right ${Math.round(r.right)} (viewport ${vw})`);
  }
  return { tested, blockedByModal: blocked, modalOpen: modals.length > 0, issues };
}

// ---------------------------------------------------------------- CDP
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', ev => { const m = JSON.parse(String(ev.data)); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) rej(new Error(m.error.message)); else res(m.result); } }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch { /* ainda subindo */ } if (Date.now() > end) throw new Error(`tempo esgotado: ${what}`); await sleep(150); } }

const clickScript = (pattern, scope) => `(() => { const re = new RegExp(${JSON.stringify(pattern)}, 'i'), root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; if (!root) return false;
  const all = [...root.querySelectorAll('button, a, [role=button], summary')].filter(b => b.checkVisibility && b.checkVisibility());
  const hit = all.find(b => re.test((b.textContent || '').trim()) || re.test((b.getAttribute('aria-label') || '').trim()));
  if (hit) { hit.click(); return true; } try { const e = document.querySelector(${JSON.stringify(pattern)}); if (e) { e.click(); return true; } } catch {} return false; })()`;

async function main() {
  if (!CHROME) throw new Error('Chrome não encontrado: use --chrome=<exe>');
  const only = args.only ? String(args.only).toLowerCase() : '';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-hit-audit-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars=false', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), total: 0, failing: 0, results: [] };
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.ok), 20000, 'Chrome iniciar');
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new Cdp(ws); await cdp.send('Page.enable'); await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(s); })" }); await cdp.send('Runtime.enable');
    for (const sc of SCENARIOS) {
      if (only && !sc.name.toLowerCase().includes(only)) continue;
      for (const [w, h] of sc.viewports) {
        const phone = sc.kind === 'phone', entry = { scenario: sc.name, viewport: `${w}x${h}`, url: sc.url, issues: [] };
        try {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: phone });
          await cdp.send('Page.navigate', { url: 'about:blank' });
          await cdp.send('Page.navigate', { url: sc.url });
          await waitFor(() => cdp.eval(`document.readyState === 'complete' && !!document.querySelector('#root > *')`), 30000, 'página carregar');
          await sleep(900);
          for (const st of sc.steps) {
            if (st.wait) await sleep(st.wait);
            else if (st.click) { const ok = await waitFor(() => cdp.eval(clickScript(st.click, st.in)), 4000, `clicar em ${st.click}`).catch(() => false); if (!ok) entry.issues.push({ type: 'passo-falhou', el: st.click, detail: 'elemento do passo não encontrado (cenário não chegou ao estado)' }); await sleep(350); }
            else if (st.js) await cdp.eval(st.js);
          }
          const out = await cdp.eval(`(${pageAudit.toString()})()`);
          entry.tested = out.tested; entry.modalOpen = out.modalOpen; entry.blockedByModal = out.blockedByModal;
          // um mesmo problema costuma se repetir em vários elementos iguais: agrupa por tipo+descrição
          const uniq = new Map(); for (const i of out.issues) uniq.set(`${i.type}|${i.el}|${i.detail ?? ''}`, i); entry.issues.push(...uniq.values());
        } catch (e) { entry.issues.push({ type: 'erro-do-auditor', el: sc.name, detail: String(e.message || e) }); }
        report.total++; if (entry.issues.length) report.failing++;
        report.results.push(entry);
        process.stderr.write(`${entry.issues.length ? 'FALHA' : 'ok   '} ${sc.name} @ ${w}x${h} (${entry.tested ?? 0} testados${entry.modalOpen ? ', modal' : ''})${entry.issues.length ? ` - ${entry.issues.length} problema(s)` : ''}\n`);
      }
    }
    ws.close();
  } finally {
    if (process.platform === 'win32' && chrome.pid) spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome ainda segurando arquivos */ } }, 1500);
  }
  console.log(JSON.stringify(args.all ? report : { ...report, results: report.results.filter(r => r.issues.length) }, null, 2));
  process.exitCode = report.failing ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 2; });
