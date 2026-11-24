export type UpdateState = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'disabled';
/** `transferred`/`total` em bytes e `bps` (bytes/s) só durante o download, para o modal mostrar "23 de 52 MB · 3 MB/s". */
export interface UpdateStatus { state: UpdateState; version?: string; percent?: number; notes?: string; error?: string; transferred?: number; total?: number; bps?: number }
export interface UpdateInfo { version: string; packaged: boolean; autoCheck: boolean; status: UpdateStatus }
