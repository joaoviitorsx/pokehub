/*
 * "Quem colocar em campo?" + tipagem do dia, a partir do barramento da extensão /hunt (mesma via e mesmas regras de hunt-snapshot.ts:
 * scripts fixos, nada do renderer interpolado, retorno revalidado). Lê o último `welcome`/`estado`, pega a equipe (slot 0–5) e os
 * 3 mais fortes da coleção fora dela, e roda o cálculo DA EXTENSÃO para cada um (com a tipagem do dia). Cada cálculo leva ~0,5 s
 * na página: um por vez, devolvendo a vez ao jogo entre eles; no máximo um cálculo por conta a cada 60 s, e o resultado vale
 * 10 min enquanto a equipe não muda. Nada é escrito no jogo.
 */
import type { DayType, PickHunt, PickMember, TeamMetric, TeamPick } from '../contracts/team';
import type { HuntSprite } from '../contracts/hunt';
import { amount, atGame, HUNT_UNAVAILABLE, isRecord, lookOf, spritesFor, text, timed, whole, type HuntTarget } from './hunt-snapshot';

export const TEAM_WAIT = 'A equipe desta conta foi analisada há menos de um minuto. Tente de novo em instantes.';
export const TEAM_MIN_INTERVAL_MS = 60_000;
const KEEP_MS = 10 * 60_000;
const MAX_TEAM = 6, MAX_EXTRA = 3;

const page = (full: boolean) => `(async () => {
  const P = globalThis.__pokeidleHunt;
  if (!P || typeof P.on !== 'function' || typeof P.carregarJogo !== 'function' || !P.engine || typeof P.engine.analisar !== 'function') return {estado:'sem-extensao'};
  const ultimo = (tipo) => { let v = null; const sair = P.on(tipo, (d) => { v = d; }); if (typeof sair === 'function') sair(); return v; };
  const welcome = ultimo('welcome'), eu = ultimo('estado');
  if (!welcome || !eu) return {estado:'sem-jogo'};
  const todos = Array.isArray(eu.pokemons) ? eu.pokemons.filter((p) => p && p.id != null) : [];
  if (!todos.length) return {estado:'sem-pokemon'};
  const naEquipe = (p) => p.slot !== null && p.slot !== undefined;
  const equipe = todos.filter(naEquipe).sort((a, b) => (Number(a.slot) || 0) - (Number(b.slot) || 0)).slice(0, ${MAX_TEAM});
  const extras = todos.filter((p) => !naEquipe(p)).sort((a, b) => (Number(b.poder) || 0) - (Number(a.poder) || 0) || (Number(b.level) || 0) - (Number(a.level) || 0)).slice(0, ${MAX_EXTRA});
  const ds = eu.diaSazonal && /^[A-Z]{3,12}$/.test(eu.diaSazonal.tipo) ? eu.diaSazonal : null;
  const tipo = ds ? ds.tipo : null;
  const lista = [...equipe, ...extras];
  const assinatura = [lista.map((p) => [p.id, p.level, p.slot, JSON.stringify(p.stats ?? null)].join(':')).join(','), tipo, eu.level, eu.activeId].join('|');
  if (!${full}) return {estado:'ok', assinatura};
  const jogo = await P.carregarJogo();
  const consts = {tabelaTipos: welcome.tabelaTipos, ampliacaoHunt: welcome.ampliacaoHunt, multHpSelvagem: welcome.multHpSelvagem, multDanoSelvagem: welcome.multDanoSelvagem, tiposBoost: welcome.tiposBoost, catalogoBolas: welcome.catalogoBolas, captura: welcome.captura, chanceShiny: welcome.chanceShiny, shinyLooks: welcome.shinyLooks};
  const melhorPor = (linhas, campo) => { let m = null; for (const l of linhas) { const v = Number(l[campo]); if (Number.isFinite(v) && v > 0 && (!m || v > m.valor)) m = {nome: l.nome, regiao: l.regiao, valor: v}; } return m; };
  const membros = [];
  for (const pk of lista) {
    await new Promise((ok) => setTimeout(ok, 30));
    const chave = P.geo && P.geo.chaveDoPokemon ? P.geo.chaveDoPokemon(pk) : null;
    let r = null;
    try {
      r = P.engine.analisar(pk, {
        mod: jogo.mod, especies: jogo.especies, hunts: welcome.hunts ?? [], consts, eu, ritmo: P.ritmo ?? null,
        mapaVisto: (slug) => (P.geo && P.geo.mapaDa ? P.geo.mapaDa(slug) : null) ?? null,
        ritmoMedido: (slug) => (chave && P.geo && P.geo.ritmoMedido ? P.geo.ritmoMedido(slug, chave) : null) ?? null,
      }, {ordem:'xp', soLiberadas:true, tipoDoDia:tipo});
    } catch { r = null; }
    const linhas = r && Array.isArray(r.linhas) ? r.linhas.filter((l) => l && !l.inviavel && l.liberada !== false) : [];
    const esp = r ? r.especie : (jogo.especies && jogo.especies.get ? jogo.especies.get(pk.speciesId) : null);
    const tipos = Array.isArray(pk.tipos) ? pk.tipos : (r && r.pokemon ? r.pokemon.tipos : []);
    membros.push({
      chave: String(pk.id), ativo: pk.id === eu.activeId, equipe: naEquipe(pk), nome: pk.nome, nivel: pk.level, potencia: pk.potencia ?? null,
      tipos, look: esp ? esp.looktype : (pk.looktype ?? null), tipoDoDia: Boolean(tipo && tipos.includes(tipo)),
      melhor: {treinador: melhorPor(linhas, 'xpTreinadorH'), ouro: melhorPor(linhas, 'ouroH'), pokemon: melhorPor(linhas, 'xpPokemonH')},
    });
  }
  return {estado:'ok', assinatura, membros, total: todos.length, tipoDoDia: tipo, tipoFim: ds && Number.isFinite(ds.fim) ? ds.fim : null};
})()`;
export const TEAM_PROBE_SCRIPT = page(false);
export const TEAM_FULL_SCRIPT = page(true);
/** Sonda leve só da tipagem do dia e de quem é do tipo (equipe e coleção, nomes até 8 cada). Nenhum cálculo. */
export const DAY_TYPE_SCRIPT = `(() => {
  const P = globalThis.__pokeidleHunt;
  if (!P || typeof P.on !== 'function') return null;
  let eu = null; const sair = P.on('estado', (d) => { eu = d; }); if (typeof sair === 'function') sair();
  const ds = eu && eu.diaSazonal;
  if (!ds || !/^[A-Z]{3,12}$/.test(ds.tipo)) return null;
  const todos = Array.isArray(eu.pokemons) ? eu.pokemons : [];
  const doTipo = todos.filter((p) => p && Array.isArray(p.tipos) && p.tipos.includes(ds.tipo)).sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));
  const nome = (p) => String(p.nome || 'Pokémon').slice(0, 40) + ' Nv ' + (Number(p.level) || '?');
  return {tipo: ds.tipo, fim: ds.fim, chave: ds.chave, equipe: doTipo.filter((p) => p.slot != null).slice(0, 8).map(nome), colecao: doTipo.filter((p) => p.slot == null).slice(0, 8).map(nome)};
})()`;

