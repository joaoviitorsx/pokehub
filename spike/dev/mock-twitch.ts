// Prévia no navegador: finge a Twitch em segundo plano (window.pokehub.twitch). Só para desenvolvimento. ?twitch=0 começa sem nada vinculado.
import type { StreamPlatform, TwitchAccount, TwitchInfo } from '../contracts/twitch';
import { normalizeChannel } from '../domain/twitch';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
function createMockPlatform(platform: StreamPlatform, profileIds: () => string[], fresh: boolean) {
  const ids = profileIds();
  let channel = fresh || platform === 'kick' ? '' : 'canal_oficial';
  const base = (profileId: string): TwitchAccount => ({profileId, enabled: true, autoClaim: false, sound: false, login: null, state: 'login', balance: null, earned: 0, claimed: 0, since: null, visible: false});
  let accounts: TwitchAccount[] = fresh || platform === 'kick' ? [] : [
    {...base(ids[0]!), login: 'ash_ketchum', state: 'watching', balance: 12_340, earned: 450, claimed: 3, autoClaim: true, since: new Date(Date.now() - 83 * 60_000).toISOString()},
    ...(ids[1] ? [{...base(ids[1]), login: 'brock_rocks', state: 'offline' as const, balance: 2_875}] : []),
    ...(ids[2] ? [{...base(ids[2])}] : []),
  ];
  const listeners = new Set<(info: TwitchInfo) => void>();
  const info = (): TwitchInfo => ({platform, channel, accounts: accounts.filter(a => profileIds().includes(a.profileId)).map(a => ({...a, state: !channel && a.enabled ? 'no_channel' : a.state}))});
  const reply = (): Promise<Result<TwitchInfo>> => new Promise(resolve => setTimeout(() => { const data = info(); listeners.forEach(l => l(data)); resolve({ok: true, data}); }, 60));
  const patch = (id: string, change: Partial<TwitchAccount>) => { accounts = accounts.map(a => a.profileId === id ? {...a, ...change} : a); };
  // saldo subindo enquanto "assiste": 10 pontos a cada 5 s na prévia
  setInterval(() => { let changed = false; accounts = accounts.map(a => a.state === 'watching' && channel ? (changed = true, {...a, balance: (a.balance ?? 0) + 10, earned: a.earned + 10}) : a); if (changed) { const data = info(); listeners.forEach(l => l(data)); } }, 5000);
  return {
    get: reply,
    setChannel: (value: string) => { const next = normalizeChannel(value); if (next === null) return Promise.resolve({ok: false as const, error: 'Nome de canal inválido. Use o nome (ex.: canal_oficial) ou o link twitch.tv/…'}); channel = next; return reply(); },
    link: (id: string) => { if (!accounts.some(a => a.profileId === id)) accounts = [...accounts, base(id)]; patch(id, {visible: true}); setTimeout(() => { patch(id, {login: `conta_${id.slice(-2)}`, state: 'starting'}); void reply(); setTimeout(() => { patch(id, {state: 'watching', balance: 100, since: new Date().toISOString()}); void reply(); }, 2500); }, 2500); return reply(); },
    unlink: (id: string) => { accounts = accounts.filter(a => a.profileId !== id); return reply(); },
    update: (id: string, change: Partial<Pick<TwitchAccount, 'enabled' | 'autoClaim' | 'sound'>>) => { patch(id, change); if (change.enabled === false) patch(id, {state: 'off', since: null}); if (change.enabled === true) patch(id, {state: accounts.find(a => a.profileId === id)?.login ? 'watching' : 'login', since: new Date().toISOString()}); return reply(); },
    show: (id: string) => { patch(id, {visible: true}); return reply(); },
    hide: (id: string) => { patch(id, {visible: false}); return reply(); },
    rewards: (id: string) => { patch(id, {visible: true}); return reply(); },
    onChanged: (callback: (info: TwitchInfo) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}

/** As duas plataformas atrás da mesma API do preload (`window.pokehub.streams`). */
export function createMockStreams(profileIds: () => string[], fresh: boolean) {
  const all = {twitch: createMockPlatform('twitch', profileIds, fresh), kick: createMockPlatform('kick', profileIds, fresh)};
  const pick = (platform: StreamPlatform) => all[platform];
  return {
    get: (p: StreamPlatform) => pick(p).get(), setChannel: (p: StreamPlatform, v: string) => pick(p).setChannel(v), link: (p: StreamPlatform, id: string) => pick(p).link(id),
    unlink: (p: StreamPlatform, id: string) => pick(p).unlink(id), update: (p: StreamPlatform, id: string, patch: Partial<Pick<TwitchAccount, 'enabled' | 'autoClaim' | 'sound'>>) => pick(p).update(id, patch),
    show: (p: StreamPlatform, id: string) => pick(p).show(id), hide: (p: StreamPlatform, id: string) => pick(p).hide(id), rewards: (p: StreamPlatform, id: string) => pick(p).rewards(id),
    onChanged: (callback: (info: TwitchInfo) => void) => { const a = all.twitch.onChanged(callback), b = all.kick.onChanged(callback); return () => { a(); b(); }; },
  };
}
