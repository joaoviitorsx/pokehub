import { defineConfig } from 'vite';
export default defineConfig({ base: './', ssr: { external: ['node:sqlite'] } });
