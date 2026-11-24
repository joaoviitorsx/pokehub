// Regras puras da Twitch em segundo plano (sem Electron, para testar): nome do canal, URLs permitidas, leitura da página e estado.
import type { TwitchState } from '../contracts/twitch';

/** Nome de canal da Twitch: 4 a 25 caracteres, letras, números e _ (o usuário pode colar a URL do canal). */
export function normalizeChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]+)/i.exec(text);
  if (url) text = url[1]!;
  text = text.replace(/^@/,'').toLowerCase();
  if (text === '') return '';
  return /^[a-z0-9_]{3,25}$/.test(text) ? text : null;
}
export const channelUrl = (channel: string) => `https://www.twitch.tv/${channel}`;
export const LOGIN_URL = 'https://www.twitch.tv/login';

const hostOf = (value: string): {protocol: string; host: string} | null => { try { const url = new URL(value); return {protocol:url.protocol, host:url.hostname.toLowerCase()}; } catch { return null; } };
const isTwitchHost = (host: string) => host === 'twitch.tv' || host.endsWith('.twitch.tv');
/** O quadro principal da janela da Twitch só navega dentro de twitch.tv (o login fica em www/passport/id.twitch.tv). */
export function isAllowedTwitchNavigation(value: string): boolean {
  const parsed = hostOf(value);
  return parsed !== null && parsed.protocol === 'https:' && isTwitchHost(parsed.host);
}
const LOCAL = ['data:','blob:','about:','chrome-error:','devtools:'];
/** Rede da sessão da Twitch: só https/wss (vídeo, chat e captcha do login usam vários CDNs); http e outros esquemas são cancelados. */
export function twitchRequestAllowed(value: string): boolean {
  const parsed = hostOf(value);
  if (!parsed) return false;
  return LOCAL.includes(parsed.protocol) || parsed.protocol === 'https:' || parsed.protocol === 'wss:';
}

/** Saldo como a Twitch escreve: "1.234", "1,234", "12,3 mil", "12.3K", "1,2 mi", "1.2M". null se não der para ler. */
export function parseBalance(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g,' ').trim().toLowerCase();
  const match = /^(\d{1,3}(?:[.,\s]\d{3})*|\d+)(?:[.,](\d+))?\s*(k|mil|m|mi|mln)?$/.exec(text);
  if (!match) return null;
  const [,whole,fraction,suffix] = match;
  const mult = suffix === 'k' || suffix === 'mil' ? 1e3 : suffix ? 1e6 : 1;
  // com sufixo o separador é decimal ("12,3 mil"); sem sufixo, "1.234"/"1,234" são milhares
  if (mult === 1) {
    if (fraction !== undefined) {
      if (fraction.length !== 3) return null;
      return Number(`${whole!.replace(/[.,\s]/g,'')}${fraction}`);
    }
    return Number(whole!.replace(/[.,\s]/g,''));
  }
  const digits = whole!.replace(/[.,\s]/g,'');
  const number = Number(`${digits}.${fraction ?? '0'}`);
  return Number.isFinite(number) ? Math.round(number * mult) : null;
}

/** O que o script lê da página do canal (mundo isolado). Tudo é revalidado aqui antes de usar. */
export interface TwitchProbe { live: boolean; playing: boolean; paused: boolean; balance: string | null; claimable: boolean; gate: boolean; loggedOut: boolean }
export function sanitizeProbe(value: unknown): TwitchProbe | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const flag = (key: string) => raw[key] === true;
  const loggedOut = flag('loggedOut');
  const balance = !loggedOut && typeof raw.balance === 'string' && raw.balance.length <= 32 ? raw.balance : null; // deslogado a página mostra números que não são saldo
  return {live:flag('live'), playing:flag('playing'), paused:flag('paused'), balance, claimable:!loggedOut && flag('claimable'), gate:flag('gate'), loggedOut};
}
/** Estado mostrado a partir da leitura; `login` é o nome lido do cookie da sessão. */
export function stateOf(input: {enabled: boolean; channel: string; login: string | null; duplicate: boolean; failed: boolean; probe: TwitchProbe | null}): TwitchState {
  if (!input.enabled) return 'off';
  if (!input.channel) return 'no_channel';
  if (!input.login || input.probe?.loggedOut) return 'login';
  if (input.duplicate) return 'duplicate';
  if (input.failed) return 'error';
  if (!input.probe) return 'starting';
  if (input.probe.gate) return 'attention';
  if (!input.probe.live) return 'offline';
  return input.probe.playing ? 'watching' : 'starting';
}

