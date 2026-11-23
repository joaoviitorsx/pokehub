// Service worker mínimo: só registra (instalação do app). Sem cache e sem interceptar nada; o Web Push entra na fase R3.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
