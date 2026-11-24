import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedTwitchNavigation, normalizeChannel, parseBalance, probeDelay, sanitizeProbe, stateOf, twitchRequestAllowed, type TwitchProbe } from '../domain/twitch';
import { TwitchStore } from '../electron/twitch-store';
import { ProfileStore } from '../electron/profile-store';
import { partitionPath, TWITCH_PREFIX, PARTITIONS_DIR } from '../electron/partition-wipe';
import { twitchPartitionFor } from '../electron/partition';

const A = '00000000-0000-4000-8000-000000000001';
const probe = (over: Partial<TwitchProbe> = {}): TwitchProbe => ({live:true, playing:true, paused:false, balance:'1.234', claimable:false, gate:false, loggedOut:false, user:null, ...over});

describe('canal da Twitch', () => {
  it('aceita nome, @nome e o link do canal; minúsculas', () => {
    expect(normalizeChannel('Canal_Oficial')).toBe('canal_oficial');
    expect(normalizeChannel(' @Canal_Oficial ')).toBe('canal_oficial');
    expect(normalizeChannel('https://www.twitch.tv/Canal_Oficial?sr=a')).toBe('canal_oficial');
    expect(normalizeChannel('twitch.tv/abc')).toBe('abc');
    expect(normalizeChannel('')).toBe('');
  });
  it('recusa o que não é nome de canal', () => {
    for (const value of ['ab', 'a'.repeat(26), 'nome com espaço', 'https://evil.com/x', '../x', 'canal-com-hifen', null, 5, {}]) expect(normalizeChannel(value)).toBeNull();
  });
});

describe('navegação e rede da sessão da Twitch', () => {
  it('quadro principal só em https dentro de twitch.tv', () => {
    for (const url of ['https://www.twitch.tv/canal', 'https://passport.twitch.tv/login', 'https://twitch.tv/']) expect(isAllowedTwitchNavigation(url)).toBe(true);
    for (const url of ['http://www.twitch.tv/', 'https://twitch.tv.evil.com/', 'https://eviltwitch.tv/', 'file:///C:/x', 'javascript:alert(1)', 'nada']) expect(isAllowedTwitchNavigation(url)).toBe(false);
  });
  it('requisições: https/wss e esquemas internos; http e file cancelados', () => {
    expect(twitchRequestAllowed('https://video-weaver.example.hls.ttvnw.net/v1/playlist.m3u8')).toBe(true);
    expect(twitchRequestAllowed('wss://irc-ws.chat.twitch.tv/')).toBe(true);
    expect(twitchRequestAllowed('data:image/png;base64,AA')).toBe(true);
    for (const url of ['http://www.twitch.tv/', 'file:///C:/Windows', 'ftp://x', 'chrome://settings', 'lixo']) expect(twitchRequestAllowed(url)).toBe(false);
  });
});

describe('saldo de pontos', () => {
  it('lê os formatos da Twitch em português e inglês', () => {
    expect(parseBalance('1.234')).toBe(1234);
    expect(parseBalance('1,234')).toBe(1234);
    expect(parseBalance('1.234.567')).toBe(1234567);
    expect(parseBalance('950')).toBe(950);
    expect(parseBalance('12,3 mil')).toBe(12300);
    expect(parseBalance('12.3K')).toBe(12300);
    expect(parseBalance('1,2 mi')).toBe(1200000);
    expect(parseBalance('1.2M')).toBe(1200000);
  });
  it('recusa texto que não é saldo', () => {
    for (const value of ['', 'abc', '1,5', '12 pontos', null, 3]) expect(parseBalance(value)).toBeNull();
  });
});

