import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import webpush from 'web-push';
import { createRemoteHub } from '../remote/hub';

/*
 * Verificação de EMPACOTAMENTO do acesso remoto (só roda dentro do smoke, com POKEHUB_SMOKE=1 + pasta temporária): confere que `web-push`
 * resolve dentro do asar, sobe um hub próprio em 127.0.0.1 com porta efêmera (banco/certificados na pasta do smoke, nunca nos dados reais),
 * busca `/`, `/manifest.webmanifest` (o servidor serve remote.html só em `/`) e um `/assets/*.js`, e confere que `/api/state` e o upgrade de WebSocket sem cookie são recusados.
 */
export interface RemoteSmoke { ok: boolean; checks: Record<string, boolean | string> }

const get = (port: number, path: string, headers: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
  const req = request({host: '127.0.0.1', port, path, method: 'GET', rejectUnauthorized: false, timeout: 8000, headers: {Host: `127.0.0.1:${port}`, ...headers}}, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
});
const upgrade = (port: number, path: string) => new Promise<string>(resolve => {
  const req = request({host: '127.0.0.1', port, path, method: 'GET', rejectUnauthorized: false, timeout: 8000, headers: {Host: `127.0.0.1:${port}`, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol': 'ph.v1', Origin: `https://127.0.0.1:${port}`}}, res => { res.resume(); resolve(`rejected:${res.statusCode}`); });
  req.on('upgrade', (_res, socket) => { socket.destroy(); resolve('accepted'); });
  req.on('timeout', () => req.destroy()); req.on('error', () => resolve('rejected:closed')); req.end();
});

export async function remoteSmoke(dir: string, uiDir: string, iconPath: string): Promise<RemoteSmoke> {
  const checks: RemoteSmoke['checks'] = {};
  const fail = (name: string, error: unknown) => { checks[name] = `erro: ${(error as Error).message}`.slice(0, 200); };
  try { const keys = webpush.generateVAPIDKeys(); checks.webPushVapid = typeof keys.publicKey === 'string' && keys.publicKey.length > 40 && typeof keys.privateKey === 'string' && keys.privateKey.length > 20; } catch (error) { fail('webPushVapid', error); }
  const root = join(dir, 'remote-smoke'); mkdirSync(root, {recursive: true});
  const hub = createRemoteHub({
    dbPath: join(root, 'remote.sqlite'), dir: join(root, 'remote'), uiDir, iconPath, portOverride: 0, certOptions: {restrict: false}, networkPollMs: 3_600_000,
    net: async () => ({binds: [], subnets: [], pin: 'smoke', label: 'smoke', source: 'subnet' as const}),
    api: {accounts: () => [], hunt: async () => ({}), market: async () => ({}), diag: () => ({})},
    running: () => 0, blocker: {start: () => 1, stop: () => undefined},
    screen: {target: () => null},
  });
  try {
    await hub.setEnabled(true);
    const port = hub.status().port;
    checks.started = hub.status().running && port > 0;
    if (checks.started) {
      try {
        const asset = readdirSync(join(uiDir, 'assets')).find(name => name.endsWith('.js'));
        const sw = readFileSync(join(uiDir, 'sw.js'), 'utf8').length > 0;
        const [root200, html200, asset200, sw200, state] = await Promise.all([get(port, '/'), get(port, '/manifest.webmanifest'), asset ? get(port, `/assets/${asset}`) : Promise.resolve(0), get(port, '/sw.js'), get(port, '/api/state')]);
        checks.root = root200 === 200; checks.manifest = html200 === 200; checks.assetJs = asset200 === 200; checks.swJs = sw && sw200 === 200; checks.apiStateUnauthorized = state === 401;
        checks.wsNoCookieRejected = (await upgrade(port, '/api/screen/x')).startsWith('rejected:');
      } catch (error) { fail('http', error); }
    }
  } catch (error) { fail('start', error); }
  try { await hub.close(); checks.stopped = true; } catch (error) { fail('stopped', error); }
  return {ok: Object.values(checks).every(value => value === true), checks};
}
