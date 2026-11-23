import { defineConfig } from 'vite';
// Duas entradas: o hub (index.html) e o app do celular (remote.html, servido pelo servidor do acesso remoto).
// O código do celular fica em spike/remote-ui e nunca é importado pelo renderer do hub.
export default defineConfig({ base: './', publicDir: 'spike/remote-ui/public', ssr: { external: ['node:sqlite'] }, build: { rollupOptions: { input: { main: 'index.html', remote: 'remote.html' } } } });