describe('leitura da página e estado', () => {
  it('só aceita flags booleanas e saldo curto', () => {
    expect(sanitizeProbe({live:'sim', playing:1, balance:'x'.repeat(40)})).toEqual({live:false, playing:false, paused:false, balance:null, claimable:false, gate:false, loggedOut:false, user:null});
    expect(sanitizeProbe(null)).toBeNull();
    expect(sanitizeProbe({live:true, loggedOut:true, balance:'0', claimable:true})).toMatchObject({balance:null, claimable:false, loggedOut:true});
    expect(sanitizeProbe('texto')).toBeNull();
  });
  it('ordem do estado: desligado > sem canal > login > repetida > erro > abrindo > aviso > offline > assistindo', () => {
    const base = {enabled:true, channel:'canal', login:'ash', duplicate:false, failed:false, probe:probe()};
    expect(stateOf({...base, enabled:false})).toBe('off');
    expect(stateOf({...base, channel:''})).toBe('no_channel');
    expect(stateOf({...base, login:null})).toBe('login');
    expect(stateOf({...base, probe:probe({loggedOut:true})})).toBe('login');
    expect(stateOf({...base, duplicate:true})).toBe('duplicate');
    expect(stateOf({...base, failed:true})).toBe('error');
    expect(stateOf({...base, probe:null})).toBe('starting');
    expect(stateOf({...base, probe:probe({gate:true})})).toBe('attention');
    expect(stateOf({...base, probe:probe({live:false, playing:false})})).toBe('offline');
    expect(stateOf({...base, probe:probe({playing:false})})).toBe('starting');
    expect(stateOf(base)).toBe('watching');
  });
  it('lê mais rápido enquanto abre e devagar fora do ar', () => {
    expect(probeDelay('starting')).toBeLessThan(probeDelay('watching'));
    expect(probeDelay('watching')).toBeLessThan(probeDelay('offline'));
  });
});

describe('partição da Twitch', () => {
  it('é separada da sessão do jogo e só aceita UUID', () => {
    expect(twitchPartitionFor(A)).toBe(`persist:pokehubtw-${A}`);
    expect(() => twitchPartitionFor('../x')).toThrow();
    expect(partitionPath('/u', A, TWITCH_PREFIX)).toBe(resolve('/u', PARTITIONS_DIR, `pokehubtw-${A}`));
    expect(() => partitionPath('/u', A, '../')).toThrow();
  });
});

describe('TwitchStore', () => {
  const withStores = (fn: (twitch: TwitchStore, profiles: ProfileStore) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-twitch-'));
    const path = join(dir, 'app.sqlite');
    const profiles = new ProfileStore(path), twitch = new TwitchStore(path);
    try { fn(twitch, profiles); } finally { twitch.close(); profiles.close(); rmSync(dir, {recursive:true, force:true}); }
  };
  it('canal começa vazio, grava normalizado e recusa inválido', () => withStores(twitch => {
    expect(twitch.channel()).toBe('');
    expect(twitch.setChannel('https://twitch.tv/Canal_X')).toBe('canal_x');
    expect(twitch.channel()).toBe('canal_x');
    expect(() => twitch.setChannel('a b')).toThrow();
    expect(twitch.channel()).toBe('canal_x');
  }));
  it('um vínculo por perfil, ligado por padrão; atualiza só booleanos; some com o perfil', () => withStores((twitch, profiles) => {
    const profile = profiles.create({label:'Conta', emailLabel:'a@example.com', characterName:'', colorToken:'#d4a65f'});
    expect(() => twitch.link('00000000-0000-4000-8000-00000000abcd')).toThrow(); // perfil inexistente (chave estrangeira)
    expect(twitch.link(profile.id)).toEqual({profileId:profile.id, enabled:true, autoClaim:false, sound:false});
    twitch.link(profile.id); // de novo: não duplica
    expect(twitch.list()).toHaveLength(1);
    expect(twitch.update(profile.id, {autoClaim:true})).toMatchObject({enabled:true, autoClaim:true});
    expect(() => twitch.update(profile.id, {enabled:'sim'})).toThrow();
    expect(twitch.get(profile.id)).toMatchObject({enabled:true});
    profiles.remove(profile.id);
    expect(twitch.list()).toEqual([]);
  }));
  it('desvincular apaga a linha', () => withStores((twitch, profiles) => {
    const profile = profiles.create({label:'Conta', emailLabel:'a@example.com', characterName:'', colorToken:'#d4a65f'});
    twitch.link(profile.id); twitch.unlink(profile.id);
    expect(twitch.get(profile.id)).toBeNull();
  }));
});

