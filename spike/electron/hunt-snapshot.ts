import type { HuntBonus, HuntRow, HuntSnapshot, HuntSprite } from '../contracts/hunt';

export const HUNT_UNAVAILABLE = 'Dados do /hunt indisponíveis nesta conta';
const GAME_ORIGIN = 'https://pokeidle.io';
const MAX_ROWS = 60;
const SPRITE_MS = 4000;
const CACHE_MS = 180_000; // os bônus de XP expiram sem mudar a assinatura

// Código fixo executado na página do jogo: nunca recebe dado do renderer. Só lê o que a extensão
// expõe em `__pokeidleHunt` (últimos eventos retidos do barramento) e chama o cálculo DELA
// (`engine.analisar`), com o mesmo contexto que o painel dela monta. Não toca em cookies nem storage.
// `full` e `soLiberadas` são booleanos fixos: existem exatamente três scripts, montados na carga do módulo.
const page = (full: boolean, soLiberadas = true) => `(async () => {
  const P = globalThis.__pokeidleHunt;
  if (!P || typeof P.on !== 'function' || typeof P.carregarJogo !== 'function' || !P.engine || typeof P.engine.analisar !== 'function') return {estado:'sem-extensao'};
  const s = (v, n) => String(v == null ? '' : v).slice(0, n || 80);
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const ultimo = (tipo) => { let v = null; const sair = P.on(tipo, (d) => { v = d; }); if (typeof sair === 'function') sair(); return v; };
  const welcome = ultimo('welcome'), eu = ultimo('estado');
  if (!welcome || !eu) return {estado:'sem-jogo'};
  const pk = Array.isArray(eu.pokemons) ? eu.pokemons.find((p) => p && p.id === eu.activeId) : null;
  if (!pk) return {estado:'sem-pokemon'};
  const tipo = eu.diaSazonal && /^[A-Z]{3,12}$/.test(eu.diaSazonal.tipo) ? eu.diaSazonal.tipo : null;
  const assinatura = s([pk.id, pk.level, JSON.stringify(pk.stats), tipo, eu.level].join('|'), 2000);
  if (!${full}) return {estado:'ok', assinatura};
  const jogo = await P.carregarJogo();
  const chave = P.geo && P.geo.chaveDoPokemon ? P.geo.chaveDoPokemon(pk) : null;
  const r = P.engine.analisar(pk, {
    mod: jogo.mod, especies: jogo.especies, hunts: welcome.hunts ?? [],
    consts: {tabelaTipos: welcome.tabelaTipos, ampliacaoHunt: welcome.ampliacaoHunt, multHpSelvagem: welcome.multHpSelvagem, multDanoSelvagem: welcome.multDanoSelvagem, tiposBoost: welcome.tiposBoost, catalogoBolas: welcome.catalogoBolas, captura: welcome.captura, chanceShiny: welcome.chanceShiny, shinyLooks: welcome.shinyLooks},
    eu, ritmo: P.ritmo ?? null,
    mapaVisto: (slug) => (P.geo && P.geo.mapaDa ? P.geo.mapaDa(slug) : null) ?? null,
    ritmoMedido: (slug) => (chave && P.geo && P.geo.ritmoMedido ? P.geo.ritmoMedido(slug, chave) : null) ?? null,
  }, {ordem:'xp', soLiberadas:${soLiberadas}, tipoDoDia:tipo});
  const vivas = r.linhas.filter((l) => !l.inviavel);
  const top = (k) => vivas.filter((l) => l[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, 20);
  const look = (id) => { const e = jogo.especies && jogo.especies.get ? jogo.especies.get(id) : null; return e ? e.looktype : null; };
  const escolhidas = [...new Set([...vivas.slice(0, 20), ...top('ouroH'), ...top('shinyH')])];
  return {
    estado: 'ok', assinatura,
    pokemon: {nome: s(r.pokemon.nome), nivel: n(r.pokemon.level), look: r.especie ? n(r.especie.looktype) : null},
    bonus: r.bonusXp ? {pokemon: n(r.bonusXp.pokemon), treinador: n(r.bonusXp.treinador), itens: (r.bonusXp.itens ?? []).slice(0, 8).map((i) => ({nome: s(i.nome, 40), mult: n(i.mult)}))} : null,
    hunts: escolhidas.slice(0, ${MAX_ROWS}).map((l) => ({nome: s(l.nome), regiao: s(l.regiao, 24), nivel: n(l.nivel), xpPorHora: n(l.xpPokemonH), abatesPorHora: n(l.kph), mataEm: n(l.ttk), ouroPorHora: n(l.ouroH), shinyPorHora: l.shinyChance ? n(l.shinyH) : null, estimado: l.ritmo !== 'jogo' || !!(l.aoe && l.aoe.estimado), umHit: !!l.umHit, mortesPorHora: n(l.mortesH), piorGolpe: n(l.hitPct), liberada: l.liberada !== false, look: n(look(l.pokeId))})),
    soLiberadas: ${soLiberadas}, liberadas: r.linhas.filter((l) => l.liberada !== false).length, total: n(r.total), versaoJogo: jogo.versao == null ? null : s(jogo.versao, 24),
  };
})()`;
export const HUNT_PROBE_SCRIPT = page(false);
export const HUNT_FULL_SCRIPT = page(true);
export const HUNT_ALL_SCRIPT = page(true, false); // inclui hunts ainda bloqueadas pelo nível do treinador

