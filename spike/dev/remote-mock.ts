// Servidor de prévia do app do celular (só desenvolvimento, não vai no build): `npx vite --config spike/dev/remote-mock.ts --port 5175` e abra /remote.html.
// Finge /api/* do PC (me, eventos SSE, contas, capturas, alertas, preferências, push). GET /__mock/emit manda uma captura e um alerta ao vivo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { planRestock, type KitLine, type ShopItem } from '../domain/shop';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accounts = [{id: id(1), label: 'Principal', color: '#e5484d', state: 'ready', suspended: false}, {id: id(2), label: 'Farm Kanto', color: '#3fa7d6', state: 'ready', suspended: false}, {id: id(3), label: 'Farm Johto', color: '#30a46c', state: 'offline', suspended: false}, {id: id(4), label: 'Reserva', color: '#f5a524', state: 'ready', suspended: true}];
const color = new Map(accounts.map(a => [a.id, a.color])), label = new Map(accounts.map(a => [a.id, a.label]));
const base = Date.now(), at = (min: number) => new Date(base - min * 60_000).toISOString();
const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
type Cap = {profileId: string; name: string; level: number | null; potencia: number | null; iv: number | null; quality: number | null; nota: number | null; shiny: boolean; record: boolean; min: number};
const mk = (c: Cap) => { const a = at(c.min); return {profileId: c.profileId, name: c.name, level: c.level, time: hm(a), at: a, potencia: c.potencia, iv: c.iv, quality: c.quality, nota: c.nota, shiny: c.shiny, record: c.record, label: label.get(c.profileId)!, color: color.get(c.profileId)!}; };
const captures = [
  {profileId: id(1), name: 'Gastly', level: 31, potencia: 5, iv: 138, quality: 2.41, nota: 4.2, shiny: true, record: true, min: 3}, {profileId: id(2), name: 'Charmander', level: 20, potencia: 2, iv: 101, quality: 1.487, nota: 2.176, shiny: false, record: false, min: 6},
  {profileId: id(1), name: 'Eevee', level: 18, potencia: 4, iv: 120, quality: 1.9, nota: 3.1, shiny: false, record: false, min: 11}, {profileId: id(1), name: 'Pidgey', level: 9, potencia: 1, iv: 60, quality: 0.8, nota: 1.2, shiny: false, record: false, min: 17},
  {profileId: id(2), name: 'Dratini', level: 25, potencia: 5, iv: 140, quality: 2.6, nota: 4.8, shiny: false, record: true, min: 24}, {profileId: id(1), name: 'Zubat', level: 12, potencia: 3, iv: 88, quality: 1.3, nota: 2.0, shiny: false, record: false, min: 31},
  {profileId: id(3), name: 'Meowth', level: null, potencia: null, iv: null, quality: null, nota: null, shiny: false, record: false, min: 55},
].map(mk);
type Kind = 'shiny' | 'p5' | 'recorde' | 'nota' | 'conta_caiu' | 'conta_voltou';
const al = (n: number, kind: Kind, p: number, text: string, min: number) => ({id: `a${n}`, at: at(min), kind, profileId: id(p), label: label.get(id(p))!, text});
const alerts = [al(1, 'shiny', 1, 'Gastly Nv 31 · P5 · nota 4,2', 3), al(2, 'conta_caiu', 3, 'Sem conexão com o jogo', 9), al(3, 'p5', 2, 'Dratini Nv 25 · nota 4,8', 24), al(4, 'recorde', 2, 'Dratini: maior nota do dia', 24), al(5, 'nota', 1, 'Eevee Nv 18 · nota 3,1', 40), al(6, 'conta_voltou', 2, 'Voltou a ficar pronta', 130), al(7, 'conta_caiu', 2, 'Precisa entrar de novo', 190)];
const prefs = {shiny: true, p5: true, recorde: true, notaMin: 3.5, contaCaiu: true};
const clients = new Set<ServerResponse>();
// --- R4: Loja e ações (PIN de teste: 123456). /__mock/set?canAct=0&elev=1&lite=1&locked=1&disabled=1 muda o estado ---
const MOCK_PIN = '123456', CAP = 200_000;
const mock = {canAct: true, elevUntil: 0, lite: false, locked: false, disabled: false, price: 0};
const goldOf: Record<string, number> = {[id(1)]: 2_450_000, [id(2)]: 880_000, [id(3)]: 15_000, [id(4)]: 40_000}, spentOf: Record<string, number> = {[id(1)]: 62_000};
const items = (n: number): ShopItem[] => [{cat: 'Pokebolas', name: 'Poke Ball', have: 120 + n, price: 100}, {cat: 'Pokebolas', name: 'Great Ball', have: 40, price: 400}, {cat: 'Pokebolas', name: 'Ultra Ball', have: 12, price: 1500 + mock.price}, {cat: 'Poções', name: 'Small Potion', have: 300, price: 50}, {cat: 'Poções', name: 'Hyper Potion', have: 8, price: 1200}, {cat: 'Revives', name: 'Revive', have: 3, price: 2500}];
const plans = new Map<string, {accounts: {profileId: string; label: string; lines: {name: string; qty: number; unitPrice: number}[]}[]}>();
const actions = () => ({canAct: mock.canAct, pinSet: true, actionsDisabled: mock.disabled, lockedMs: mock.locked ? 840_000 : 0, elevatedMs: Math.max(0, mock.elevUntil - Date.now()), dailyCapGold: CAP, lite: mock.lite});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const emit = (event: string, data: unknown) => { for (const r of clients) send(r, event, data); };
type Body = Record<string, unknown>;
const guard = (res: ServerResponse, b: Body, force = false): boolean => {
  if (mock.disabled) { json(res, {error: 'As ações pelo celular estão desligadas no PC.', code: 'acoes_desligadas'}, 423); return true; }
  if (!mock.canAct) { json(res, {error: 'Sem permissão.', code: 'sem_permissao'}, 403); return true; }
  if (mock.locked) { json(res, {error: 'PIN bloqueado.', code: 'pin_bloqueado', retryAfterMs: 840_000}, 423); return true; }
  if (!force && mock.elevUntil > Date.now()) return false;
  if (b.pin === undefined) { json(res, {error: 'Informe o PIN.', code: 'pin_necessario', force}, 403); return true; }
  if (b.pin !== MOCK_PIN) { json(res, {error: 'PIN incorreto. Restam 4 tentativa(s).', code: 'pin_errado', attemptsLeft: 4}, 403); return true; }
  return false;
};
async function shopApi(p: string, b: Body, res: ServerResponse, headers: IncomingMessage['headers']) {
  const ids = (Array.isArray(b.profileIds) ? b.profileIds : []).filter((x): x is string => typeof x === 'string'), name = (pid: string) => accounts.find(a => a.id === pid)?.label ?? 'Conta';
  if (!mock.canAct) return json(res, {error: 'Sem permissão.', code: 'sem_permissao'}, 403);
  if (p === '/api/shop/read') { await sleep(500); return json(res, {accounts: ids.map((pid, n) => ({profileId: pid, label: name(pid), gold: goldOf[pid] ?? 0, items: items(n)}))}); }
  if (p === '/api/shop/plan') {
    await sleep(400);
    const exec = ids.map((pid, n) => {
      const its = items(n), orders = b.mode === 'kit' ? planRestock(its, ((b.kit as {lines: KitLine[]}).lines)) : ((b.lines as {cat: string; name: string; qty: number}[]) ?? []).flatMap(l => { const i = its.find(x => x.name === l.name); return i ? [{cat: i.cat, name: i.name, qty: l.qty, unitPrice: i.price, total: l.qty * i.price}] : []; });
      let left = goldOf[pid] ?? 0; const lines = orders.map(o => { const fits = o.total <= left; if (fits) left -= o.total; return {...o, have: its.find(x => x.name === o.name)?.have ?? 0, fits}; });
      const total = lines.filter(l => l.fits).reduce((s, l) => s + l.total, 0), capRemaining = CAP - (spentOf[pid] ?? 0), ok = total > 0 && total <= capRemaining;
      return {profileId: pid, label: name(pid), goldBefore: goldOf[pid] ?? 0, goldAfter: (goldOf[pid] ?? 0) - (ok ? total : 0), lines, total: ok ? total : 0, capRemaining, capAfter: capRemaining - (ok ? total : 0), executable: ok, ...(ok ? {} : {error: total === 0 ? 'Ouro insuficiente.' : 'Passa do teto diário do celular (restam ' + capRemaining + ' de ouro).'})};
    });
    const ex = exec.filter(a => a.executable); if (!ex.length) return json(res, {error: 'Nada para comprar com estes itens, o ouro e o teto diário.', code: 'nada_a_comprar', plan: {accounts: exec, total: 0, needsPin: false, dailyCapGold: CAP, mode: b.mode}}, 422);
    const confirmId = Array.from({length: 32}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    plans.set(confirmId, {accounts: ex.map(a => ({profileId: a.profileId, label: a.label, lines: a.lines.filter(l => l.fits).map(l => ({name: l.name, qty: l.qty, unitPrice: l.unitPrice}))}))});
    const needsPin = ex.some(a => a.total * 2 > a.capRemaining);
    return json(res, {confirmId, planHash: 'ab'.repeat(32), expiresAt: Date.now() + 60_000, elevated: mock.elevUntil > Date.now(), plan: {accounts: exec, total: ex.reduce((s, a) => s + a.total, 0), needsPin, dailyCapGold: CAP, mode: b.mode, ...(b.mode === 'kit' ? {kitName: String((b.kit as {name?: string}).name)} : {})}});
  }
  if (p === '/api/shop/confirm') {
    const plan = plans.get(String(b.confirmId)); if (!plan || !headers['idempotency-key']) return json(res, {error: 'Confirmação não encontrada.', code: 'nao_encontrada'}, 404);
    const big = plan.accounts.some(a => a.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 2 > CAP - (spentOf[a.profileId] ?? 0));
    if (guard(res, b, big)) return; plans.delete(String(b.confirmId));
    emit('shop', {kind: 'start', confirmId: b.confirmId, accounts: plan.accounts.map(a => ({profileId: a.profileId, label: a.label, lines: a.lines.length}))});
    const reply = {confirmId: b.confirmId, spent: 0, accounts: [] as unknown[]}; let spent = 0;
    for (const a of plan.accounts) {
      const lines: unknown[] = []; let acc = 0;
      for (const [line, l] of a.lines.entries()) { emit('shop', {kind: 'line', confirmId: b.confirmId, profileId: a.profileId, label: a.label, line, name: l.name, qty: l.qty, status: 'buying'}); await sleep(900); const s = l.qty * l.unitPrice; acc += s; lines.push({name: l.name, qty: l.qty, status: 'ok', bought: l.qty, spent: s}); emit('shop', {kind: 'line', confirmId: b.confirmId, profileId: a.profileId, label: a.label, line, name: l.name, qty: l.qty, status: 'ok', spent: s}); }
      spent += acc; spentOf[a.profileId] = (spentOf[a.profileId] ?? 0) + acc; goldOf[a.profileId] = (goldOf[a.profileId] ?? 0) - acc; reply.accounts.push({profileId: a.profileId, label: a.label, status: 'ok', spent: acc, lines});
    }
    reply.spent = spent; emit('shop', {kind: 'done', confirmId: b.confirmId, result: reply}); return json(res, reply);
  }
  json(res, {error: 'não encontrado'}, 404);
}
const send = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (res: ServerResponse, body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const body = (req: IncomingMessage) => new Promise<unknown>(done => { let s = ''; req.on('data', c => { s += String(c); }); req.on('end', () => { try { done(JSON.parse(s)); } catch { done(null); } }); });

const plugin = (): Plugin => ({name: 'remote-mock', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://x'), p = url.pathname;
    if (p === '/__mock/emit') { send0(); return json(res, {ok: true}); }
    if (p === '/__mock/set') { for (const [k, v] of url.searchParams) { if (k === 'elev') mock.elevUntil = v === '1' ? Date.now() + 8 * 60_000 : 0; else if (k === 'price') mock.price = Number(v); else (mock as Record<string, unknown>)[k] = v === '1'; } return json(res, mock); }
    if (!p.startsWith('/api/')) return next();
    if (p === '/api/me') return json(res, {name: 'Celular de teste', canAct: mock.canAct, pinSet: true, actions: actions()});
    if (req.method === 'POST' && /^\/api\/(shop\/|elevate|lite|account\/)/.test(p)) { void body(req).then(async raw => {
      const b = (raw ?? {}) as Body, m = /^\/api\/account\/([\w-]+)\/(reload|suspend|resume)$/.exec(p);
      if (p.startsWith('/api/shop/')) return shopApi(p, b, res, req.headers);
      if (p === '/api/elevate') { if (guard(res, {...b}, true)) return; mock.elevUntil = Date.now() + 600_000; return json(res, {ok: true, elevatedMs: 600_000}); }
      if (guard(res, b)) return; await sleep(300);
      if (p === '/api/lite') { mock.lite = b.on === true; return json(res, {ok: true, lite: mock.lite}); }
      if (m) { const acc = accounts.find(a => a.id === m[1]); if (acc && m[2] === 'suspend') acc.suspended = true; if (acc && m[2] === 'resume') acc.suspended = false; emit('state', {accounts}); return json(res, {ok: true}); }
      json(res, {error: 'não encontrado'}, 404); }); return; }
    if (p === '/api/events') { res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store'}); send(res, 'state', {accounts}); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p === '/api/captures') { const pid = url.searchParams.get('profileId'); return json(res, {captures: captures.filter(c => !pid || c.profileId === pid)}); }
    if (p === '/api/alerts') return json(res, {alerts});
    if (p === '/api/alerts/prefs') { if (req.method === 'POST') { void body(req).then(b => { Object.assign(prefs, b); json(res, prefs); }); return; } return json(res, prefs); }
    if (p === '/api/push/key') return json(res, {publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'});
    if (p === '/api/push/test') return json(res, {sent: 1});
    if (p.startsWith('/api/push/')) return json(res, {ok: true});
    if (p === '/api/diag') return json(res, {accounts: accounts.map(a => ({id: a.id, cpuPercent: 3.2, privateKb: 410_000, workingSetKb: 500_000})), hub: {cpuPercent: 2, privateKb: 300_000}, gpu: {cpuPercent: 1, privateKb: 100_000}, other: {cpuPercent: 0, privateKb: 0}, host: {totalKb: 16_000_000, freeKb: 7_000_000}});
    if (p.startsWith('/api/hunt/')) return json(res, {estado: 'sem-extensao'});
    if (p.startsWith('/api/market/')) return json(res, {estado: 'indisponivel', erro: 'Prévia sem dados de mercado.'});
    json(res, {error: 'não encontrado'}, 404);
  });
  function send0() { const c = mk({profileId: id(2), name: 'Larvitar', level: 22, potencia: 5, iv: 131, quality: 2.2, nota: 4.4, shiny: true, record: false, min: 0}); captures.unshift(c); const a = al(99, 'shiny', 2, 'Larvitar Nv 22 · P5 · nota 4,4', 0); alerts.unshift(a); for (const r of clients) { send(r, 'capture', {captures: [c]}); send(r, 'alert', a); } }
}});
export default defineConfig({plugins: [plugin()], server: {host: '127.0.0.1'}, publicDir: 'spike/remote-ui/public'});
