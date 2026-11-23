// Orquestra o acesso remoto: liga/desliga o servidor, certificados, pareamento (com o pedido "Permitir?" na janela do PC),
// PIN, aparelhos, auditoria e o bloqueio do sono. Sem Electron: tudo entra por `deps` (testável).
import { join } from 'node:path';
import { lanAddresses } from './ip';
import { ensureCerts, type CertSet } from './certs';
import { Pairing, PinGuard, createPowerGuard, formatCode, hashPin, validPin, type Blocker } from './guards';
import { createRemoteServer, type RemoteApi, type RemoteServer } from './server';
import { RemoteStore, validPort, type AuditRow, type DeviceRow } from './store';
import type { RemoteStatus } from '../contracts/remote';

export interface HubDeps {
  dbPath: string; dir: string; uiDir: string; iconPath: string; api: RemoteApi; running(): number; blocker: Blocker;
  lan?: () => string[]; now?: () => number; onChange?: () => void; onPairRequest?: () => void; certOptions?: {restrict?: boolean};
  networkPollMs?: number; requestTimeoutMs?: number; portOverride?: number;
}
export class RemoteUserError extends Error {}
const MSG_START = 'Não foi possível ligar o acesso remoto. Verifique se a porta está livre e se há rede privada (Wi-Fi de casa).';

export function createRemoteHub(deps: HubDeps) {
  const now = deps.now ?? Date.now, lan = deps.lan ?? lanAddresses;
  const store = new RemoteStore(deps.dbPath);
  const pairing = new Pairing(now), power = createPowerGuard(deps.blocker);
  const iso = () => new Date(now()).toISOString();
  const pin = new PinGuard(() => store.getPinHash(), now, id => { try { store.audit(id, 'pin_bloqueado', null, iso()); } catch { /* auditoria */ } });
  let server: RemoteServer | null = null, certs: (CertSet & {created: boolean}) | null = null, addresses: string[] = [], port = 0, error: string | null = null;
  let request: {name: string; ip: string; resolve: (allow: boolean) => void; timer: ReturnType<typeof setTimeout>} | null = null;
  let paired: string | null = null, poll: ReturnType<typeof setInterval> | undefined, closed = false;
  const changed = () => { try { deps.onChange?.(); } catch { /* ouvinte */ } };
  const audit = (deviceId: string | null, action: string, detail: string | null = null) => { try { store.audit(deviceId, action, detail, iso()); } catch { /* auditoria */ } };

  const confirmPair = (info: {name: string; ip: string}) => new Promise<boolean>(resolve => {
    const settle = (allow: boolean) => { if (!request) return; clearTimeout(request.timer); request = null; if (allow) paired = info.name; resolve(allow); changed(); };
    request = {...info, resolve: settle, timer: setTimeout(() => settle(false), deps.requestTimeoutMs ?? 60_000)};
    changed(); try { deps.onPairRequest?.(); } catch { /* janela */ }
  });
  const baseUrl = () => addresses[0] ? `https://${addresses[0]}:${port}` : null;

  async function start(): Promise<void> {
    if (server || closed) return;
    const found = lan();
    const bind = [...found, '127.0.0.1'];
    try { certs = ensureCerts(join(deps.dir), found, deps.certOptions); } catch { error = MSG_START; changed(); throw new RemoteUserError(MSG_START); } // a chave da CA fica só em disco (0600)
    const wanted = deps.portOverride ?? store.getPort();
    const current = certs;
    const created = createRemoteServer({store, certs: () => current, api: deps.api, pairing, pin, confirmPair, uiDir: deps.uiDir, iconPath: deps.iconPath, now});
    try { port = await created.listen(bind, wanted); } catch { error = MSG_START; changed(); throw new RemoteUserError(MSG_START); }
    server = created; addresses = found.length ? found : ['127.0.0.1']; error = null;
    poll = setInterval(() => { // a rede mudou (outro Wi-Fi, IP novo)? reabre nos endereços atuais e renova o certificado
      const next = lan();
      if (next.length && (next.length !== found.length || next.some((ip, i) => ip !== found[i]))) void restart();
    }, deps.networkPollMs ?? 30_000);
    poll.unref();
    audit(null, 'acesso_remoto_ligado');
    changed();
  }
  async function stop(): Promise<void> {
    clearInterval(poll); poll = undefined;
    pairing.cancel();
    request?.resolve(false);
    const current = server; server = null;
    await current?.close();
    changed();
  }
  async function restart() { await stop(); try { await start(); } catch { /* o erro fica no status */ } }

  return {
    store, pin,
    async boot(): Promise<void> { if (store.getEnabled()) { try { await start(); } catch { /* status.error */ } } power.update(store.getEnabled(), deps.running()); },
    async setEnabled(value: boolean): Promise<void> {
      if (value) { await start(); store.setEnabled(true); } else { store.setEnabled(false); await stop(); audit(null, 'acesso_remoto_desligado'); }
      power.update(value, deps.running()); changed();
    },
    enabled: () => !closed && store.getEnabled(),
    isListening: () => server?.listening() ?? false,
    status(): RemoteStatus {
      const info = pairing.info(), base = baseUrl();
      return {
        enabled: store.getEnabled(), running: server?.listening() ?? false, port: port || store.getPort(), urls: addresses.map(ip => `https://${ip}:${port}`), error,
        pairing: info && base ? {code: formatCode(info.code), expiresAt: info.expiresAt, attemptsLeft: info.attemptsLeft, caUrl: `${base}/ca.crt`, iosUrl: `${base}/ca.mobileconfig`} : null,
        request: request ? {name: request.name, ip: request.ip} : null, paired, pinSet: store.getPinHash() !== null, devices: store.countDevices(), firstPairing: store.countDevices() === 0,
        dailyCapGold: store.getDailyCapGold(),
      };
    },
    startPairing(): RemoteStatus { if (!server) throw new RemoteUserError('Ligue o acesso remoto primeiro.'); pairing.start(); paired = null; audit(null, 'pareamento_iniciado'); changed(); return this.status(); },
    cancelPairing(): void { pairing.cancel(); request?.resolve(false); changed(); },
    decide(allow: boolean): void { request?.resolve(allow === true); },
    setPin(value: unknown): void { if (!validPin(value)) throw new RemoteUserError('O PIN precisa ter 6 dígitos.'); store.setPinHash(hashPin(value)); pin.reset(); audit(null, 'pin_definido'); changed(); },
    clearPin(): void { store.setPinHash(null); pin.reset(); audit(null, 'pin_removido'); changed(); },
    devices: (): DeviceRow[] => store.listDevices(),
    audit: (): AuditRow[] => store.listAudit(100),
    revoke(id: unknown): boolean { if (typeof id !== 'string') return false; const ok = server ? server.revoke(id) : store.revokeDevice(id); if (ok) audit(id, 'aparelho_revogado'); changed(); return ok; },
    setPort(value: unknown): void { if (!validPort(value)) throw new RemoteUserError('Porta inválida.'); store.setPort(value); },
    publish: (event: string, data: unknown) => server?.publish(event, data),
    updatePower: () => !closed && power.update(store.getEnabled() && server !== null, deps.running()),
    async close(): Promise<void> { if (closed) return; closed = true; const done = stop(); power.update(false, 0); try { store.close(); } catch { /* já fechado */ } await done; }, // o banco fecha já (sem esperar a porta); a porta fecha junto
  };
}
export type RemoteHub = ReturnType<typeof createRemoteHub>;
