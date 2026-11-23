// Acesso remoto FALSO para a prévia (Gerenciar → Acesso remoto e o modal de pareamento). Só desenvolvimento.
// `?remote=pair` já abre o pareamento com código; `?remote=request` mostra o pedido do celular; `?remote=ca` o 1º pareamento (certificado).
import type { RemoteAlert, RemoteAuditEntry, RemoteDevice, RemoteStatus } from '../contracts/remote';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ok: true, data});

export function createMockRemote(mode: string | null) {
  const fp = '9F2A 77C1 0B3E D45A 6612 8E0C 3A9D F1B7 C4E8 2D50 91AB 7766 0C3F E812 4D9A B5C0';
  let status: RemoteStatus = {
    enabled: true, running: true, port: 8443, urls: ['https://192.168.0.12:8443'], error: null, network: {state: 'ok', label: 'Wi-Fi de casa'}, fingerprint: fp, caNotice: null, aclOk: true, notice: null, actionsDisabled: false,
    pairing: null, request: null, paired: null, pinSet: true, devices: 2, firstPairing: mode === 'ca', dailyCapGold: 200_000,
  };
  const pairing = () => ({code: 'K7QM-4XHD', codeHidden: false, expiresAt: Date.now() + 5 * 60_000, attemptsLeft: 5, attemptsByIp: [], caUrl: 'https://192.168.0.12:8443/ca.crt', iosUrl: 'https://192.168.0.12:8443/ca.mobileconfig', bootstrapUrl: `https://192.168.0.12:8443/#fp=${fp.replace(/ /g, '')}`, fingerprint: fp});
  const request = () => ({name: 'Celular de teste', nickname: '', ua: 'Android Chrome', ip: '192.168.0.31', sas: '4821', contested: false, since: Date.now(), deciding: false});
  if (mode === 'pair' || mode === 'ca') status = {...status, pairing: pairing()};
  if (mode === 'request') status = {...status, pairing: pairing(), request: request()};
  const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const devices: RemoteDevice[] = [{id: 'd1', name: 'Celular de teste', createdAt: iso(5000), lastSeen: iso(3), canAct: true, canControl: false, push: 1}, {id: 'd2', name: 'Tablet', createdAt: iso(9000), lastSeen: null, canAct: false, push: 0}];
  const audit: RemoteAuditEntry[] = [{id: 1, at: iso(3), deviceId: 'd1', action: 'push_teste', detail: null}, {id: 2, at: iso(60), deviceId: null, action: 'acesso_remoto_ligado', detail: null}];
  const alerts: RemoteAlert[] = [{id: 'a1', at: iso(4), kind: 'shiny', profileId: 'p1', label: 'Principal', text: 'Gastly Nv 31 · P5'}];
  const set = (patch: Partial<RemoteStatus>) => { status = {...status, ...patch}; return ok(status); };
  return {
    status: () => ok(status), enable: (value: boolean) => set({enabled: value, running: value}), pairStart: () => set({pairing: pairing()}), pairCancel: () => set({pairing: null, request: null}),
    decide: (allow: boolean) => set({request: null, paired: allow ? 'Celular de teste' : null}), setPin: () => set({pinSet: true}), clearPin: () => set({pinSet: false}),
    devices: () => ok(devices), revoke: () => ok(devices), audit: () => ok(audit), onChanged: () => () => undefined,
    allowNetwork: () => set({}), revealCode: () => set({}), setCanAct: () => ok(devices), reenableActions: () => set({actionsDisabled: false}), dismissNotice: () => set({notice: null}),
    pushTest: () => ok({sent: 1}), alerts: () => ok(alerts), purchases: () => ok({purchases: [], spend: [{profileId: 'p1', label: 'Principal', gold: 62_000, capGold: 200_000}], capGold: 200_000}), setCap: () => ok({purchases: [], spend: [], capGold: 200_000}),
  } satisfies Record<string, unknown> & {status: () => Promise<Result<RemoteStatus>>};
}
