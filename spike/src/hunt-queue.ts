// Ritmo de leitura da lateral "Onde caçar?": a conta selecionada a cada 5 s (sondagem barata no processo principal);
// as outras são pré-aquecidas uma por vez e relidas no máximo a cada 60 s, para a troca de conta abrir com dado pronto.
export const HUNT_REFRESH_MS = 5000;
export const HUNT_IDLE_MS = 60_000;
/** 'loading' entra porque o jogo pode manter um carregamento aberto com a página já utilizável; o processo principal decide se lê. */
export const huntFetchable = (state: string | undefined) => state === 'ready' || state === 'loading';
/** Contas a ler neste ciclo, em ordem: a selecionada sempre primeiro; as demais só se nunca lidas ou lidas há 60 s ou mais. */
export function huntQueue(fetchable: readonly string[], selected: string, readAt: (id: string) => number | undefined, now: number): string[] {
  return [...fetchable.filter(id => id === selected), ...fetchable.filter(id => id !== selected && !(now - (readAt(id) ?? -Infinity) < HUNT_IDLE_MS))];
}
