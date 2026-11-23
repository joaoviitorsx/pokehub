// Medição ao vivo (Professor Grindolino): ganhos lidos do log de mensagens visível do jogo, na sessão do usuário.
// Fonte, campos e riscos: docs/data-sources.md, "Medição ao vivo".
import type { Measurement } from './grindolino';

export interface LiveTotals {
  kills: number;
  trainerXp: number; // é o XP gravado na medição
  pokemonXp: number; // só exibido ao vivo
  coins: number;
  captures: number;
  shinies: number; // capturas cuja linha cita Shiny
}
/** Pokémon em campo, do último `estado` retido no barramento da extensão /hunt. */
export interface LivePokemon { key: string; name: string | null; level: number | null }
export interface LiveSession {
  accountId: string;
  huntId: string | null; // hunt do Grindolino escolhida ao iniciar; null = vincular pelo nome detectado
  huntName: string | null; // espécie do primeiro abate lido; null até lá
  startedAt: number; // epoch ms
  readAt: number; // última leitura boa: os totais valem até aqui
  totals: LiveTotals;
  pokemon: LivePokemon | null; // em campo no início; null sem a extensão /hunt
  lostLines: number; // linhas do log que não chegaram a ser lidas
}
export type LiveEndReason = 'user' | 'session' | 'hunt' | 'pokemon' | 'limit';
export interface LiveEnded {
  accountId: string;
  reason: LiveEndReason;
  measurement: Measurement | null; // null: nada foi gravado
  huntName: string | null;
  notice: string;
  endedAt: number;
}
export interface LiveStatus { active: LiveSession[]; ended: LiveEnded[] }

export const LIVE_MAX_ACTIVE = 4;
export const LIVE_MAX_MS = 12 * 60 * 60 * 1000;
/** Antes disso a taxa por hora oscila demais para ser mostrada. */
export const LIVE_MIN_SAMPLE_MS = 2 * 60 * 1000;

/** API exposta em window.pokehub.live (Result {ok:true,data}|{ok:false,error}). */
export interface LiveApi {
  status(): Promise<unknown>; // LiveStatus
  start(accountId: string, huntId: string | null): Promise<unknown>; // LiveStatus
  stop(accountId: string): Promise<unknown>; // LiveStatus
}
