import type { LiveTotals } from '../contracts/live';

// Parser das linhas do log de mensagens do jogo. Texto vem de página remota: tudo que não bate é ignorado.
export type LiveEvent =
  | {kind: 'kill'; name: string; trainerXp: number | null; pokemonXp: number | null; coins: number | null}
  | {kind: 'capture'; name: string; level: number; shiny: boolean};

export const LIVE_LINE_MAX = 240;
const MAX_GAIN = 1e12; // por linha; acima disso é texto estranho, não ganho
const NAME = String.raw`\p{L}[\p{L}\p{M}\d .'’:♀♂-]{0,38}?`;
const KILL = new RegExp(String.raw`(${NAME})\s+derrotad[oa]\b`, 'iu');
const CAPTURE = new RegExp(String.raw`capturad[oa]:?\s+(${NAME})\s+Nv\.?\s*(\d{1,4})(?!\d)`, 'iu');
const SHINY = /shiny|[✨★]/iu;

/** Inteiro pt-BR com ponto de milhar ("42.127"). Qualquer outro formato ("1,2 mi", "42.1") vira null. */
function count(token: string): number | null {
  if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(token)) return null;
  const value = Number(token.replaceAll('.', ''));
  return Number.isSafeInteger(value) && value <= MAX_GAIN ? value : null;
}
function gain(line: string, label: string): number | null {
  const found = new RegExp(String.raw`\+\s*([\d.,]+)\s*${label}`, 'iu').exec(line);
  return found ? count(found[1]!) : null;
}
/** "Sunkern derrotado! +42.127 xp treinador, +42.127 xp pokemon, +1.005 ouro (+137 do bônus de loot)" ou "capturado: Sunkern Nv40 (q1.397)". */
export function parseLogLine(line: unknown): LiveEvent | null {
  if (typeof line !== 'string' || line.length > LIVE_LINE_MAX) return null;
  const kill = KILL.exec(line);
  if (kill) {
    const rest = line.slice(kill.index + kill[0].length);
    // o ouro da linha já é o total do abate; o "(+137 do bônus de loot)" é detalhe dele e não bate em "+N ouro"
    const trainerXp = gain(rest, String.raw`xp\s+(?:d[eo]\s+)?treinador`), pokemonXp = gain(rest, String.raw`xp\s+(?:d[eo]\s+)?pok[eé]mon`), coins = gain(rest, 'ouro');
    // sem nenhum ganho legível não é a linha de abate (ex.: o próprio pokémon derrotado)
    return trainerXp === null && pokemonXp === null && coins === null ? null : {kind: 'kill', name: kill[1]!.trim(), trainerXp, pokemonXp, coins};
  }
  const capture = CAPTURE.exec(line);
  if (!capture) return null;
  const name = capture[1]!.replace(/^shiny\s+/iu, '').trim();
  return name ? {kind: 'capture', name, level: Number(capture[2]), shiny: SHINY.test(line)} : null;
}

export const emptyTotals = (): LiveTotals => ({kills: 0, trainerXp: 0, pokemonXp: 0, coins: 0, captures: 0, shinies: 0});
/** Soma os eventos em um total novo; um ganho ilegível dentro de uma linha de abate conta como zero. */
export function addEvents(totals: LiveTotals, events: readonly LiveEvent[]): LiveTotals {
  const next = {...totals};
  for (const event of events) {
    if (event.kind === 'kill') { next.kills++; next.trainerXp += event.trainerXp ?? 0; next.pokemonXp += event.pokemonXp ?? 0; next.coins += event.coins ?? 0; }
    else { next.captures++; if (event.shiny) next.shinies++; }
  }
  return next;
}
/** Taxa por hora, ou null enquanto a amostra é curta demais. */
export function perHour(amount: number, elapsedMs: number, minMs: number): number | null {
  return elapsedMs >= minMs && elapsedMs > 0 ? amount * 3_600_000 / elapsedMs : null;
}
