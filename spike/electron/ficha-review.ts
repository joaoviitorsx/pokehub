/*
 * Análise "Para caçar" na ficha do Pokémon (ver spike/domain/ficha-review.ts). A cada 4 s (8 s no Modo leve) confere, em cada conta
 * pronta, se o observador da ficha está instalado na página atual (sonda barata); se não, instala. Desligada, remove o cartão, o CSS
 * e o observador. A avaliação em si roda na página, na hora em que a ficha abre ou troca de Pokémon. Não clica em nada.
 */
import { FICHA_PROBE, fichaScript } from '../domain/ficha-review';
import type { MarketTarget } from './market-scan';
import { atGame, timed } from './hunt-snapshot';

export const FICHA_INTERVAL_MS = 4_000, FICHA_LITE_INTERVAL_MS = 8_000;
const SCRIPT_TIMEOUT_MS = 4_000;
export interface FichaDeps { known: () => string[]; target: (id: string) => MarketTarget | null; enabled: () => boolean; lite: () => boolean; /** janela do PokéHub à vista (escondida ninguém abre ficha) */ visible?: () => boolean }
export function createFichaReview(deps: FichaDeps) {
  const installed = new Set<string>(); // contas em que algo foi instalado: limpar ao desligar
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false;
  async function tickAccount(id: string, enabled: boolean) {
    const target = deps.target(id);
    if (!target || !atGame(target.url)) return;
    if (!enabled) {
      if (installed.has(id)) { await timed(target.run(fichaScript(false)),SCRIPT_TIMEOUT_MS).catch(() => undefined); installed.delete(id); }
      return;
    }
    if (await timed(target.run(FICHA_PROBE),SCRIPT_TIMEOUT_MS).catch(() => false) === true) return;
    await timed(target.run(fichaScript(true)),SCRIPT_TIMEOUT_MS).catch(() => undefined);
    installed.add(id);
  }
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const enabled = deps.enabled();
      if (enabled && deps.visible && !deps.visible()) return; // na bandeja/minimizado: nada a instalar agora
      for (const id of deps.known()) { if (stopped) return; try { await tickAccount(id,enabled); } catch { /* conta fechando */ } }
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(),deps.lite() ? FICHA_LITE_INTERVAL_MS : FICHA_INTERVAL_MS);
    }
  }
  return {
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(() => void tick(),FICHA_INTERVAL_MS); },
    refresh() { clearTimeout(timer); void tick(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