// ---- sanitização ----------------------------------------------------------------------------
const TIPO_RE = /^[A-Z]{3,12}$/;
function pickHunt(value: unknown): PickHunt | null {
  if (!isRecord(value)) return null;
  const nome = text(value.nome), valor = amount(value.valor);
  return nome === null || valor === null ? null : {nome, regiao: text(value.regiao, 24) ?? '', valor};
}
function member(value: unknown, sprites: ReadonlyMap<number, HuntSprite>): PickMember | null {
  if (!isRecord(value)) return null;
  const chave = text(value.chave, 40), nivel = whole(value.nivel, 1, 1e7);
  if (chave === null || nivel === null) return null;
  const melhor = isRecord(value.melhor) ? value.melhor : {};
  return {
    chave, nome: text(value.nome, 60) ?? 'Pokémon', nivel, ativo: value.ativo === true, equipe: value.equipe === true,
    tipos: (Array.isArray(value.tipos) ? value.tipos.slice(0, 3) : []).flatMap(tipo => typeof tipo === 'string' && TIPO_RE.test(tipo) ? [tipo] : []),
    potencia: whole(value.potencia, 1, 5), sprite: sprites.get(lookOf(value) ?? 0) ?? null, tipoDoDia: value.tipoDoDia === true,
    melhor: Object.fromEntries((['treinador', 'ouro', 'pokemon'] as TeamMetric[]).map(key => [key, pickHunt(melhor[key])])) as Record<TeamMetric, PickHunt | null>,
  };
}
export function sanitizeTeamPick(raw: unknown, sprites: ReadonlyMap<number, HuntSprite> = new Map(), lidoEm = Date.now()): TeamPick | null {
  if (!isRecord(raw)) return null;
  if (raw.estado === 'sem-extensao' || raw.estado === 'sem-jogo' || raw.estado === 'sem-pokemon') return {estado: raw.estado};
  if (raw.estado !== 'ok' || !Array.isArray(raw.membros)) return null;
  const seen = new Set<string>();
  const membros = raw.membros.slice(0, MAX_TEAM + MAX_EXTRA).flatMap(item => { const clean = member(item, sprites); if (!clean || seen.has(clean.chave)) return []; seen.add(clean.chave); return [clean]; });
  if (!membros.length) return null;
  const tipo = typeof raw.tipoDoDia === 'string' && TIPO_RE.test(raw.tipoDoDia) ? raw.tipoDoDia : null;
  return {estado: 'ok', membros, total: Math.max(membros.length, whole(raw.total, 1, 1e6) ?? 0), tipoDoDia: tipo, tipoFim: tipo ? amount(raw.tipoFim, 1e14) : null, lidoEm};
}
export function sanitizeDayType(raw: unknown): (DayType & {equipe: string[]; colecao: string[]}) | null {
  if (!isRecord(raw) || typeof raw.tipo !== 'string' || !TIPO_RE.test(raw.tipo)) return null;
  const chave = text(raw.chave, 20);
  const nomes = (value: unknown) => (Array.isArray(value) ? value.slice(0, 8) : []).flatMap(item => text(item, 60) ?? []);
  return {tipo: raw.tipo, fim: amount(raw.fim, 1e14), chave: chave ?? raw.tipo, equipe: nomes(raw.equipe), colecao: nomes(raw.colecao)};
}

