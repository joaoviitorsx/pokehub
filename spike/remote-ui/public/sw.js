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
