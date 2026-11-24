// Áudios embutidos pelo Vite (viram arquivos em dist/assets com hash; a CSP 'self' já cobre).
declare module '*.wav' { const url: string; export default url; }
