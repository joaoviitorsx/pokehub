/** Trava única por conta: leitura do Market, Loja (ler/comprar/executar) e qualquer clicador futuro nunca rodam juntos na mesma conta. */
export const ACCOUNT_BUSY = 'Conta ocupada com outra ação';
export interface AccountLock { acquire(id: string): (() => void) | null; busy(id: string): boolean }
export function createAccountLock(): AccountLock {
  const held = new Set<string>();
  return {
    acquire(id) {
      if (held.has(id)) return null;
      held.add(id);
      let released = false;
      return () => { if (!released) { released = true; held.delete(id); } };
    },
    busy: id => held.has(id),
  };
}