// ---- leitura --------------------------------------------------------------------------------
export type TeamResult = {ok: true; data: TeamPick} | {ok: false; error: string};
const cache = new Map<string, {identity: object | undefined; assinatura: string; data: TeamPick & {estado: 'ok'}}>();
const lastRun = new Map<string, number>();
const running = new Map<string, Promise<TeamResult>>();
async function read(id: string, target: HuntTarget, force: boolean, timeoutMs: number): Promise<TeamResult> {
  const fail: TeamResult = {ok: false, error: HUNT_UNAVAILABLE};
  try {
    if (!target.hasExtension) return {ok: true, data: {estado: 'sem-extensao'}};
    if (!atGame(target.url)) return {ok: true, data: {estado: 'sem-jogo'}};
    const saved = cache.get(id);
    const cached = saved && saved.identity === target.identity ? saved : null;
    const recent = Date.now() - (lastRun.get(id) ?? -Infinity) < TEAM_MIN_INTERVAL_MS;
    if (cached && recent) return {ok: true, data: cached.data};
    const probe = await timed(target.run(TEAM_PROBE_SCRIPT), timeoutMs);
    if (!isRecord(probe)) return fail;
    if (probe.estado !== 'ok') { const data = sanitizeTeamPick(probe); return data && data.estado !== 'ok' ? {ok: true, data} : fail; }
    const assinatura = typeof probe.assinatura === 'string' && probe.assinatura.length <= 6000 ? probe.assinatura : null;
    if (assinatura === null) return fail;
    if (!force && cached && cached.assinatura === assinatura && Date.now() - cached.data.lidoEm < KEEP_MS) return {ok: true, data: cached.data};
    if (recent) return cached ? {ok: true, data: cached.data} : {ok: false, error: TEAM_WAIT};
    lastRun.set(id, Date.now());
    const raw = await timed(target.run(TEAM_FULL_SCRIPT), timeoutMs);
    const sprites = await spritesFor(isRecord(raw) && Array.isArray(raw.membros) ? raw.membros.slice(0, MAX_TEAM + MAX_EXTRA).flatMap(item => lookOf(item) ?? []) : [], target);
    const data = sanitizeTeamPick(raw, sprites);
    if (!data) return fail;
    if (data.estado === 'ok') cache.set(id, {identity: target.identity, assinatura, data});
    return {ok: true, data};
  } catch { return fail; }
}
/** Equipe da conta com o melhor resultado do /hunt por Pokémon. `force` ignora o cache de 10 min (ainda respeita 60 s). */
export function teamPick(id: unknown, knownIds: readonly string[], target: (id: string) => HuntTarget | null, force: unknown = false, timeoutMs = 25_000): Promise<TeamResult> {
  if (typeof id !== 'string' || !knownIds.includes(id)) return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE});
  let found: HuntTarget | null;
  try { found = target(id); } catch { found = null; }
  if (!found) { cache.delete(id); return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE}); }
  const pending = running.get(id);
  if (pending) return pending;
  const work = read(id, found, force === true, timeoutMs).finally(() => running.delete(id));
  running.set(id, work);
  return work;
}
