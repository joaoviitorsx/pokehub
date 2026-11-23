import { describe, expect, it } from 'vitest';
import { isAllowedGameUrl, isAllowedSessionNavigation, isOAuthProviderUrl } from '../electron/navigation';

describe('navegação do jogo', () => {
  it('permite apenas a origem HTTPS oficial', () => {
    expect(isAllowedGameUrl('https://pokeidle.io/game')).toBe(true);
    for (const url of ['http://pokeidle.io', 'https://pokeidle.io.example.org', 'https://example.org', 'file:///tmp/test', 'invalid']) {
      expect(isAllowedGameUrl(url)).toBe(false);
    }
  });

  it('permite o jogo e apenas as origens exatas dos provedores OAuth nas sessões', () => {
    for (const url of ['https://pokeidle.io/auth/google/retorno', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'https://discord.com/oauth2/authorize?client_id=x']) {
      expect(isAllowedSessionNavigation(url)).toBe(true);
    }
    for (const url of ['http://accounts.google.com', 'https://accounts.google.com.evil.org', 'https://evil.com/?r=accounts.google.com', 'https://google.com', 'http://discord.com', 'file:///tmp/test', 'invalid']) {
      expect(isAllowedSessionNavigation(url)).toBe(false);
    }
  });

  it('reconhece só os provedores OAuth, não o jogo', () => {
    for (const url of ['https://accounts.google.com/signin', 'https://discord.com/login']) expect(isOAuthProviderUrl(url)).toBe(true);
    for (const url of ['https://pokeidle.io/app', 'https://accounts.google.com.evil.org', 'http://discord.com', 'invalid']) expect(isOAuthProviderUrl(url)).toBe(false);
  });
});
