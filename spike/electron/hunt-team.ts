import { STAT_KEYS, type HuntSprite, type HuntTeam, type StatBlock, type TeamHunt, type TeamMember } from '../contracts/hunt';
import { amount, atGame, HUNT_UNAVAILABLE, isRecord, lookOf, spritesFor, text, timed, whole, type HuntTarget } from './hunt-snapshot';

export const TEAM_WAIT = 'A equipe desta conta foi lida há menos de um minuto. Tente de novo em instantes.';
export const TEAM_MIN_INTERVAL_MS = 60_000; // no máximo um cálculo por conta a cada 60 s
const KEEP_MS = 10 * 60_000; // equipe igual: o cálculo vale por 10 min (bônus de XP expiram sem mudar a assinatura)
const MAX_MEMBERS = 6;
const MAX_HUNTS = 120;

// Código fixo executado na página do jogo, como em hunt-snapshot.ts: nenhum dado do renderer entra aqui. Lê só o último
// `welcome`/`estado` retido no barramento da extensão e chama o cálculo DELA uma vez por Pokémon (no máximo 6: o que está
// em campo e os de maior nível). Entre um cálculo e outro devolve a vez ao jogo, para não travar a página de uma vez só.
const page = (full: boolean) => `(async () => {
  const P = globalThis.__pokeidleHunt;
  if (!P || typeof P.on !== 'function' || typeof P.carregarJogo !== 'function' || !P.engine || typeof P.engine.analisar !== 'function') return {estado:'sem-extensao'};
  const ultimo = (tipo) => { let v = null; const sair = P.on(tipo, (d) => { v = d; }); if (typeof sair === 'function') sair(); return v; };
  const welcome = ultimo('welcome'), eu = ultimo('estado');
  if (!welcome || !eu) return {estado:'sem-jogo'};
  const todos = Array.isArray(eu.pokemons) ? eu.pokemons.filter((p) => p && p.id != null) : [];
  if (!todos.length) return {estado:'sem-pokemon'};
  const emCampo = (p) => (p.id === eu.activeId ? 1 : 0);
  const equipe = [...todos].sort((a, b) => emCampo(b) - emCampo(a) || (Number(b.level) || 0) - (Number(a.level) || 0)).slice(0, ${MAX_MEMBERS});
  const tipo = eu.diaSazonal && /^[A-Z]{3,12}$/.test(eu.diaSazonal.tipo) ? eu.diaSazonal.tipo : null;
  const assinatura = [equipe.map((p) => [p.id, p.level, JSON.stringify(p.stats ?? null)].join(':')).join(','), tipo, eu.level, eu.activeId, todos.length].join('|');
  if (!${full}) return {estado:'ok', assinatura};
  const jogo = await P.carregarJogo();
  const consts = {tabelaTipos: welcome.tabelaTipos, ampliacaoHunt: welcome.ampliacaoHunt, multHpSelvagem: welcome.multHpSelvagem, multDanoSelvagem: welcome.multDanoSelvagem, tiposBoost: welcome.tiposBoost, catalogoBolas: welcome.catalogoBolas, captura: welcome.captura, chanceShiny: welcome.chanceShiny, shinyLooks: welcome.shinyLooks};
  const bloco = (o) => (o && typeof o === 'object' ? {hp: o.hp, atk: o.atk, def: o.def, spAtk: o.spAtk, spDef: o.spDef, speed: o.speed} : null);
  const membros = [];
  for (const pk of equipe) {
    await new Promise((ok) => setTimeout(ok, 0));
    const chave = P.geo && P.geo.chaveDoPokemon ? P.geo.chaveDoPokemon(pk) : null;
    let r = null;
    try {
      r = P.engine.analisar(pk, {
        mod: jogo.mod, especies: jogo.especies, hunts: welcome.hunts ?? [], consts, eu, ritmo: P.ritmo ?? null,
        mapaVisto: (slug) => (P.geo && P.geo.mapaDa ? P.geo.mapaDa(slug) : null) ?? null,
        ritmoMedido: (slug) => (chave && P.geo && P.geo.ritmoMedido ? P.geo.ritmoMedido(slug, chave) : null) ?? null,
      }, {ordem:'xp', soLiberadas:true, tipoDoDia:tipo});
    } catch { r = null; } // espécie fora do catálogo ou sem stats: a ficha segue sem previsão
    const esp = r ? r.especie : (jogo.especies && jogo.especies.get ? jogo.especies.get(pk.speciesId) : null);
    membros.push({
      chave: String(pk.id), ativo: pk.id === eu.activeId, nome: pk.nome, nivel: pk.level, potencia: pk.potencia ?? null,
      tipos: r ? r.pokemon.tipos : pk.tipos, ivs: bloco(pk.ivs), stats: bloco(pk.stats), look: esp ? esp.looktype : null,
      hunts: r ? r.linhas.filter((l) => !l.inviavel).slice(0, ${MAX_HUNTS}).map((l) => ({nome: l.nome, regiao: l.regiao, xpPorHora: l.xpPokemonH, ouroPorHora: l.ouroH, abatesPorHora: l.kph, estimado: l.ritmo !== 'jogo' || !!(l.aoe && l.aoe.estimado)})) : [],
    });
  }
  return {estado:'ok', assinatura, membros, total: todos.length, versaoJogo: jogo.versao ?? null};
})()`;
export const TEAM_PROBE_SCRIPT = page(false);
export const TEAM_FULL_SCRIPT = page(true);

