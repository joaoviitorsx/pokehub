// Regras da bandeja do sistema (sem Electron, para testar): decisão de fechar/minimizar, textos e itens do menu.
import type { TrayPrefs } from '../contracts/preferences';

export type TrayEvent = 'close' | 'minimize';
/** 'hide' = esconde a janela na bandeja (e cancela o fechar); 'default' = comportamento padrão do sistema. */
export function trayAction(input: {event: TrayEvent; platform: string; prefs: Pick<TrayPrefs,'onClose' | 'onMinimize'>; quitting: boolean; hasTray?: boolean}): 'hide' | 'default' {
  if (input.quitting || input.hasTray === false) return 'default';
  if (input.event === 'close') return input.prefs.onClose ? 'hide' : 'default';
  return input.platform !== 'darwin' && input.prefs.onMinimize ? 'hide' : 'default'; // no macOS o minimizar segue o Dock
}
export const TRAY_HINT = 'O PokéHub continua rodando aqui. Clique no ícone para abrir.';
export const trayTooltip = (running: number) => `PokéHub — ${running} ${running === 1 ? 'conta rodando' : 'contas rodando'}`;
/** Tamanho do ícone da bandeja por plataforma (px). */
export const trayIconSize = (platform: string) => platform === 'linux' ? 24 : 16;
const STATE_TEXT: Record<string,string> = {ready:'pronta', loading:'carregando', suspended:'suspensa', offline:'sem conexão', auth_required:'precisa entrar', error:'com erro'};
export const stateText = (state: string | undefined) => STATE_TEXT[state ?? 'loading'] ?? 'carregando';
export interface TrayItem { label?: string; type?: 'separator' | 'checkbox'; checked?: boolean; click?: () => void }
export function trayMenuItems(input: {profiles: readonly {id: string; label: string}[]; states: ReadonlyMap<string,string>; lite: boolean; open: () => void; focus: (id: string) => void; setLite: (value: boolean) => void; quit: () => void}): TrayItem[] {
  return [
    {label:'Abrir PokéHub', click:input.open},
    {type:'separator'},
    ...input.profiles.map(profile => ({label:`${profile.label} — ${stateText(input.states.get(profile.id))}`, click:() => input.focus(profile.id)})),
    ...(input.profiles.length ? [{type:'separator' as const}] : []),
    {label:'Modo leve', type:'checkbox', checked:input.lite, click:() => input.setLite(!input.lite)},
    {label:'Sair do PokéHub', click:input.quit},
  ];
}
/** Contas rodando = perfis com sessão aberta (as suspensas não contam). */
export const runningCount = (profiles: readonly {id: string}[], states: ReadonlyMap<string,string>) => profiles.filter(profile => states.get(profile.id) !== 'suspended').length;
/** Agrupa rajadas de chamadas numa só (a última) após `ms`. */
export function debounced(action: () => void, ms: number): {call: () => void; cancel: () => void} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {call: () => { clearTimeout(timer); timer = setTimeout(() => { timer = undefined; action(); }, ms); }, cancel: () => { clearTimeout(timer); timer = undefined; }};
}
