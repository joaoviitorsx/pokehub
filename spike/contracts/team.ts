// "Quem colocar em campo?" e tipagem do dia: equipe (e os mais fortes da coleção) com o melhor resultado do cálculo da /hunt.
import type { HuntSprite } from './hunt';

/** treinador: XP do treinador/h · ouro: ouro/h · pokemon: XP do próprio Pokémon/h (upar). */
export type TeamMetric = 'treinador' | 'ouro' | 'pokemon';
export const TEAM_METRICS: readonly TeamMetric[] = ['treinador', 'ouro', 'pokemon'];
export interface PickHunt { nome: string; regiao: string; valor: number }
export interface PickMember {
  chave: string; nome: string; nivel: number;
  /** em campo agora */ ativo: boolean;
  /** está na equipe (pode ir a campo já); false = sugestão da coleção */ equipe: boolean;
  tipos: string[]; potencia: number | null; sprite: HuntSprite | null;
  /** um dos tipos é a tipagem do dia (2× nas hunts) */ tipoDoDia: boolean;
  melhor: Record<TeamMetric, PickHunt | null>;
}
export type TeamPick =
  | {estado: 'sem-extensao' | 'sem-jogo' | 'sem-pokemon'}
  | {estado: 'ok'; tipoDoDia: string | null; tipoFim: number | null; membros: PickMember[]; total: number; lidoEm: number};
export interface DayType { tipo: string; fim: number | null; chave: string }
