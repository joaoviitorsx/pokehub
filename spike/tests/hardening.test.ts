import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dangerousSwitches, restrictUserData } from '../electron/hardening';

describe('chaves de depuração', () => {
  it('lista só as perigosas presentes', () => {
    expect(dangerousSwitches(() => false)).toEqual([]);
    expect(dangerousSwitches(name => name === 'inspect' || name === 'remote-debugging-port')).toEqual(['remote-debugging-port', 'inspect']);
    expect(dangerousSwitches(() => true)).toEqual(['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-port']);
    expect(dangerousSwitches(name => name === 'disable-features')).toEqual([]);
  });
});
describe('pasta de dados', () => {
  it('aplica 0700 só no Linux e ignora erros', () => {
    const calls: [string, number][] = [];
    restrictUserData('/x', 'linux', (path, mode) => { calls.push([path, mode]); });
    restrictUserData('C:/x', 'win32', (path, mode) => { calls.push([path, mode]); });
    expect(calls).toEqual([['/x', 0o700]]);
    expect(() => restrictUserData('/x', 'linux', () => { throw new Error('EPERM'); })).not.toThrow();
  });
});
describe('CSP do renderer', () => {
  const html = readFileSync('index.html', 'utf8');
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  it.each(["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "connect-src 'none'"])('contém %s', directive => {
    expect(csp.split(';').map(part => part.trim())).toContain(directive);
  });
});
