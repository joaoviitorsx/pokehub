import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, downAccounts, mergeAlerts, mergeCaptures, normalizePrefs, pushState, resolveHash, safePushUrl, stepNota, subscriptionBody, urlBase64ToUint8Array, type PushEnv } from '../remote-ui/push-helpers';
import type { RemoteAlert, RemoteCapture } from '../remote-ui/r3-types';

const ID = '123e4567-e89b-12d3-a456-426614174000';
// carrega o service worker como texto e expõe as funções puras (ele é JS simples, servido de public/)
const listeners: Record<string, (e: unknown) => void> = {};
const sw = new Function('self', `${readFileSync('spike/remote-ui/public/sw.js', 'utf8')}\nreturn {pushSafeUrl, pushParse, pushView, PUSH_URL_RE};`)({addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }, location: {origin: 'https://pc'}}) as {pushSafeUrl: (u: unknown) => string; pushParse: (t: unknown) => {kind: string; label: string; text: string; url: string} | null; pushView: (p: unknown) => {title: string; options: {body: string; tag: string; renotify: boolean; data: {url: string}}}; PUSH_URL_RE: RegExp};

describe('service worker: allowlist de URL e payload', () => {
  it('aceita só #alertas, #contas e #conta/<uuid>', () => {
    for (const u of ['#alertas', '#contas', `#conta/${ID}`]) { expect(sw.pushSafeUrl(u)).toBe(u); expect(safePushUrl(u)).toBe(u); }
    for (const u of ['https://evil.example', '//evil', 'javascript:alert(1)', '#conta/abc', `#conta/${ID}/x`, `#conta/${ID.toUpperCase()}`, '#loja', '', '#alertas\n', null, 42, undefined]) { expect(sw.pushSafeUrl(u)).toBe('#alertas'); expect(safePushUrl(u)).toBe('#alertas'); }
  });
  it('a regex do sw e a do app são a mesma', () => { expect(sw.PUSH_URL_RE.source).toBe(/^#(alertas|contas|conta\/[0-9a-f-]{36})$/.source); });
  it('lê o payload com segurança: JSON ruim, grande, tipo desconhecido', () => {
    expect(sw.pushParse('')).toBeNull(); expect(sw.pushParse('{ruim')).toBeNull(); expect(sw.pushParse('null')).toBeNull(); expect(sw.pushParse(undefined)).toBeNull();
    expect(sw.pushParse(JSON.stringify({kind: 'hack', label: 'x', text: 'y'}))).toBeNull(); expect(sw.pushParse(JSON.stringify({kind: '__proto__'}))).toBeNull();
    expect(sw.pushParse(JSON.stringify({kind: 'shiny', label: 'A', text: 'x'.repeat(5000)}))).toBeNull();
    expect(sw.pushParse(JSON.stringify({kind: 'shiny', label: 'L'.repeat(500), text: 'T'.repeat(900), url: 'https://x'}))).toMatchObject({kind: 'shiny', url: '#alertas'});
    expect(sw.pushParse(JSON.stringify({kind: 'shiny', label: 'L'.repeat(500), text: 'T'.repeat(900)}))!.label).toHaveLength(60);
    expect(sw.pushParse(JSON.stringify({kind: 'p5', label: 1, text: {}}))).toMatchObject({label: '', text: ''});
  });
  it('título por tipo, corpo "conta: texto", tag por tipo+conta, sem renotify', () => {
    const titles = {shiny: '✨ Shiny capturado!', p5: 'P5 capturado', recorde: 'Recorde!', nota: 'Nota alta', conta_caiu: 'Conta caiu', conta_voltou: 'Conta voltou'};
    for (const [kind, title] of Object.entries(titles)) expect(sw.pushView(sw.pushParse(JSON.stringify({kind, label: 'Principal', text: 'Gastly Nv 31', url: `#conta/${ID}`})))).toMatchObject({title, options: {body: 'Principal: Gastly Nv 31', tag: `${kind}:${ID}`, renotify: false, data: {url: `#conta/${ID}`}}});
    expect(sw.pushView(sw.pushParse(JSON.stringify({kind: 'recorde', label: 'A', text: 'b'})))!.options.tag).toBe('recorde:geral');
    expect(sw.pushView(null)).toMatchObject({title: 'PokéHub', options: {data: {url: '#alertas'}}}); // push sem payload legível ainda mostra algo
  });
  it('mantém o pareamento (X-PH-SW) e não faz cache de /api', () => {
    const text = readFileSync('spike/remote-ui/public/sw.js', 'utf8');
    expect(text).toContain("'X-PH-SW', '1'"); expect(text).not.toMatch(/caches\.|cache\.put|CacheStorage/);
    expect((text.match(/addEventListener\('fetch'/g) ?? []).length).toBe(1);
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['install', 'activate', 'fetch', 'push', 'notificationclick']));
  });
  it('notificationclick: foca a janela aberta e manda a URL validada; senão abre a janela', async () => {
    const calls: unknown[] = [];
    const run = async (clients: unknown[], url: unknown) => {
      calls.length = 0; let wait: Promise<void> = Promise.resolve();
      const self = {location: {origin: 'https://pc'}, clients: {matchAll: async () => clients, openWindow: async (u: string) => { calls.push(['open', u]); }}, addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }};
      new Function('self', `${readFileSync('spike/remote-ui/public/sw.js', 'utf8')}`)(self);
      listeners.notificationclick!({notification: {close: () => calls.push('close'), data: {url}}, waitUntil: (p: Promise<void>) => { wait = p; }}); await wait; return [...calls];
    };
    const client = {url: 'https://pc/', focus: async () => { calls.push('focus'); }, postMessage: (m: unknown) => calls.push(['msg', m])};
    expect(await run([client], `#conta/${ID}`)).toEqual(['close', 'focus', ['msg', {type: 'ph-nav', url: `#conta/${ID}`}]]);
    expect(await run([{...client, url: 'https://outro/'}], '#contas')).toEqual(['close', ['open', '/#contas']]);
    expect(await run([], 'https://evil')).toEqual(['close', ['open', '/#alertas']]);
  });
});

describe('helpers do app', () => {
  it('urlBase64ToUint8Array: base64url com e sem padding', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]); expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]); expect([...urlBase64ToUint8Array('')]).toEqual([]);
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'; expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
  it('prefs: valida, arredonda e cai no padrão', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS); expect(normalizePrefs({prefs: {shiny: false, notaMin: 3.7}})).toEqual({...DEFAULT_PREFS, shiny: false, notaMin: 3.5});
    expect(normalizePrefs({shiny: 'sim', p5: 0, notaMin: -2, contaCaiu: false})).toEqual({...DEFAULT_PREFS, contaCaiu: false}); expect(normalizePrefs({notaMin: 1e9}).notaMin).toBe(50); expect(normalizePrefs({notaMin: NaN}).notaMin).toBeNull();
    expect([stepNota(null, 1), stepNota(0, -1), stepNota(50, 1), stepNota(2, -1)]).toEqual([3.5, 0, 50, 1.5]);
  });
  const env = (o: Partial<PushEnv> = {}): PushEnv => ({secure: true, hasSw: true, hasPush: true, hasNotification: true, permission: 'default', subscribed: false, ios: false, standalone: false, ...o});
  it('estado das notificações', () => {
    expect(pushState(env())).toBe('off'); expect(pushState(env({permission: 'granted', subscribed: true}))).toBe('on'); expect(pushState(env({permission: 'granted'}))).toBe('off');
    expect(pushState(env({permission: 'denied'}))).toBe('denied'); expect(pushState(env({hasPush: false}))).toBe('unsupported');
    expect(pushState(env({secure: false}))).toBe('insecure'); expect(pushState(env({hasSw: false}))).toBe('insecure');
    expect(pushState(env({ios: true, hasPush: false}))).toBe('install-ios'); expect(pushState(env({ios: true, standalone: true}))).toBe('off');
  });
  it('assinatura: só https com as duas chaves', () => {
    expect(subscriptionBody({endpoint: 'https://fcm.googleapis.com/x', keys: {p256dh: 'a', auth: 'b'}})).toEqual({endpoint: 'https://fcm.googleapis.com/x', keys: {p256dh: 'a', auth: 'b'}});
    expect(subscriptionBody({endpoint: 'http://x', keys: {p256dh: 'a', auth: 'b'}})).toBeNull(); expect(subscriptionBody({endpoint: 'https://x', keys: {p256dh: 'a'}})).toBeNull(); expect(subscriptionBody(null)).toBeNull();
  });
  const cap = (o: Partial<RemoteCapture>): RemoteCapture => ({profileId: 'a', name: 'Eevee', level: 1, time: '10:00', at: '2026-11-23T10:00:00.000Z', potencia: null, iv: null, quality: null, nota: null, shiny: false, record: false, label: 'A', color: '#fff', ...o});
  const al = (o: Partial<RemoteAlert>): RemoteAlert => ({id: '1', at: '2026-11-23T10:00:00.000Z', kind: 'shiny', profileId: 'a', label: 'A', text: 't', ...o});
  it('junta capturas e alertas sem repetir, do mais novo ao mais antigo', () => {
    const merged = mergeCaptures([cap({name: 'B', at: '2026-11-23T11:00:00.000Z'})], [cap({}), cap({name: 'B', at: '2026-11-23T11:00:00.000Z'})]); expect(merged.map(c => c.name)).toEqual(['B', 'Eevee']);
    expect(mergeAlerts([al({id: '2', at: '2026-11-23T12:00:00.000Z'})], [al({}), al({id: '2'})]).map(a => a.id)).toEqual(['2', '1']);
  });
  it('conta caída = último aviso de estado é conta_caiu', () => {
    expect([...downAccounts([al({id: '1', kind: 'conta_caiu', at: '2026-11-23T10:00:00.000Z'}), al({id: '2', kind: 'conta_caiu', profileId: 'b', at: '2026-11-23T10:00:00.000Z'}), al({id: '3', kind: 'conta_voltou', profileId: 'b', at: '2026-11-23T11:00:00.000Z'}), al({id: '4', kind: 'shiny', profileId: 'c'})])]).toEqual(['a']);
  });
  it('links diretos', () => {
    expect(resolveHash('#alertas')).toEqual({tab: 'alertas'}); expect(resolveHash('#contas')).toEqual({tab: 'contas'}); expect(resolveHash(`#conta/${ID}`)).toEqual({tab: 'conta', account: ID});
    expect(resolveHash('#conta/xx')).toEqual({tab: 'contas'}); expect(resolveHash('#loja')).toEqual({tab: 'contas'}); expect(resolveHash('#saude')).toEqual({tab: 'contas'}); expect(resolveHash('#mercado')).toEqual({tab: 'mercado'}); expect(resolveHash('#conta')).toEqual({tab: 'conta'});
  });
});