// ---- sanitização: o retorno vem de página remota --------------------------------------------
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function text(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null;
  // controles e caracteres de formatação (bidi, largura zero) não chegam à interface
  const clean = value.slice(0, max * 4).replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max);
  return clean || null;
}
export function amount(value: unknown, max = 1e15): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null;
}
export const whole = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
type Sprites = ReadonlyMap<number, HuntSprite>;
const NO_SPRITES: Sprites = new Map();
/** Retrato de uma espécie como o jogo publica (`/tracker/api/sprites`): atlas no próprio jogo + janela. Só aceita imagem https de pokeidle.io. */
export function sanitizeSprite(value: unknown): HuntSprite | null {
  if (!isRecord(value) || typeof value.img !== 'string' || value.img.length > 300 || /\.\.|%2e|[\\\s\p{Cc}]/iu.test(value.img)) return null;
  let url: URL;
  try { url = new URL(value.img, `${GAME_ORIGIN}/`); } catch { return null; }
  if (url.protocol !== 'https:' || url.origin !== GAME_ORIGIN || url.username || url.password || url.pathname.length < 2 || url.href.length > 300) return null;
  const x = whole(value.x, 0, 16384), y = whole(value.y, 0, 16384), w = whole(value.w, 1, 256), h = whole(value.h, 1, 256);
  return x === null || y === null || w === null || h === null ? null : {url: url.href, x, y, w, h};
}
export const lookOf = (value: unknown) => isRecord(value) ? whole(value.look, 1, 1e7) : null;
function row(value: unknown, sprites: Sprites): HuntRow | null {
  if (!isRecord(value)) return null;
  const nome = text(value.nome), nivel = amount(value.nivel, 1e7), xpPorHora = amount(value.xpPorHora), abatesPorHora = amount(value.abatesPorHora, 1e9), mataEm = amount(value.mataEm, 1e6), ouroPorHora = amount(value.ouroPorHora);
  if (nome === null || nivel === null || xpPorHora === null || abatesPorHora === null || mataEm === null || ouroPorHora === null) return null;
  return {nome, regiao: text(value.regiao, 24) ?? '', nivel: Math.round(nivel), xpPorHora, abatesPorHora, mataEm, ouroPorHora, shinyPorHora: amount(value.shinyPorHora, 1e6), estimado: value.estimado === true, umHit: value.umHit === true, mortesPorHora: amount(value.mortesPorHora, 1e6) ?? 0, piorGolpe: amount(value.piorGolpe, 1000) ?? 0, liberada: value.liberada !== false, sprite: sprites.get(lookOf(value) ?? 0) ?? null};
}
function bonus(value: unknown): HuntBonus | null {
  if (!isRecord(value)) return null;
  const pokemon = amount(value.pokemon, 1e6), treinador = amount(value.treinador, 1e6);
  if (pokemon === null || treinador === null) return null;
  const itens = (Array.isArray(value.itens) ? value.itens.slice(0, 8) : []).flatMap(item => {
    const nome = isRecord(item) ? text(item.nome, 40) : null, mult = isRecord(item) ? amount(item.mult, 1e6) : null;
    return nome !== null && mult !== null ? [{nome, mult}] : [];
  });
  return {pokemon, treinador, itens};
}
/** Converte o retorno bruto da página em um retrato válido, ou `null` se não der para confiar nele. */
export function sanitizeHuntSnapshot(raw: unknown, versaoExtensao: string | null = null, sprites: Sprites = NO_SPRITES): HuntSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.estado === 'sem-extensao' || raw.estado === 'sem-jogo' || raw.estado === 'sem-pokemon') return {estado: raw.estado};
  if (raw.estado !== 'ok' || !isRecord(raw.pokemon) || !Array.isArray(raw.hunts)) return null;
  const nome = text(raw.pokemon.nome), nivel = amount(raw.pokemon.nivel, 1e7);
  if (nome === null || nivel === null) return null;
  const hunts = raw.hunts.slice(0, MAX_ROWS).flatMap(item => row(item, sprites) ?? []);
  return {
    estado: 'ok', pokemon: {nome, nivel: Math.round(nivel), sprite: sprites.get(lookOf(raw.pokemon) ?? 0) ?? null}, bonus: bonus(raw.bonus), hunts,
    liberadas: Math.round(amount(raw.liberadas, 1e5) ?? hunts.length), total: Math.round(amount(raw.total, 1e5) ?? hunts.length),
    filtro: {ordem: 'xp', soLiberadas: raw.soLiberadas !== false}, versaoJogo: text(raw.versaoJogo, 24), versaoExtensao: text(versaoExtensao, 24),
  };
}

