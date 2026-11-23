export type StartupMode = 'grid' | 'focus-first';
/** Modo leve (sem animações, lateral lenta, início em Foco, som só no foco) e a opção de som independente dele. */
export interface PerformancePrefs { lite: boolean; muteUnfocused: boolean }
/** Bandeja do sistema: continuar rodando ao fechar/minimizar; `hintShown` guarda o aviso de primeira vez. */
export interface TrayPrefs { onClose: boolean; onMinimize: boolean; hintShown: boolean }