describe('Kick', async () => {
  const { normalizeKickChannel, isAllowedKickNavigation, KICK_PROBE_SCRIPT } = await import('../domain/kick');
  const { PLATFORMS, isPlatform } = await import('../domain/streams');
  const { streamPartitionFor } = await import('../electron/partition');
  const { KICK_PREFIX } = await import('../electron/partition-wipe');
  it('canal: nome, link e slug com hífen', () => {
    expect(normalizeKickChannel('https://kick.com/Canal-Oficial')).toBe('canal-oficial');
    expect(normalizeKickChannel('@canal_x')).toBe('canal_x');
    for (const bad of ['a', 'https://evil.com/x', 'nome com espaço', null]) expect(normalizeKickChannel(bad)).toBeNull();
  });
  it('navegação só em https dentro de kick.com', () => {
    expect(isAllowedKickNavigation('https://kick.com/canal')).toBe(true);
    for (const bad of ['http://kick.com/', 'https://kick.com.evil.io/', 'https://notkick.com/']) expect(isAllowedKickNavigation(bad)).toBe(false);
  });
  it('script de leitura válido, sem clique, rede ou escrita', () => {
    expect(() => new Function(`return ${KICK_PROBE_SCRIPT}`)).not.toThrow();
    for (const banned of ['.click(', 'fetch(', 'innerHTML', 'localStorage']) expect(KICK_PROBE_SCRIPT).not.toContain(banned);
  });
  it('plataformas: sessões separadas e limite de banda só na Kick', () => {
    expect(isPlatform('kick')).toBe(true);
    expect(isPlatform('youtube')).toBe(false);
    expect(streamPartitionFor('pokehubkk-', A)).toBe(`persist:pokehubkk-${A}`);
    expect(partitionPath('/u', A, KICK_PREFIX)).toBe(resolve('/u', PARTITIONS_DIR, `pokehubkk-${A}`));
    expect(PLATFORMS.kick.throttleKbps).toBeGreaterThan(0);
    expect(PLATFORMS.twitch.throttleKbps).toBeNull();
    expect(PLATFORMS.kick.claimScript).toBeNull();
  });
  it('leitura: nome da conta só quando logada', () => {
    expect(sanitizeProbe({user:'Fulano_1'})?.user).toBe('fulano_1');
    expect(sanitizeProbe({user:'Fulano', loggedOut:true})?.user).toBeNull();
    expect(sanitizeProbe({user:'<img>'})?.user).toBeNull();
  });
  it('vínculos e canal da Kick independentes dos da Twitch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokehub-kick-'));
    const path = join(dir, 'app.sqlite');
    const profiles = new ProfileStore(path), twitch = new TwitchStore(path, 'twitch'), kick = new TwitchStore(path, 'kick');
    try {
      const p = profiles.create({label:'Conta', emailLabel:'a@example.com', characterName:'', colorToken:'#d4a65f'});
      kick.link(p.id); kick.setChannel('https://kick.com/Oficial-PI');
      expect(kick.channel()).toBe('oficial-pi');
      expect(twitch.channel()).toBe('');
      expect(twitch.list()).toEqual([]);
      expect(kick.list()).toHaveLength(1);
      profiles.remove(p.id);
      expect(kick.list()).toEqual([]);
    } finally { kick.close(); twitch.close(); profiles.close(); rmSync(dir, {recursive:true, force:true}); }
  });
});
