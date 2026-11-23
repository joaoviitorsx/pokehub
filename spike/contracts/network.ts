export type NetworkMode = 'registrar' | 'bloquear';
export interface UnknownHost { host: string; count: number; firstSeen: number; account: string; accountName: string }
export interface NetworkInfo { mode: NetworkMode; allowlist: string[]; unknown: UnknownHost[] }