/** Leitura da página do canal: só lê o DOM e devolve números/flags; os seletores ficam aqui para ajustar num lugar só. */
export const PROBE_SCRIPT = `(() => {
  const q = s => document.querySelector(s);
  const video = q('video');
  const live = Boolean(q('[data-a-target="animated-channel-viewers-count"], .live-time, .tw-channel-status-text-indicator, [data-a-target="player-state-live"]'));
  const playing = Boolean(video && !video.paused && !video.ended && video.readyState >= 2);
  const box = q('[data-test-selector="community-points-summary"], .community-points-summary');
  let balance = null;
  if (box) { const el = box.querySelector('[data-test-selector="balance-string"], [data-test-selector="copo-balance-string"]') || box; const m = (el.textContent || '').match(/\\d[\\d.,\\s]*(?:\\s?(?:k|mil|mi|m|mln))?/i); balance = m ? m[0].trim().slice(0, 32) : null; }
  const claimable = Boolean(box && box.querySelector('.claimable-bonus__icon'));
  const gate = Boolean(q('[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"]'));
  const loggedOut = Boolean(q('[data-a-target="login-button"]'));
  return {live, playing, paused: Boolean(video && video.paused), balance, claimable, gate, loggedOut};
})()`;
/** Coleta o baú de bônus (um clique no botão do baú, só se ele estiver lá). */
export const CLAIM_SCRIPT = `(() => { const icon = document.querySelector('[data-test-selector="community-points-summary"] .claimable-bonus__icon, .community-points-summary .claimable-bonus__icon'); const button = icon && icon.closest('button'); if (!button) return false; button.click(); return true; })()`;
/** Retoma o player se ele parou sozinho com a live no ar (não mexe em som nem qualidade). */
export const RESUME_SCRIPT = `(() => { const v = document.querySelector('video'); if (!v || !v.paused) return false; const p = v.play(); if (p && p.catch) p.catch(() => {}); return true; })()`;
/** Abre o painel de recompensas do canal (o mesmo botão do saldo); o resgate é sempre do usuário. */
export const REWARDS_SCRIPT = `(() => { const box = document.querySelector('[data-test-selector="community-points-summary"], .community-points-summary'); const button = box && box.querySelector('button'); if (!button) return false; button.click(); return true; })()`;
/** Menor qualidade do player (160p) gravada nas preferências da própria Twitch; true se mudou (precisa recarregar). */
export const LOW_QUALITY_SCRIPT = `(() => { try { const want = '{"default":"160p30"}'; if (localStorage.getItem('video-quality') === want) return false; localStorage.setItem('video-quality', want); return true; } catch { return false; } })()`;

/** Intervalo da leitura: rápido enquanto abre, normal ao vivo, lento fora do ar. */
export function probeDelay(state: TwitchState): number {
  if (state === 'starting') return 10_000;
  if (state === 'watching') return 30_000;
  return 60_000;
}
/** Fora do ar há mais que isto: recarrega a página do canal (pega a live que começou). */
export const OFFLINE_RELOAD_MS = 10 * 60_000;
/** Início escalonado das janelas da Twitch, depois das sessões do jogo. */
export const TWITCH_START_DELAY_MS = 8_000, TWITCH_STAGGER_MS = 3_000;