// ---- sanitização: o retorno vem de página remota --------------------------------------------
type Sprites = ReadonlyMap<number, HuntSprite>;
/** Atributos como o jogo os informa. Sem teto presumido de IV: só inteiros não negativos plausíveis. */
function block(value: unknown): StatBlock | null {
  if (!isRecord(value)) return null;
  const out = Object.fromEntries(STAT_KEYS.map(key => [key, whole(value[key], 0, 1e9)])) as StatBlock;
  return STAT_KEYS.some(key => out[key] !== null) ? out : null;
}
function hunt(value: unknown): TeamHunt | null {
  if (!isRecord(value)) return null;
  const nome = text(value.nome), xpPorHora = amount(value.xpPorHora), ouroPorHora = amount(value.ouroPorHora), abatesPorHora = amount(value.abatesPorHora, 1e9);
  return nome === null || xpPorHora === null || ouroPorHora === null || abatesPorHora === null ? null : {nome, regiao: text(value.regiao, 24) ?? '', xpPorHora, ouroPorHora, abatesPorHora, estimado: value.estimado === true};
}
function member(value: unknown, sprites: Sprites): TeamMember | null {
  if (!isRecord(value)) return null;
  const chave = text(value.chave, 40), nivel = whole(value.nivel, 1, 1e7);
  if (chave === null || nivel === null) return null;
  return {
    chave, ativo: value.ativo === true, nome: text(value.nome, 60) ?? 'Pokémon', nivel, potencia: whole(value.potencia, 1, 5),
    tipos: (Array.isArray(value.tipos) ? value.tipos.slice(0, 3) : []).flatMap(tipo => text(tipo, 16) ?? []),
    ivs: block(value.ivs), stats: block(value.stats), sprite: sprites.get(lookOf(value) ?? 0) ?? null,
    hunts: (Array.isArray(value.hunts) ? value.hunts.slice(0, MAX_HUNTS) : []).flatMap(item => hunt(item) ?? []),
  };
}
const NO_SPRITES: Sprites = new Map();
/** Converte o retorno bruto da página na equipe válida, ou `null` se não der para confiar nele. */
export function sanitizeHuntTeam(raw: unknown, versaoExtensao: string | null = null, sprites: Sprites = NO_SPRITES, lidoEm = Date.now()): HuntTeam | null {
  if (!isRecord(raw)) return null;
  if (raw.estado === 'sem-extensao' || raw.estado === 'sem-jogo' || raw.estado === 'sem-pokemon') return {estado: raw.estado};
  if (raw.estado !== 'ok' || !Array.isArray(raw.membros)) return null;
  const seen = new Set<string>();
  const membros = raw.membros.slice(0, MAX_MEMBERS).flatMap(item => { const clean = member(item, sprites); if (!clean || seen.has(clean.chave)) return []; seen.add(clean.chave); return [clean]; });
  if (!membros.length) return null;
  return {estado: 'ok', membros, total: Math.max(membros.length, whole(raw.total, 1, 1e6) ?? 0), lidoEm, versaoJogo: text(raw.versaoJogo, 24), versaoExtensao: text(versaoExtensao, 24)};
}

