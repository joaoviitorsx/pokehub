import { build, defineConfig, type InlineConfig, type Plugin } from 'vite';
// Dois builds com saídas SEPARADAS: o hub (index.html → dist) e o app do celular (remote.html → dist-remote, servido pelo servidor do acesso remoto).
// Assim o servidor só enxerga arquivos do celular (nunca o bundle do desktop) e o desktop não carrega sw.js/manifest do celular.
// O código do celular fica em spike/remote-ui e nunca é importado pelo renderer do hub.
const remote: InlineConfig = {
  configFile: false, base: './', publicDir: 'spike/remote-ui/public', ssr: { external: ['node:sqlite'] },
  build: { outDir: 'dist-remote', emptyOutDir: true, manifest: true, rollupOptions: { input: { remote: 'remote.html' } } },
};
const buildRemote = (): Plugin => ({ name: 'pokehub-remote-build', apply: 'build', async closeBundle() { if (process.env.POKEHUB_REMOTE_BUILD !== '1') { process.env.POKEHUB_REMOTE_BUILD = '1'; try { await build(remote); } finally { delete process.env.POKEHUB_REMOTE_BUILD; } } } });
export default defineConfig({ base: './', publicDir: false, ssr: { external: ['node:sqlite'] }, plugins: [buildRemote()], build: { rollupOptions: { input: { main: 'index.html' } } } });
