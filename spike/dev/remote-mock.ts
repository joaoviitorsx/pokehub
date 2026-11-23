// Servidor de prévia do app do celular (só desenvolvimento, não vai no build): `npx vite --config spike/dev/remote-mock.ts --port 5175` e abra /remote.html.
// Finge /api/* do PC (me, eventos SSE, contas, capturas, alertas, preferências, push). GET /__mock/emit manda uma captura e um alerta ao vivo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

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
const send = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (res: ServerResponse, body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const body = (req: IncomingMessage) => new Promise<unknown>(done => { let s = ''; req.on('data', c => { s += String(c); }); req.on('end', () => { try { done(JSON.parse(s)); } catch { done(null); } }); });

const plugin = (): Plugin => ({name: 'remote-mock', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://x'), p = url.pathname;
    if (p === '/__mock/emit') { send0(); return json(res, {ok: true}); }
    if (!p.startsWith('/api/')) return next();
    if (p === '/api/me') return json(res, {name: 'Celular de teste', canAct: false, pinSet: false});
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
