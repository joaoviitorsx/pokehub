import type { Capture } from '../domain/captures';
import type { RemoteScreenSession } from './screen';
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
  /** R5: quem está vendo/controlando uma conta agora (banner do PC). */
  screen?: RemoteScreenSession[]; /** R5: o atalho global Ctrl+Shift+F12 não pôde ser registrado (outro app o usa): use o botão Encerrar controle. */ shortcutDown?: boolean;
}
export interface RemoteDevice { id: string; name: string; createdAt: string; lastSeen: string | null; canAct: boolean; /** R5: pode CONTROLAR a tela (controle total da conta; liberado só no PC) */ canControl?: boolean; /** Assinaturas de push ativas deste aparelho (0–2) */ push?: number }
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
export interface PushPayload { kind: AlertKind | 'acao'; label: string; text: string; at: string; url: string }

// --- R4: compras e ações pelo celular (contrato com o app do celular). Nada aqui carrega emailLabel, token, PIN nem caminho. ---
export type ShopCatR = 'Pokebolas' | 'Poções' | 'Revives';
export interface RemoteShopItem { cat: ShopCatR; name: string; have: number; price: number }
export interface RemoteShopAccount { profileId: string; label: string; gold: number | null; items: RemoteShopItem[]; error?: string }
export interface RemotePlanLine { cat: ShopCatR; name: string; have: number; qty: number; unitPrice: number; total: number; fits: boolean; note?: string }
export interface RemotePlanAccount {
  profileId: string; label: string; goldBefore: number | null; goldAfter: number | null; lines: RemotePlanLine[]; total: number;
  /** Teto diário do celular: sobra antes e depois desta compra (ouro). */ capRemaining: number; capAfter: number; executable: boolean; error?: string;
}
export interface RemotePlan { accounts: RemotePlanAccount[]; total: number; needsPin: boolean; dailyCapGold: number; mode: 'manual' | 'kit'; kitName?: string }
export interface ShopPlanReply { confirmId: string; planHash: string; expiresAt: number; plan: RemotePlan; elevated: boolean }
export interface RemoteLineResult { name: string; qty: number; status: 'ok' | 'erro' | 'pulada'; bought?: number; spent?: number; error?: string }
export interface RemoteAccountResult { profileId: string; label: string; status: 'ok' | 'parcial' | 'abortada'; spent: number; lines: RemoteLineResult[]; error?: string }
export interface ShopConfirmReply { confirmId: string; spent: number; accounts: RemoteAccountResult[] }
/** Evento SSE `shop`: progresso ao vivo da compra confirmada (só para o aparelho que confirmou). */
export type ShopEvent =
  | {kind: 'start'; confirmId: string; accounts: {profileId: string; label: string; lines: number}[]}
  | {kind: 'line'; confirmId: string; profileId: string; label: string; line: number; name: string; qty: number; status: 'buying' | 'ok' | 'error' | 'skipped'; spent?: number | null; error?: string}
  | {kind: 'done'; confirmId: string; result: ShopConfirmReply};
/** Estado das ações deste aparelho (parte de GET /api/me). */
export interface ActionsState { canAct: boolean; pinSet: boolean; actionsDisabled: boolean; lockedMs: number; elevatedMs: number; dailyCapGold: number; lite: boolean }
export interface RemotePurchase { id: number; at: string; deviceId: string | null; deviceName: string | null; profileId: string; label: string; item: string; qty: number; unitPrice: number; total: number; result: string }
export interface RemoteSpend { profileId: string; label: string; gold: number; capGold: number }
