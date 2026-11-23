import type { Measurement } from '../contracts/grindolino';
import { STAT_KEYS, type StatKey, type TeamHunt, type TeamMember } from '../contracts/hunt';

/** Soma dos seis IVs publicados pelo jogo; não estima dano ou valor de mercado. */
export function assessPokemon(ivs: readonly number[]): {total:number; percent:number} | null {
  if (ivs.length !== 6 || ivs.some(value => !Number.isInteger(value) || value < 1 || value > 32)) return null;
  const total = ivs.reduce((sum, value) => sum + value, 0);
  return {total, percent: total / 192 * 100};
}

// ---- "Esse Pokémon é bom?": desempenho medido e veredito por regras fixas -----------------------
// Nada aqui é nota: cada frase sai de uma comparação simples, descrita em VERDICT_RULES e exibida na tela.
export const SMALL_SAMPLE_MINUTES = 30;
/** Diferença entre real e previsto abaixo disto é tratada como "dentro do previsto". */
export const CLOSE_RATIO = 0.05;
export const STAT_LABELS: Record<StatKey, string> = {hp: 'HP', atk: 'ATK', def: 'DEF', spAtk: 'SP.ATK', spDef: 'SP.DEF', speed: 'SPD'};
export const VERDICT_RULES = [
  'Previsto: a melhor hunt liberada de cada Pokémon segundo o cálculo da extensão /hunt, no nível e com os bônus de agora. A posição compara só os Pokémon listados.',
  'Real: soma das medições ao vivo gravadas com aquele Pokémon em campo, nesta conta, dividida pelo tempo medido.',
  `Real × previsto: mesma hunt (pelo nome), na hunt com mais minutos medidos. Diferença de até ${CLOSE_RATIO * 100}% conta como “dentro do previsto”.`,
  `Amostra pequena: menos de ${SMALL_SAMPLE_MINUTES} min medidos.`,
  'IV: cada atributo é comparado com a média dos Pokémon listados. Não há nota nem teto de IV presumido.',
];

export interface HuntPerformance {
  huntId: string; minutes: number; samples: number;
  xpPerHour: number | null; coinsPerHour: number | null; killsPerHour: number | null; // null: nenhuma medição informou a grandeza
  levelTo: number | null; // maior nível registrado ao fim de uma medição
}
export interface PokemonPerformance extends Omit<HuntPerformance, 'huntId'> { key: string; name: string | null; hunts: HuntPerformance[] } // hunts: mais minutos primeiro

interface Sum { minutes: number; samples: number; xp: number; xpMinutes: number; coins: number; coinsMinutes: number; kills: number; killMinutes: number; levelTo: number | null }
const emptySum = (): Sum => ({minutes: 0, samples: 0, xp: 0, xpMinutes: 0, coins: 0, coinsMinutes: 0, kills: 0, killMinutes: 0, levelTo: null});
function add(sum: Sum, m: Measurement): void {
  sum.samples++; sum.minutes += m.minutes;
  if (m.xpGained !== null) { sum.xp += m.xpGained; sum.xpMinutes += m.minutes; }
  if (m.coinsGained !== null) { sum.coins += m.coinsGained; sum.coinsMinutes += m.minutes; }
  if (m.killCount !== null) { sum.kills += m.killCount; sum.killMinutes += m.minutes; }
  const level = m.pokemonLevelEnd ?? m.pokemonLevel;
  if (level !== null && (sum.levelTo === null || level > sum.levelTo)) sum.levelTo = level;
}
const rates = (sum: Sum) => ({
  minutes: sum.minutes, samples: sum.samples, levelTo: sum.levelTo,
  xpPerHour: sum.xpMinutes ? sum.xp * 60 / sum.xpMinutes : null,
  coinsPerHour: sum.coinsMinutes ? sum.coins * 60 / sum.coinsMinutes : null,
  killsPerHour: sum.killMinutes ? sum.kills * 60 / sum.killMinutes : null,
});
/** Desempenho observado por Pokémon (`pokemonKey`) em uma conta. Medições sem Pokémon identificado ficam de fora. */
export function pokemonPerformance(measurements: readonly Measurement[], accountId: string): Map<string, PokemonPerformance> {
  const groups = new Map<string, {name: string | null; nameAt: string; all: Sum; hunts: Map<string, Sum>}>();
  for (const m of measurements) {
    if (m.accountId !== accountId || m.pokemonKey === null) continue;
    let group = groups.get(m.pokemonKey);
    if (!group) groups.set(m.pokemonKey, group = {name: null, nameAt: '', all: emptySum(), hunts: new Map()});
    if (m.pokemonName !== null && m.recordedAt >= group.nameAt) { group.name = m.pokemonName; group.nameAt = m.recordedAt; }
    let hunt = group.hunts.get(m.huntId);
    if (!hunt) group.hunts.set(m.huntId, hunt = emptySum());
    add(group.all, m); add(hunt, m);
  }
  return new Map([...groups].map(([key, group]) => [key, {
    key, name: group.name, ...rates(group.all),
    hunts: [...group.hunts].map(([huntId, sum]) => ({huntId, ...rates(sum)})).sort((a, b) => b.minutes - a.minutes || (a.huntId < b.huntId ? -1 : 1)),
  }]));
}

