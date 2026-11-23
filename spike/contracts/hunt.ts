// Retrato somente leitura do ranking calculado pela extensão /hunt (terceiros) dentro de uma sessão.
/** Retrato da espécie: atlas servido por https://pokeidle.io e a janela (px) dele que contém o Pokémon. */
export interface HuntSprite { url: string; x: number; y: number; w: number; h: number }
export interface HuntRow {
  nome: string;
  regiao: string;
  nivel: number;
  xpPorHora: number;
  abatesPorHora: number;
  mataEm: number; // segundos
  ouroPorHora: number;
  shinyPorHora: number | null; // null: a extensão não tem o dado para esta hunt
  estimado: boolean; // abates/h estimados pela extensão (≈)
  umHit: boolean;
  mortesPorHora: number;
  piorGolpe: number; // fração do HP tirada pelo pior golpe do selvagem
  liberada: boolean; // o nível do treinador já alcança a hunt
  sprite: HuntSprite | null;
}
export interface HuntBonus { pokemon: number; treinador: number; itens: {nome: string; mult: number}[] }
export type HuntSnapshot =
  | {estado: 'sem-extensao' | 'sem-jogo' | 'sem-pokemon'}
  | {
      estado: 'ok';
      pokemon: {nome: string; nivel: number; sprite: HuntSprite | null};
      bonus: HuntBonus | null;
      hunts: HuntRow[]; // até 60: as 20 melhores por XP/h, ouro/h e Shiny/h
      liberadas: number;
      total: number;
      filtro: {ordem: 'xp'; soLiberadas: boolean}; // pedido pela lateral; as preferências do painel da extensão não são lidas
      versaoJogo: string | null;
      versaoExtensao: string | null;
    };

// Equipe ("Esse Pokémon é bom?"): ficha e previsão por Pokémon, lidas do `estado` do barramento e do cálculo da extensão.
export const STAT_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatBlock = Record<StatKey, number | null>; // null: o jogo não informou este atributo
export interface TeamHunt { nome: string; regiao: string; xpPorHora: number; ouroPorHora: number; abatesPorHora: number; estimado: boolean }
export interface TeamMember {
  chave: string; // id da instância no jogo; o mesmo `pokemonKey` gravado nas medições ao vivo
  ativo: boolean; // em campo
  nome: string;
  nivel: number;
  potencia: number | null; // P1–P5; null se o jogo não informou
  tipos: string[];
  ivs: StatBlock | null;
  stats: StatBlock | null;
  sprite: HuntSprite | null;
  hunts: TeamHunt[]; // viáveis e liberadas, da melhor para a pior em XP/h (até 120); vazio = a extensão não calculou
}
export type HuntTeam =
  | {estado: 'sem-extensao' | 'sem-jogo' | 'sem-pokemon'}
  | {
      estado: 'ok';
      membros: TeamMember[]; // até 6: o Pokémon em campo e os de maior nível
      total: number; // quantos Pokémon o `estado` trouxe
      lidoEm: number; // epoch ms do cálculo (a leitura é refeita no máximo 1x/60 s por conta)
      versaoJogo: string | null;
      versaoExtensao: string | null;
    };
