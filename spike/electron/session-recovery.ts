export async function resetSession(actions: {close(): void | Promise<void>; clear(): Promise<void>; open(): void}): Promise<void> {
  await actions.close();
  try { await actions.clear(); } finally { actions.open(); }
}

export async function restartSession(id: string, actions: {close(id: string): void | Promise<void>; open(id: string): void}): Promise<void> {
  await actions.close(id);
  actions.open(id);
}

export function openSessionSafely(id: string, actions: {open(id: string): void; cleanup(id: string): void; cleanupFailed(error: unknown): void; failed(id: string): void}): boolean {
  try { actions.open(id); return true; }
  catch {
    try { actions.cleanup(id); } catch (error) { actions.cleanupFailed(error); }
    actions.failed(id);
    return false;
  }
}

export function mountSessionView(actions: {configure(): void; attach(): void; dispose(): void}): void {
  try { actions.configure(); actions.attach(); }
  catch (error) {
    try { actions.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Falha ao abrir e liberar sessão', {cause: cleanupError}); }
    throw error;
  }
}
