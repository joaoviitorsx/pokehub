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
