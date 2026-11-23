// Estado do acesso remoto mostrado em Gerenciar → Acesso remoto. Nunca carrega chaves, tokens, hashes nem caminhos de arquivo.
export interface RemotePairing { code: string; expiresAt: number; attemptsLeft: number; caUrl: string; iosUrl: string }
export interface RemoteStatus {
  enabled: boolean; running: boolean; port: number; urls: string[]; error: string | null;
  pairing: RemotePairing | null; request: {name: string; ip: string} | null; paired: string | null;
  pinSet: boolean; devices: number; firstPairing: boolean; dailyCapGold: number;
}
export interface RemoteDevice { id: string; name: string; createdAt: string; lastSeen: string | null; canAct: boolean }
export interface RemoteAuditEntry { id: number; at: string; deviceId: string | null; action: string; detail: string | null }
