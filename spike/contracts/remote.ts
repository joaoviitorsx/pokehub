import type { Capture } from '../domain/captures';
// Estado do acesso remoto mostrado em Gerenciar → Acesso remoto. Nunca carrega chaves, tokens, hashes nem caminhos de arquivo.
export interface RemotePairing {
  /** Código legível; vazio enquanto oculto (1º pareamento: só depois de conferir a impressão digital no celular). */
  code: string; codeHidden: boolean; expiresAt: number; attemptsLeft: number; attemptsByIp: {ip: string; wrong: number; left: number}[];
  caUrl: string; iosUrl: string; /** https://IP:porta/#fp=<sha256>: o QR da primeira visita (CA primeiro) */ bootstrapUrl: string; fingerprint: string;
}
export interface RemoteRequest { name: string; nickname: string; ua: string; ip: string; sas: string; contested: boolean; since: number; deciding: boolean }
export interface RemoteStatus {
  enabled: boolean; running: boolean; port: number; urls: string[]; error: string | null;
  /** `rede_nova`: a rede mudou e o servidor parou até o usuário liberar; `sem_rede`: sem rede privada no momento. */
  network: {state: 'ok' | 'rede_nova' | 'sem_rede'; label: string};
  /** SHA-256 da CA em blocos de 4 (conferir com o celular). */
  fingerprint: string | null; caNotice: string | null; aclOk: boolean; notice: string | null; actionsDisabled: boolean;
  pairing: RemotePairing | null; request: RemoteRequest | null; paired: string | null;
  pinSet: boolean; devices: number; firstPairing: boolean; dailyCapGold: number;
}
export interface RemoteDevice { id: string; name: string; createdAt: string; lastSeen: string | null; canAct: boolean; /** Assinaturas de push ativas deste aparelho (0–2) */ push?: number }
export interface RemoteAuditEntry { id: number; at: string; deviceId: string | null; action: string; detail: string | null }

// --- R3: capturas, alertas e Web Push (contrato com o app do celular) ---
/** Captura entregue ao celular: nome/cor da conta vêm do servidor; NUNCA inclui emailLabel nem as dicas internas (hints). */
export type RemoteCapture = Omit<Capture, 'hints'> & { label: string; color: string };
export type AlertKind = 'shiny' | 'p5' | 'recorde' | 'nota' | 'conta_caiu' | 'conta_voltou';
export interface RemoteAlert { id: string; at: string /* ISO */; kind: AlertKind; profileId: string; label: string; text: string /* pt-BR curto, ≤120 */ }
export interface AlertPrefs { shiny: boolean; p5: boolean; recorde: boolean; notaMin: number | null /* 0–10 */; contaCaiu: boolean }
export const DEFAULT_ALERT_PREFS: AlertPrefs = { shiny: true, p5: true, recorde: false, notaMin: null, contaCaiu: true };
/** Destinos permitidos no campo url do payload de push (hashes relativos do app do celular). */
export const PUSH_URL_PATTERN = /^#(?:alertas|contas|conta\/[\w-]{1,64})$/;
export interface PushPayload { kind: AlertKind; label: string; text: string; at: string; url: string }
