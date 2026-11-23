import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_HOSTS, createNetworkPolicyStore, createUnknownLog, decide, hostMatches, hostOf, normalizeHost, type NetworkPolicy } from '../electron/network-policy';

const registrar: NetworkPolicy = {mode: 'registrar', allowlist: []};
const bloquear: NetworkPolicy = {mode: 'bloquear', allowlist: []};

describe('normalizeHost', () => {
  it('minúsculas, sem ponto final, punycode e curinga explícito', () => {
    expect(normalizeHost('PokeIdle.IO.')).toBe('pokeidle.io');
    expect(normalizeHost('  Exemplo.COM ')).toBe('exemplo.com');
    expect(normalizeHost('bücher.example')).toBe('xn--bcher-kva.example');
    expect(normalizeHost('*.CDN.Example.com')).toBe('*.cdn.example.com');
    expect(normalizeHost('*.com')).toBeNull();
    for (const bad of ['', ' ', 'a b', 'a/b', 'http://x.com', 'x.com:80', '-a.com', '*', '*.', 'a..com', 'x.com/path']) expect(normalizeHost(bad)).toBeNull();
    expect(normalizeHost(42 as unknown as string)).toBeNull();
    expect(normalizeHost(`${'a'.repeat(250)}.com`)).toBeNull();
  });
  it('hostMatches: exato ou *.dominio (só subdomínios, nunca o apex nem sufixo de texto)', () => {
    expect(hostMatches('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(hostMatches('example.com', ['*.example.com'])).toBe(false);
    expect(hostMatches('badexample.com', ['*.example.com'])).toBe(false);
    expect(hostMatches('example.com', ['example.com'])).toBe(true);
    expect(hostMatches('sub.example.com', ['example.com'])).toBe(false);
    expect(hostMatches('x.com', [])).toBe(false);
  });
});

describe('decide(url, policy, approved)', () => {
  it('libera o jogo, subdomínios dele e o login Google/Discord (dados em BASE_HOSTS)', () => {
    for (const url of ['https://pokeidle.io/app', 'https://POKEIDLE.io:443/x', 'wss://pokeidle.io/socket', 'https://api.pokeidle.io/x', 'https://a.b.pokeidle.io/', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://discord.com/oauth2/authorize', 'https://cdn.discordapp.com/x.png']) expect(decide(url, bloquear), url).toBe('allow');
    expect(BASE_HOSTS).toContain('accounts.google.com');
  });
  it('não confunde parecidos nem usuário@host', () => {
    for (const url of ['https://pokeidle.io.evil.example/', 'https://evilpokeidle.io/', 'https://pokeidle.io@evil.example/', 'https://evil.example/?u=pokeidle.io', 'https://pokeidle.io.', 'https://notdiscord.com/']) expect(decide(url, bloquear), url).toBe(url === 'https://pokeidle.io.' ? 'allow' : 'block');
  });
  it('esquemas: chrome-extension, devtools, data, blob passam; o resto é cancelado', () => {
    for (const url of ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/a.js', 'devtools://devtools/bundled/x.js', 'data:image/png;base64,AAAA', 'blob:https://pokeidle.io/1-2-3']) expect(decide(url, bloquear), url).toBe('allow');
    for (const url of ['ftp://pokeidle.io/x', 'file:///c:/x', 'javascript:alert(1)', 'chrome://settings', 'not a url', '']) expect(decide(url, registrar), url).toBe('block');
  });
  it('host desconhecido: registrar anota (record), bloquear cancela', () => {
    expect(decide('https://cdn.novo.example/x.js', registrar)).toBe('record');
    expect(decide('wss://cdn.novo.example/s', registrar)).toBe('record');
    expect(decide('https://cdn.novo.example/x.js', bloquear)).toBe('block');
  });
  it('punycode: a URL já chega em ASCII e o IDN digitado casa com a allowlist normalizada', () => {
    const policy: NetworkPolicy = {mode: 'bloquear', allowlist: [normalizeHost('bücher.example') ?? '']};
    expect(decide('https://bücher.example/x', policy)).toBe('allow');
    expect(decide('https://xn--bcher-kva.example/x', policy)).toBe('allow');
    expect(decide('https://sub.xn--bcher-kva.example/x', policy)).toBe('block');
    expect(hostOf('https://BÜCHER.example/x')).toBe('xn--bcher-kva.example');
  });
  it('allowlist do usuário: exato ou *.dominio explícito', () => {
    const policy: NetworkPolicy = {mode: 'bloquear', allowlist: ['cdn.exemplo.com', '*.static.example.net']};
    expect(decide('https://cdn.exemplo.com/a', policy)).toBe('allow');
    expect(decide('https://x.cdn.exemplo.com/a', policy)).toBe('block');
    expect(decide('https://a.static.example.net/a', policy)).toBe('allow');
    expect(decide('https://static.example.net/a', policy)).toBe('block');
  });
  it('hosts aprovados das extensões carregadas na sessão', () => {
    expect(decide('https://pokeidleguide.io/api', bloquear, [])).toBe('block');
    expect(decide('https://pokeidleguide.io/api', bloquear, ['pokeidleguide.io', 'pokeidle-gg.pages.dev'])).toBe('allow');
    expect(decide('https://api.pokeidleguide.io/api', bloquear, ['pokeidleguide.io'])).toBe('block'); // só o host exato
    expect(decide('https://PokeIdleGuide.io/api', bloquear, ['POKEIDLEGUIDE.io'])).toBe('allow');
    expect(decide('https://x.example/', bloquear, ['', '??'])).toBe('block'); // aprovados inválidos não liberam nada
  });
  it('IP literal e porta', () => {
    expect(decide('http://203.0.113.9:8080/x', bloquear)).toBe('block');
    expect(decide('http://[::1]:3000/x', registrar)).toBe('record');
    expect(decide('http://203.0.113.9/x', {mode: 'bloquear', allowlist: ['203.0.113.9']})).toBe('allow');
  });
});

describe('armazenamento network-policy.json e registro de hosts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pokehub-net-'));
  afterAll(() => rmSync(dir, {recursive: true, force: true}));
  it('padrão registrar; persiste modo e allowlist normalizada de forma atômica; ignora arquivo inválido', () => {
    const file = join(dir, 'a', 'network-policy.json');
    const store = createNetworkPolicyStore(file);
    expect(store.policy()).toEqual({mode: 'registrar', allowlist: []});
    store.setMode('bloquear');
    expect(store.allow('CDN.Exemplo.com.')).toBe('cdn.exemplo.com');
    store.allow('cdn.exemplo.com'); store.allow('*.Static.Example.net');
    expect(() => store.allow('a b')).toThrow();
    expect(() => store.setMode('x')).toThrow();
    expect(() => store.allow(1)).toThrow();
    const again = createNetworkPolicyStore(file);
    expect(again.policy()).toEqual({mode: 'bloquear', allowlist: ['*.static.example.net', 'cdn.exemplo.com']});
    expect(() => readFileSync(`${file}.tmp`)).toThrow(); // o temporário foi renomeado
    again.disallow('cdn.exemplo.com');
    expect(createNetworkPolicyStore(file).policy().allowlist).toEqual(['*.static.example.net']);
    writeFileSync(file, '{lixo');
    expect(createNetworkPolicyStore(file).policy()).toEqual({mode: 'registrar', allowlist: []});
    writeFileSync(file, JSON.stringify({mode: 'qualquer', allowlist: ['ok.com', 5, 'a b', '*.com']}));
    expect(createNetworkPolicyStore(file).policy()).toEqual({mode: 'registrar', allowlist: ['ok.com']});
  });
  it('registro por conta: contagem, primeira vez, ordenação, limite e esquecer ao permitir', () => {
    let clock = 1000;
    const log = createUnknownLog(() => clock++);
    log.record('a', 'cdn.x.example'); log.record('a', 'cdn.x.example'); log.record('b', 'cdn.x.example'); log.record('a', 'z.example');
    const rows = log.list(account => account === 'a' ? 'Conta A' : 'Conta B');
    expect(rows[0]).toEqual({host: 'cdn.x.example', account: 'a', accountName: 'Conta A', count: 2, firstSeen: 1000});
    expect(rows.map(row => `${row.host}/${row.account}/${row.count}`)).toEqual(['cdn.x.example/a/2', 'cdn.x.example/b/1', 'z.example/a/1']);
    log.forget('cdn.x.example');
    expect(log.list(account => account).map(row => row.host)).toEqual(['z.example']);
    log.forget('*.example');
    expect(log.list(account => account)).toEqual([]);
    for (let i = 0; i < 600; i++) log.record('a', `h${i}.example`);
    expect(log.list(account => account)).toHaveLength(500);
  });
});
