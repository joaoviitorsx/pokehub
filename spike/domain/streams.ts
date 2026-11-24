// Plataformas de live (Twitch e Kick): o que muda entre elas fica aqui, como dados e scripts constantes. O serviço é o mesmo.
import type { StreamPlatform } from '../contracts/twitch';
import { channelUrl as twitchChannelUrl, CLAIM_SCRIPT, isAllowedTwitchNavigation, LOGIN_URL, LOW_QUALITY_SCRIPT, normalizeChannel, PROBE_SCRIPT, REWARDS_SCRIPT } from './twitch';
import { isAllowedKickNavigation, KICK_PROBE_SCRIPT, KICK_THROTTLE_FALLBACK_KBPS, KICK_THROTTLE_KBPS, normalizeKickChannel } from './kick';

export interface PlatformSpec {
  id: StreamPlatform;
  nome: string;
  /** prefixo da pasta da sessão em `Partitions/` (uma por perfil e plataforma) */
  partitionPrefix: string;
  homeUrl: string;
  loginUrl: string;
  channelUrl: (channel: string) => string;
  normalizeChannel: (value: unknown) => string | null;
  isAllowedNavigation: (url: string) => boolean;
  /** URL para ler os cookies de login */
  cookieUrl: string;
  /** cookies que existem só com a conta logada (qualquer um basta) */
  tokenCookies: string[];
  /** cookie com o nome de usuário, se a plataforma tiver um */
  nameCookie: string | null;
  probeScript: string;
  claimScript: string | null;
  rewardsScript: string | null;
  /** script que grava a menor qualidade nas preferências do player (true = mudou, recarregar) */
  lowQualityScript: string | null;
  /** limite de banda da janela escondida (kbps), para o player escolher qualidade baixa sozinho */
  throttleKbps: number | null;
  /** limite usado se, com o limite mínimo, a live estiver no ar e o vídeo parar (o player não desceu de qualidade) */
  throttleFallbackKbps: number | null;
  /** sem cookie de login confiável: abre o canal escondido e decide pelo que a página mostra (botão de entrar / conta no menu) */
  loginByProbe: boolean;
  /** CSS aplicado só com a janela escondida: tira o chat da tela (menos memória de layout; o chat não conta pontos) */
  hideCss: string;
}
export const PLATFORMS: Record<StreamPlatform, PlatformSpec> = {
  twitch: {
    id:'twitch', nome:'Twitch', partitionPrefix:'pokehubtw-', homeUrl:'https://www.twitch.tv/', loginUrl:LOGIN_URL, channelUrl:twitchChannelUrl,
    normalizeChannel, isAllowedNavigation:isAllowedTwitchNavigation, cookieUrl:'https://www.twitch.tv', tokenCookies:['auth-token'], nameCookie:'login',
    probeScript:PROBE_SCRIPT, claimScript:CLAIM_SCRIPT, rewardsScript:REWARDS_SCRIPT, lowQualityScript:LOW_QUALITY_SCRIPT, throttleKbps:null, throttleFallbackKbps:null, loginByProbe:false,
    hideCss:'.chat-shell,.right-column,[data-a-target="right-column-chat-bar"],.chat-room,.stream-chat{display:none!important}',
  },
  kick: {
    id:'kick', nome:'Kick', partitionPrefix:'pokehubkk-', homeUrl:'https://kick.com/', loginUrl:'https://kick.com/', channelUrl:(channel: string) => `https://kick.com/${channel}`,
    normalizeChannel:normalizeKickChannel, isAllowedNavigation:isAllowedKickNavigation, cookieUrl:'https://kick.com', tokenCookies:['session_token'], nameCookie:null,
    probeScript:KICK_PROBE_SCRIPT, claimScript:null, rewardsScript:null, lowQualityScript:null, throttleKbps:KICK_THROTTLE_KBPS, throttleFallbackKbps:KICK_THROTTLE_FALLBACK_KBPS, loginByProbe:true,
    hideCss:'#channel-chatroom,[data-testid="chatroom-messages"]{display:none!important}',
  },
};
export const isPlatform = (value: unknown): value is StreamPlatform => value === 'twitch' || value === 'kick';
