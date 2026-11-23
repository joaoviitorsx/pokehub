export function isAllowedGameUrl(value: string): boolean {
  try {
    return new URL(value).origin === 'https://pokeidle.io';
  } catch {
    return false;
  }
}

// Provedores OAuth oficiais usados pelo fluxo de login do jogo; sem alterar UA nem mecanismos do provedor.
const oauthOrigins = ['https://accounts.google.com', 'https://discord.com'];

export function isOAuthProviderUrl(value: string): boolean {
  try {
    return oauthOrigins.includes(new URL(value).origin);
  } catch {
    return false;
  }
}

export function isAllowedSessionNavigation(value: string): boolean {
  return isAllowedGameUrl(value) || isOAuthProviderUrl(value);
}
