// Ritmo de leitura da lateral "Onde caçar?": a conta selecionada a cada 10 s (sondagem barata no processo principal);
// as outras são pré-aquecidas uma por vez e relidas no máximo a cada 5 min, para a troca de conta abrir com dado pronto.
// Modo leve: a selecionada a cada 20 s e sem pré-aquecimento.
export const HUNT_REFRESH_MS = 10_000;
export const HUNT_IDLE_MS = 300_000;
export const HUNT_REFRESH_LITE_MS = 20_000;
export const huntRefreshMs = (lite: boolean) => lite ? HUNT_REFRESH_LITE_MS : HUNT_REFRESH_MS;
/** 'loading' entra porque o jogo pode manter um carregamento aberto com a página já utilizável; o processo principal decide se lê. */
export const huntFetchable = (state: string | undefined) => state === 'ready' || state === 'loading';
/** Contas a ler neste ciclo, em ordem: a selecionada sempre primeiro; as demais só se nunca lidas ou lidas há 5 min ou mais (nenhuma, sem pré-aquecimento). */
export function huntQueue(fetchable: readonly string[], selected: string, readAt: (id: string) => number | undefined, now: number, warmUp = true): string[] {
  return [...fetchable.filter(id => id === selected), ...(warmUp ? fetchable.filter(id => id !== selected && !(now - (readAt(id) ?? -Infinity) < HUNT_IDLE_MS)) : [])];
}
/** Assinatura barata de um retrato: se não mudou, a interface não precisa de novo setState (nem re-render). */
export const signature = (value: unknown): string => JSON.stringify(value) ?? '';
