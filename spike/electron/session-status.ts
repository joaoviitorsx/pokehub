export type LoadFailure = 'offline' | 'error' | null;

export function classifyLoadFailure(code: number): LoadFailure {
  if (code === -3) return null;
  return code === -106 ? 'offline' : 'error';
}

export function classifyLoadRejection(error: unknown): LoadFailure {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ERR_ABORTED') return null;
  return code === 'ERR_INTERNET_DISCONNECTED' ? 'offline' : 'error';
}

// Backoff limitado para sessão offline: três tentativas e desiste (o usuário ainda tem o botão Recarregar).
export function offlineRetryDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < 3 ? 5000 * 2 ** attempt : null;
}

/** O /hunt pode ser lido com a página pronta, ou "carregando" sem carga do frame principal em curso (o jogo abre conexões longas e subframes depois de pronto). */
export function canReadHunt(state: string | undefined, loadingMainFrame: boolean): boolean {
  return state === 'ready' || (state === 'loading' && !loadingMainFrame);
}