// ---- leitura --------------------------------------------------------------------------------
export interface HuntTarget {
  url: string; hasExtension: boolean; version: string | null;
  /** Identidade da view: uma sessão reaberta não pode reaproveitar dados da anterior. */
  identity?: object;
  run(script: string): Promise<unknown>;
  /** Resposta crua de `https://pokeidle.io/tracker/api/sprites?lt=…`, pedida fora da sessão do jogo (sem cookies). */
  sprites?(looks: number[]): Promise<unknown>;
}
export type HuntResult = {ok: true; data: HuntSnapshot} | {ok: false; error: string};
const cache = new Map<string, {identity: object | undefined; assinatura: string; at: number; data: HuntSnapshot}>();
const running = new Map<string, {identity: object | undefined; work: Promise<HuntResult>}>();
const spriteCache = new Map<number, HuntSprite>(); // looktype → retrato; o atlas tem nome com hash, não muda
/** Retratos por looktype (cache em memória); o que faltar é pedido ao jogo fora da sessão logada. Nunca lança. */
export async function spritesFor(wanted: readonly number[], target: HuntTarget): Promise<Sprites> {
  const looks = [...new Set(wanted)].filter(look => !spriteCache.has(look));
  if (!target.sprites || !looks.length) return spriteCache;
  try { // sem retrato a interface mostra a inicial: nunca derruba o ranking
    const answer = await timed(target.sprites(looks), SPRITE_MS);
    const found = isRecord(answer) && isRecord(answer.retratos) ? answer.retratos : {};
    if (spriteCache.size > 2000) spriteCache.clear();
    for (const look of looks) { const sprite = sanitizeSprite(found[look]); if (sprite) spriteCache.set(look, sprite); }
  } catch { /* segue sem imagem */ }
  return spriteCache;
}
async function loadSprites(raw: unknown, target: HuntTarget): Promise<void> {
  if (isRecord(raw) && Array.isArray(raw.hunts)) await spritesFor([raw.pokemon, ...raw.hunts.slice(0, MAX_ROWS)].flatMap(item => lookOf(item) ?? []), target);
}
export function timed(work: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('tempo esgotado')), ms); })]).finally(() => clearTimeout(timer));
}
export const atGame = (url: string) => { try { return new URL(url).origin === GAME_ORIGIN; } catch { return false; } };
async function read(key: string, target: HuntTarget, timeoutMs: number, soLiberadas: boolean, isCurrent: () => boolean): Promise<HuntResult> {
  const fail: HuntResult = {ok: false, error: HUNT_UNAVAILABLE};
  try {
    if (!target.hasExtension) return {ok: true, data: {estado: 'sem-extensao'}};
    if (!atGame(target.url)) return {ok: true, data: {estado: 'sem-jogo'}}; // nunca executa em página de outro site (ex.: login do provedor)
    const probe = await timed(target.run(HUNT_PROBE_SCRIPT), timeoutMs);
    if (!isCurrent()) return fail;
    if (!isRecord(probe)) return fail;
    if (probe.estado !== 'ok') { const data = sanitizeHuntSnapshot(probe); return data && data.estado !== 'ok' ? {ok: true, data} : fail; }
    const assinatura = typeof probe.assinatura === 'string' && probe.assinatura.length <= 2000 ? probe.assinatura : null;
    if (assinatura === null) return fail;
    const cached = cache.get(key);
    if (cached && cached.identity === target.identity && cached.assinatura === assinatura && Date.now() - cached.at < CACHE_MS) return {ok: true, data: cached.data}; // evita recalcular (~0,6 s na página) a cada consulta
    const raw = await timed(target.run(soLiberadas ? HUNT_FULL_SCRIPT : HUNT_ALL_SCRIPT), timeoutMs);
    await loadSprites(raw, target);
    const data = sanitizeHuntSnapshot(raw, target.version, spriteCache);
    if (!data) return fail;
    if (!isCurrent()) return fail;
    if (data.estado === 'ok' && isCurrent()) cache.set(key, {identity:target.identity, assinatura, at: Date.now(), data});
    return {ok: true, data};
  } catch { return fail; }
}
/** `target` devolve `null` quando a conta não tem sessão aberta e utilizável. */
export function huntSnapshot(id: unknown, knownIds: readonly string[], target: (id: string) => HuntTarget | null, timeoutMs = 8000, soLiberadas: unknown = true): Promise<HuntResult> {
  if (typeof id !== 'string' || !knownIds.includes(id) || typeof soLiberadas !== 'boolean') return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE});
  const key = `${id}|${soLiberadas}`;
  let found: HuntTarget | null;
  try { found = target(id); } catch { found = null; }
  if (!found) { cache.delete(key); running.delete(key); return Promise.resolve({ok: false, error: HUNT_UNAVAILABLE}); }
  const pending = running.get(key);
  if (pending && pending.identity === found.identity) return pending.work; // uma leitura por view de cada vez
  const identity = found.identity;
  const work: Promise<HuntResult> = read(key, found, timeoutMs, soLiberadas, (): boolean => running.get(key)?.work === work).finally(() => { if (running.get(key)?.work === work) running.delete(key); });
  running.set(key, {identity,work});
  return work;
}
