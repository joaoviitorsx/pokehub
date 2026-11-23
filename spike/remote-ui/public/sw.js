// Service worker do app do celular. Instala o app e, nas chamadas de pareamento (/api/pair e /api/pair/wait), acrescenta o cabeçalho X-PH-SW: 1.
// O servidor só aceita o pareamento com esse cabeçalho. É uma HEURÍSTICA (não prova nada sozinha): garante que o navegador registrou o service worker
// (o que exige certificado confiável) e que a página que pareia veio deste servidor; um atacante com um cliente próprio pode mandar o cabeçalho.
// A proteção real continua sendo conferir a impressão digital da CA e o número de conferência (SAS) no PC.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== self.location.origin || (url.pathname !== '/api/pair' && url.pathname !== '/api/pair/wait')) return;
  event.respondWith((async () => {
    const headers = new Headers(request.headers); headers.set('X-PH-SW', '1');
    const init = {method: request.method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: request.signal};
    if (request.method === 'POST') init.body = await request.clone().text();
    return fetch(url.pathname + url.search, init);
  })());
});

// ---- Web Push (R3). Sem cache de /api: este arquivo não guarda nenhuma resposta; o único fetch tratado é o de pareamento acima. ----
// Lógica pura em escopo de topo (spike/tests/remote-push.test.ts carrega este arquivo e a testa).
const PUSH_MAX_BYTES = 4096;
const PUSH_URL_RE = /^#(alertas|contas|conta\/[0-9a-f-]{36})$/;
const PUSH_TITLES = {shiny: '✨ Shiny capturado!', p5: 'P5 capturado', recorde: 'Recorde!', nota: 'Nota alta', conta_caiu: 'Conta caiu', conta_voltou: 'Conta voltou', acao: 'Ação pelo celular'};
function pushSafeUrl(url) { return typeof url === 'string' && PUSH_URL_RE.test(url) ? url : '#alertas'; }
function pushClip(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
/** Texto → {kind,label,text,at,url} válido, ou null (vazio, grande demais, JSON ruim, tipo desconhecido). */
function pushParse(text) {
  if (typeof text !== 'string' || !text || text.length > PUSH_MAX_BYTES) return null;
  let data; try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(PUSH_TITLES, data.kind)) return null;
  return {kind: data.kind, label: pushClip(data.label, 60), text: pushClip(data.text, 200), at: pushClip(data.at, 40), url: pushSafeUrl(data.url)};
}
/** Título e opções da notificação. Sem payload válido vira um aviso genérico (o navegador exige mostrar algo a cada push). */
function pushView(p) {
  if (!p) return {title: 'PokéHub', options: {body: 'Há novidades no PokéHub.', tag: 'geral', renotify: false, icon: '/icon-512.png', badge: '/icon-512.png', data: {url: '#alertas'}}};
  const profile = /^#conta\/(.+)$/.exec(p.url);
  return {title: PUSH_TITLES[p.kind], options: {body: p.label ? p.label + ': ' + p.text : p.text, tag: p.kind + ':' + (profile ? profile[1] : 'geral'), renotify: false, icon: '/icon-512.png', badge: '/icon-512.png', data: {url: p.url}}};
}
self.addEventListener('push', event => {
  let raw; try { raw = event.data ? event.data.text() : ''; } catch { raw = ''; }
  const view = pushView(pushParse(raw));
  event.waitUntil(self.registration.showNotification(view.title, view.options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = pushSafeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const mine = list.find(c => new URL(c.url).origin === self.location.origin);
    if (mine) { try { await mine.focus(); } catch { /* sem foco */ } mine.postMessage({type: 'ph-nav', url}); return; }
    await self.clients.openWindow('/' + url);
  })());
});
// o navegador trocou a assinatura: avisa a página aberta para renovar no PC
self.addEventListener('pushsubscriptionchange', event => event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => list.forEach(c => c.postMessage({type: 'ph-resync'})))));
