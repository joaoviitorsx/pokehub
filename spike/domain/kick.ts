// Kick em segundo plano: regras puras (nome do canal, navegação, leitura da página). Página conferida em 2026-11-24 (kick.com).

/** Slug do canal na Kick: 3 a 25 caracteres, letras, números, _ e - (aceita o link do canal). */
export function normalizeKickChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?kick\.com\/([^/?#\s]+)/i.exec(text);
  if (url) text = url[1]!;
  text = text.replace(/^@/, '').toLowerCase();
  if (text === '') return '';
  return /^[a-z0-9_-]{3,25}$/.test(text) ? text : null;
}
const parse = (value: string) => { try { const url = new URL(value); return {protocol: url.protocol, host: url.hostname.toLowerCase()}; } catch { return null; } };
/** O quadro principal da janela da Kick só navega em https dentro de kick.com (o login é um modal na própria página). */
export function isAllowedKickNavigation(value: string): boolean {
  const parsed = parse(value);
  return parsed !== null && parsed.protocol === 'https:' && (parsed.host === 'kick.com' || parsed.host.endsWith('.kick.com'));
}
/**
 * Leitura da página do canal (mundo isolado). A Kick não tem seletores estáveis para tudo: "ao vivo" pelo título da live
 * (`[data-testid="livestream-title"]`), player pelo `<video>`, saldo por qualquer elemento rotulado como pontos do canal,
 * aviso de conteúdo pelo botão de começar a assistir e o nome da conta pela imagem do menu da conta.
 */
export const KICK_PROBE_SCRIPT = `(() => {
  const video = document.querySelector('video');
  const live = Boolean(document.querySelector('[data-testid="livestream-title"]'));
  const playing = Boolean(video && !video.paused && !video.ended && video.readyState >= 2);
  let balance = null;
  const marcados = Array.from(document.querySelectorAll('[data-testid*="point" i], [aria-label*="pontos" i], [aria-label*="points" i], [title*="pontos do canal" i], [title*="channel points" i]')).slice(0, 12);
  for (const e of marcados) { const m = ((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')).match(/\\d[\\d.,\\s]*(?:\\s?(?:k|mil|mi|m))?/i); if (m) { balance = m[0].trim().slice(0, 32); break; } }
  const botoes = Array.from(document.querySelectorAll('button')).slice(0, 400);
  const gate = botoes.some((b) => /^(start watching|começar a assistir|assistir mesmo assim|i understand|entendi)$/i.test((b.textContent || '').trim()));
  const loggedOut = botoes.some((b) => /^(log in|entrar|sign up|cadastre-se)$/i.test((b.textContent || '').trim()));
  const conta = document.querySelector('[data-testid="navbar-account"] img[alt]');
  const user = conta ? String(conta.getAttribute('alt') || '').trim().slice(0, 25) : '';
  return {live, playing, paused: Boolean(video && video.paused), balance, claimable: false, gate, loggedOut, user};
})()`;
/** Kick: o player (Amazon IVS) escolhe a qualidade sozinho; escondida, a banda da janela é limitada a isto e ele desce para ~480p. */
export const KICK_THROTTLE_KBPS = 1200;
