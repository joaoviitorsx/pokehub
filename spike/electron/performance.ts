// Regras de desempenho do processo principal (sem Electron, para testar): início escalonado, som e flags do Chromium.
export const STAGGER_MS = 2500;
/** Ordem de abertura das sessões: a em foco (ou a primeira) logo, as demais uma a cada 2,5 s. */
export function startupPlan(ids: readonly string[], focusedId: string | null, stepMs = STAGGER_MS): {id: string; delay: number}[] {
  const first = focusedId !== null && ids.includes(focusedId) ? focusedId : ids[0];
  if (first === undefined) return [];
  return [first,...ids.filter(id => id !== first)].map((id,index) => ({id,delay:index * stepMs}));
}
/** Com a opção ligada, só a conta visível (em foco ou na grade) tem som; sem a opção, nada é mutado. */
export const audioMuted = (enabled: boolean, visible: boolean): boolean => enabled && !visible;
/** Junta recursos ao `--disable-features` já existente, sem duplicar. */
export function mergeDisableFeatures(existing: string | undefined, add: readonly string[]): string {
  return [...new Set([...(existing ?? '').split(',').map(item => item.trim()).filter(Boolean),...add])].join(',');
}
/** Barra de título nativa escondida: o Windows/Linux desenham só os botões (overlay na cor da barra do app); no macOS ficam os semáforos. */
export function windowChrome(platform: string, height: number) {
  if (platform === 'darwin') return {titleBarStyle: 'hiddenInset' as const};
  return {titleBarStyle: 'hidden' as const, titleBarOverlay: {color: '#bd6951', symbolColor: '#fff6ef', height}};
}
