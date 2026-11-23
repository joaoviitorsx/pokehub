export type StartupMode = 'grid' | 'focus-first';
export interface HuntExtensionStatus {
  enabled: boolean; // há uma pasta salva
  path: string | null;
  name: string | null;
  version: string | null;
  error: string | null; // pasta inválida ou falha ao carregar; as sessões seguem sem a extensão
  loaded: number; // sessões abertas com a extensão carregada
  sessions: number;
}
