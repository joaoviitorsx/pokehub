export type StartupMode = 'grid' | 'focus-first';
/** Modo leve (sem animações, lateral lenta, início em Foco, som só no foco) e a opção de som independente dele. */
export interface PerformancePrefs { lite: boolean; muteUnfocused: boolean }