export type VerdictTone = 'good' | 'warn' | 'plain';
export interface VerdictLine { tone: VerdictTone; text: string }
export interface PokemonVerdict {
  chave: string;
  bestXp: TeamHunt | null; // melhor hunt prevista por XP/h
  bestGold: TeamHunt | null; // melhor hunt prevista por ouro/h
  badges: ('xp' | 'gold')[]; // 1º previsto entre os listados (só com dois ou mais comparáveis)
  real: PokemonPerformance | null;
  /** Mesma hunt medida e prevista; razões = real/previsto - 1. */
  compared: {hunt: string; minutes: number; xpRatio: number | null; goldRatio: number | null} | null;
  smallSample: boolean;
  lines: VerdictLine[];
}
const nameKey = (name: string) => name.trim().toLowerCase();
const best = (hunts: readonly TeamHunt[], value: (hunt: TeamHunt) => number): TeamHunt | null =>
  hunts.reduce<TeamHunt | null>((top, hunt) => value(hunt) > (top ? value(top) : 0) ? hunt : top, null);
const ratio = (real: number | null, predicted: number) => real !== null && predicted > 0 ? real / predicted - 1 : null;
function versus(label: string, value: number, where: string): VerdictLine {
  const percent = Math.round(Math.abs(value) * 100);
  if (Math.abs(value) < CLOSE_RATIO) return {tone: 'plain', text: `${label} real dentro do previsto ${where}`};
  return {tone: value > 0 ? 'good' : 'warn', text: `${label} real ${percent}% ${value > 0 ? 'acima' : 'abaixo'} do previsto ${where}`};
}
/** Média de IV por atributo entre os Pokémon listados; null com menos de dois valores (não há com o que comparar). */
export function teamIvMean(members: readonly TeamMember[]): Record<StatKey, number | null> {
  return Object.fromEntries(STAT_KEYS.map(key => {
    const values = members.flatMap(member => member.ivs?.[key] ?? []);
    return [key, values.length >= 2 ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  })) as Record<StatKey, number | null>;
}
/** Veredito de cada Pokémon listado. `huntNames`: id → nome das hunts do Grindolino (as medições guardam só o id). */
export function assessTeam(members: readonly TeamMember[], performance: ReadonlyMap<string, PokemonPerformance>, huntNames: ReadonlyMap<string, string>): PokemonVerdict[] {
  const tops = members.map(member => ({xp: best(member.hunts, hunt => hunt.xpPorHora), gold: best(member.hunts, hunt => hunt.ouroPorHora)}));
  const place = (index: number, metric: 'xp' | 'gold') => {
    const value = (hunt: TeamHunt | null) => hunt ? metric === 'xp' ? hunt.xpPorHora : hunt.ouroPorHora : null;
    const mine = value(tops[index]![metric]), others = tops.flatMap(top => value(top[metric]) ?? []);
    return mine === null || others.length < 2 ? null : {rank: 1 + others.filter(other => other > mine).length, of: others.length};
  };
  const ivMean = teamIvMean(members);
  return members.map((member, index): PokemonVerdict => {
    const {xp: bestXp, gold: bestGold} = tops[index]!;
    const lines: VerdictLine[] = [], badges: PokemonVerdict['badges'] = [];
    for (const [metric, label] of [['xp', 'XP/h'], ['gold', 'ouro/h']] as const) {
      const spot = place(index, metric);
      if (!spot) continue;
      if (spot.rank === 1) badges.push(metric);
      lines.push({tone: spot.rank === 1 ? 'good' : 'plain', text: `${spot.rank}º de ${spot.of} em ${label} previsto`});
    }
    if (!bestXp && !bestGold) lines.push({tone: 'warn', text: 'O /hunt não calculou hunt viável e liberada para este Pokémon'});
    const real = performance.get(member.chave) ?? null;
    let compared: PokemonVerdict['compared'] = null;
    if (!real) lines.push({tone: 'plain', text: 'Sem medição ao vivo com este Pokémon nesta conta'});
    else {
      for (const measured of real.hunts) {
        const name = huntNames.get(measured.huntId);
        const predicted = name === undefined ? undefined : member.hunts.find(hunt => nameKey(hunt.nome) === nameKey(name));
        if (!predicted) continue;
        compared = {hunt: predicted.nome, minutes: measured.minutes, xpRatio: ratio(measured.xpPerHour, predicted.xpPorHora), goldRatio: ratio(measured.coinsPerHour, predicted.ouroPorHora)};
        const where = `em “${predicted.nome}” (${measured.minutes} min)`;
        if (compared.xpRatio !== null) lines.push(versus('XP', compared.xpRatio, where));
        if (compared.goldRatio !== null) lines.push(versus('Ouro', compared.goldRatio, where));
        if (measured.levelTo !== null && measured.levelTo < member.nivel) lines.push({tone: 'plain', text: `Medido até o nível ${measured.levelTo}; a previsão vale para o nível ${member.nivel} de agora`});
        break;
      }
      if (!compared) lines.push({tone: 'plain', text: `${real.minutes} min medidos, mas em hunt sem previsão do /hunt agora: sem comparação`});
    }
    const smallSample = real !== null && (compared?.minutes ?? real.minutes) < SMALL_SAMPLE_MINUTES;
    if (smallSample) lines.push({tone: 'warn', text: `Amostra pequena (menos de ${SMALL_SAMPLE_MINUTES} min): leia o real como indício`});
    const above = STAT_KEYS.filter(key => ivMean[key] !== null && (member.ivs?.[key] ?? null) !== null && member.ivs![key]! > ivMean[key]!);
    const below = STAT_KEYS.filter(key => ivMean[key] !== null && (member.ivs?.[key] ?? null) !== null && member.ivs![key]! < ivMean[key]!);
    if (above.length) lines.push({tone: 'good', text: `IV acima da média da equipe em ${above.map(key => STAT_LABELS[key]).join(', ')}`});
    if (below.length) lines.push({tone: 'plain', text: `IV abaixo da média da equipe em ${below.map(key => STAT_LABELS[key]).join(', ')}`});
    return {chave: member.chave, bestXp, bestGold, badges, real, compared, smallSample, lines};
  });
}