// ---- leitura --------------------------------------------------------------------------------
export type TeamResult = {ok: true; data: HuntTeam} | {ok: false; error: string};
const cache = new Map<string, {identity: object | undefined; assinatura: string; data: HuntTeam & {estado: 'ok'}}>();
const lastRun = new Map<string, number>();
const running = new Map<string, Promise<TeamResult>>();
async function read(id: string, target: HuntTarget, timeoutMs: number): Promise<TeamResult> {
  const fail: TeamResult = {ok: false, error: HUNT_UNAVAILABLE};
  try {
    if (!target.hasExtension) return {ok: true, data: {estado: 'sem-extensao'}};
    if (!atGame(target.url)) return {ok: true, data: {estado: 'sem-jogo'}}; // nunca executa em página de outro site
    const saved = cache.get(id);
    const cached = saved && saved.identity === target.identity ? saved : null; // sessão reaberta não reaproveita a anterior
    const recent = Date.now() - (lastRun.get(id) ?? -Infinity) < TEAM_MIN_INTERVAL_MS;
    if (cached && recent) return {ok: true, data: cached.data}; // dentro do minuto nada roda na página
    const probe = await timed(target.run(TEAM_PROBE_SCRIPT), timeoutMs);
    if (!isRecord(probe)) return fail;
    if (probe.estado !== 'ok') { const data = sanitizeHuntTeam(probe); return data && data.estado !== 'ok' ? {ok: true, data} : fail; }
    const assinatura = typeof probe.assinatura === 'string' && probe.assinatura.length <= 4000 ? probe.assinatura : null;
    if (assinatura === null) return fail;
    if (cached && cached.assinatura === assinatura && Date.now() - cached.data.lidoEm < KEEP_MS) return {ok: true, data: cached.data};
    if (recent) return {ok: false, error: TEAM_WAIT};
    lastRun.set(id, Date.now());
    const raw = await timed(target.run(TEAM_FULL_SCRIPT), timeoutMs);
    const sprites = await spritesFor(isRecord(raw) && Array.isArray(raw.membros) ? raw.membros.slice(0, MAX_MEMBERS).flatMap(item => lookOf(item) ?? []) : [], target);
    const data = sanitizeHuntTeam(raw, target.version, sprites);
    if (!data) return fail;
    if (data.estado === 'ok') cache.set(id, {identity: target.identity, assinatura, data});
    return {ok: true, data};
  } catch { return fail; }
}
/** Equipe de uma conta com a previsão do /hunt por Pokémon. `target` devolve `null` quando a conta não tem sessão utilizável. */
export function huntTeam(id: unknown, knownIds: readonly string[], target: (id: string) => HuntTarget | null, timeoutMs = 20_000): Promise<TeamResult> {
  if (typeof id !== 'string' || !knownIds.includes(id)) return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE});
  let found: HuntTarget | null;
  try { found = target(id); } catch { found = null; }
  if (!found) { cache.delete(id); return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE}); }
  const pending = running.get(id);
  if (pending) return pending; // um cálculo por conta de cada vez
  const work = read(id, found, timeoutMs).finally(() => running.delete(id));
  running.set(id, work);
  return work;
}
