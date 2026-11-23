export type UpdateState = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'disabled';
export interface UpdateStatus { state: UpdateState; version?: string; percent?: number; notes?: string; error?: string }
export interface UpdateInfo { version: string; packaged: boolean; autoCheck: boolean; status: UpdateStatus }
