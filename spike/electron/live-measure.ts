import type { Hunt, Measurement } from '../contracts/grindolino';
import { LIVE_MAX_ACTIVE, LIVE_MAX_MS, type LiveEnded, type LiveEndReason, type LivePokemon, type LiveSession, type LiveStatus } from '../contracts/live';
import { GrindolinoError, huntKey, parseId } from '../domain/grindolino';
import { addEvents, emptyTotals, LIVE_LINE_MAX, parseLogLine, type LiveEvent } from '../domain/live';
import { atGame, isRecord, text, timed, whole } from './hunt-snapshot';

export const LIVE_POLL_MS = 5000;
const READ_MS = 4000;
const MAX_LINES = 2000; // fila na página; além disso as linhas são só contadas (viram "perdidas")
const MAX_FAILURES = 3; // leituras seguidas sem resposta até considerar a sessão caída

// Código fixo executado na página do jogo: nunca recebe dado do renderer e só LÊ.
// Guarda, na memória da janela (propriedade não enumerável), as linhas novas do log visível que citam abate ou captura.
// Sem seletor: o log é reconhecido pelo texto dos nós ACRESCENTADOS ao DOM; o histórico já na tela não entra.
// Não clica, não escreve no DOM, não usa rede, cookies nem storage. Fonte e riscos: docs/data-sources.md.
const KEY = `Symbol.for('pokehub.live')`;
// Pokémon em campo: último `estado` retido no barramento da extensão /hunt (assina e desassina na hora), como hunt-snapshot.
const POKEMON = `(() => {
    try {
      const P = globalThis.__pokeidleHunt;
      if (!P || typeof P.on !== 'function') return null;
      let eu = null; const sair = P.on('estado', (d) => { eu = d; }); if (typeof sair === 'function') sair();
      const pk = eu && Array.isArray(eu.pokemons) ? eu.pokemons.find((p) => p && p.id === eu.activeId) : null;
      return pk && pk.id != null ? {key: String(pk.id), nome: typeof pk.nome === 'string' ? pk.nome : null, nivel: typeof pk.level === 'number' ? pk.level : null} : null;
    } catch { return null; }
  })()`;
const STOP = `{ const velho = globalThis[${KEY}]; if (velho) { try { velho.stop(); } catch {} delete globalThis[${KEY}]; } }`;
export const LIVE_INSTALL_SCRIPT = `(() => {
  ${STOP}
  const S = {id: Math.random().toString(36).slice(2, 12) + Date.now().toString(36), seq: 0, lines: [], slug: null, stop: null};
  const CHAVE = /derrotad|capturad/gi;
  const umaLinha = (t) => typeof t === 'string' && t.length <= ${LIVE_LINE_MAX} && (t.match(CHAVE) || []).length === 1;
  // o nó acrescentado pode ser só um pedaço da linha: sobe enquanto o pai ainda for uma linha só
  const linhaDe = (no) => {
    let el = no.nodeType === 1 ? no : no.parentElement;
    if (!el || !umaLinha(no.textContent)) return null;
    for (let i = 0; i < 3 && el.parentElement && umaLinha(el.parentElement.textContent); i++) el = el.parentElement;
    return el;
  };
  const obs = new MutationObserver((registros) => {
    const novos = new Set(), vistos = new Set(), saiu = new Map(), linhas = [];
    for (const r of registros) {
      for (const no of r.removedNodes) if (umaLinha(no.textContent)) saiu.set(r.target, (saiu.get(r.target) || 0) + 1);
      for (const no of r.addedNodes) {
        novos.add(no);
        const el = linhaDe(no);
        if (el && !vistos.has(el)) { vistos.add(el); linhas.push([r.target, el.textContent]); }
      }
    }
    // log redesenhado por inteiro (nenhuma linha antiga sobrou no contêiner): conta só o crescimento, não o histórico de novo
    const pular = new Map();
    for (const [alvo, n] of saiu) if (n >= 2 && ![...alvo.childNodes].some((c) => !novos.has(c) && umaLinha(c.textContent))) pular.set(alvo, n);
    for (const [alvo, texto] of linhas) {
      const n = pular.get(alvo) || 0;
      if (n > 0) { pular.set(alvo, n - 1); continue; }
      S.seq++;
      if (S.lines.length < ${MAX_LINES}) S.lines.push(texto);
    }
  });
  obs.observe(document.documentElement, {childList: true, subtree: true});
  // troca de hunt: a extensão /hunt, se carregada, repassa a entrada em campo; só o slug é guardado
  let sair = null;
  try {
    const P = globalThis.__pokeidleHunt;
    if (P && typeof P.on === 'function') sair = P.on('campo.init', (m) => { if (m && typeof m.slug === 'string' && !m.centro && !m.pvp && m.casa == null) S.slug = m.slug.slice(0, 80); });
  } catch {}
  S.stop = () => { obs.disconnect(); if (typeof sair === 'function') sair(); };
  Object.defineProperty(globalThis, ${KEY}, {value: S, configurable: true, enumerable: false});
  return {estado: 'ok', id: S.id, seq: 0, slug: null, lines: [], pokemon: ${POKEMON}};
})()`;
export const LIVE_READ_SCRIPT = `(() => {
  const S = globalThis[${KEY}];
  if (!S) return {estado: 'ausente'};
  return {estado: 'ok', id: S.id, seq: S.seq, slug: S.slug, lines: S.lines.splice(0), pokemon: ${POKEMON}};
})()`;
export const LIVE_STOP_SCRIPT = `(() => { ${STOP} return true; })()`;

// ---- sanitização: o retorno vem de página remota --------------------------------------------
export type LiveRead = {estado: 'ausente'} | {estado: 'ok'; id: string; seq: number; slug: string | null; lines: string[]; pokemon: LivePokemon | null};
function pokemon(value: unknown): LivePokemon | null {
  if (!isRecord(value)) return null;
  const key = text(value.key, 40);
  return key === null ? null : {key, name: text(value.nome, 60), level: whole(value.nivel, 1, 1e7)};
}
export function sanitizeLiveRead(raw: unknown): LiveRead | null {
  if (!isRecord(raw)) return null;
  if (raw.estado === 'ausente') return {estado: 'ausente'};
  const seq = whole(raw.seq, 0, 1e12);
  if (raw.estado !== 'ok' || typeof raw.id !== 'string' || !/^[a-z0-9]{1,40}$/.test(raw.id) || seq === null || !Array.isArray(raw.lines) || raw.lines.length > MAX_LINES) return null;
  return {estado: 'ok', id: raw.id, seq, slug: text(raw.slug, 80), lines: raw.lines.flatMap(line => text(line, LIVE_LINE_MAX) ?? []), pokemon: pokemon(raw.pokemon)};
}

// ---- sessões de medição ----------------------------------------------------------------------
export interface LiveTarget { url: string; run(script: string): Promise<unknown> }
export interface LiveDeps {
  accounts(): string[];
  /** `null` quando a conta não tem sessão aberta e utilizável. */
  target(id: string): LiveTarget | null;
  store: {listHunts(): Hunt[]; createHunt(input: unknown): Hunt; addMeasurement(input: unknown): Measurement};
  now?: () => number;
}
interface Session extends LiveSession { pageId: string; seq: number; slug: string | null; failures: number; levelEnd: number | null }
const NO_SESSION = 'Abra o jogo nesta conta e espere carregar para iniciar a medição.';
const reasons: Record<LiveEndReason, string> = {
  user: '', limit: 'Limite de 12 h atingido. ',
  session: 'A sessão caiu ou a página do jogo recarregou. ', hunt: 'A hunt mudou. ', pokemon: 'O Pokémon em campo mudou. ',
};

export class LiveMeasure {
  private sessions = new Map<string, Session>();
  private ended = new Map<string, LiveEnded>();
  private starting = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private now: () => number;
  constructor(private deps: LiveDeps) { this.now = deps.now ?? Date.now; }

  status(): LiveStatus {
    const known = this.deps.accounts();
    return {
      active: [...this.sessions.values()].map(({accountId, huntId, huntName, startedAt, readAt, totals, pokemon, lostLines}) => ({accountId, huntId, huntName, startedAt, readAt, totals, pokemon, lostLines})),
      ended: [...this.ended.values()].filter(item => known.includes(item.accountId)),
    };
  }
  private open(id: string): LiveTarget | null {
    let found: LiveTarget | null;
    try { found = this.deps.target(id); } catch { found = null; }
    return found && atGame(found.url) ? found : null; // nunca executa em página de outro site (ex.: login do provedor)
  }
  async start(accountId: unknown, huntId: unknown): Promise<LiveStatus> {
    if (typeof accountId !== 'string' || !this.deps.accounts().includes(accountId)) throw new GrindolinoError('Conta inválida');
    const chosen = huntId === null ? null : parseId(huntId, 'Hunt inválida');
    if (chosen !== null && !this.deps.store.listHunts().some(hunt => hunt.id === chosen)) throw new GrindolinoError('Hunt não encontrada');
    if (this.sessions.has(accountId) || this.starting.has(accountId)) throw new GrindolinoError('Esta conta já está em medição.');
    if (this.sessions.size + this.starting.size >= LIVE_MAX_ACTIVE) throw new GrindolinoError(`No máximo ${LIVE_MAX_ACTIVE} medições ao mesmo tempo.`);
    const target = this.open(accountId);
    if (!target) throw new GrindolinoError(NO_SESSION);
    this.starting.add(accountId);
    try {
      let read: LiveRead | null;
      try { read = sanitizeLiveRead(await timed(target.run(LIVE_INSTALL_SCRIPT), READ_MS)); } catch { read = null; }
      if (read?.estado !== 'ok') throw new GrindolinoError(NO_SESSION);
      const at = this.now();
      this.sessions.set(accountId, {accountId, huntId: chosen, huntName: null, startedAt: at, readAt: at, totals: emptyTotals(), pokemon: read.pokemon, lostLines: 0, pageId: read.id, seq: 0, slug: null, failures: 0, levelEnd: read.pokemon?.level ?? null});
      this.ended.delete(accountId);
      this.timer ??= setInterval(() => void this.tick(), LIVE_POLL_MS);
    } finally { this.starting.delete(accountId); }
    return this.status();
  }
  async stop(accountId: unknown): Promise<LiveStatus> {
    const session = typeof accountId === 'string' ? this.sessions.get(accountId) : undefined;
    if (!session) throw new GrindolinoError('Esta conta não está em medição.');
    if (await this.poll(session)) this.finish(session, 'user', session.readAt); // os totais valem até a última leitura boa; a última leitura pode encerrar sozinha (ex.: hunt mudou)
    return this.status();
  }
  /** Uma rodada de leitura de todas as medições ativas; chamada pelo temporizador de 5 s. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const session of [...this.sessions.values()]) {
        if (!await this.poll(session)) continue;
        if (this.now() - session.startedAt >= LIVE_MAX_MS) this.finish(session, 'limit', session.readAt);
      }
    } finally { this.ticking = false; }
  }
  /** Lê as linhas novas de uma conta. Devolve false se a medição foi encerrada aqui. */
  private async poll(session: Session): Promise<boolean> {
    const target = this.open(session.accountId);
    let read: LiveRead | null = null;
    if (target) try { read = sanitizeLiveRead(await timed(target.run(LIVE_READ_SCRIPT), READ_MS)); } catch { read = null; }
    if (this.sessions.get(session.accountId) !== session) return false; // encerrada enquanto a página respondia
    if (!read) {
      if (++session.failures < MAX_FAILURES) return true;
      this.finish(session, 'session', session.readAt); return false;
    }
    // contador sumiu, é de outra carga da página ou andou para trás: a página recarregou
    const gap = read.estado === 'ok' && read.id === session.pageId ? read.seq - session.seq - read.lines.length : -1;
    if (read.estado !== 'ok' || gap < 0) { this.finish(session, 'session', session.readAt); return false; }
    const events = read.lines.flatMap(line => parseLogLine(line) ?? []);
    const kills = events.filter((event): event is Extract<LiveEvent, {kind: 'kill'}> => event.kind === 'kill');
    const name = session.huntName ?? kills[0]?.name ?? null;
    // troca de hunt: slug da extensão quando há; senão, uma rodada inteira de abates de outra espécie
    const moved = (session.slug !== null && read.slug !== null && read.slug !== session.slug)
      || (name !== null && kills.length >= 3 && kills.every(kill => huntKey(kill.name) !== huntKey(name)));
    if (moved) { this.finish(session, 'hunt', session.readAt); return false; }
    if (session.pokemon && read.pokemon && read.pokemon.key !== session.pokemon.key) { this.finish(session, 'pokemon', session.readAt); return false; }
    session.pokemon ??= read.pokemon;
    session.levelEnd = read.pokemon?.level ?? session.levelEnd;
    session.slug ??= read.slug;
    session.huntName = name;
    session.totals = addEvents(session.totals, events);
    session.lostLines += gap;
    session.seq = read.seq; session.readAt = this.now(); session.failures = 0;
    return true;
  }
  /** Encerra e grava o que foi lido até `endAt`. Nunca lança: falha de gravação vira aviso. */
  private finish(session: Session, reason: LiveEndReason, endAt: number): void {
    this.sessions.delete(session.accountId);
    if (!this.sessions.size) { clearInterval(this.timer); this.timer = undefined; }
    void Promise.resolve().then(() => this.open(session.accountId)?.run(LIVE_STOP_SCRIPT)).catch(() => {}); // tira o observador da página
    const {totals, huntName} = session;
    // shortcut: a medição guarda minutos inteiros (erro de até 30 s na duração); gravar segundos se sessões curtas passarem a importar
    const minutes = Math.round((endAt - session.startedAt) / 60_000);
    let measurement: Measurement | null = null, notice: string;
    if (totals.kills === 0 || huntName === null) notice = 'Nenhum abate foi lido do log do jogo; nada foi gravado.';
    else if (minutes < 1) notice = 'Medição com menos de 1 minuto; nada foi gravado.';
    else try {
      const {store} = this.deps;
      const huntId = session.huntId ?? store.listHunts().find(hunt => huntKey(hunt.name) === huntKey(huntName))?.id ?? store.createHunt({name: huntName.slice(0, 60), region: '', requiredTrainerLevel: null}).id;
      measurement = store.addMeasurement({accountId: session.accountId, huntId, minutes, xpGained: totals.pokemonXp /* XP do pokémon: mesma grandeza da previsão do /hunt */, coinsGained: totals.coins, killCount: totals.kills, shinyCount: totals.shinies,
        pokemonKey: session.pokemon?.key ?? null, pokemonName: session.pokemon?.name ?? null, pokemonLevel: session.pokemon?.level ?? null, pokemonLevelEnd: session.levelEnd});
      notice = `${reason === 'user' || reason === 'limit' ? 'Medição gravada' : 'Medição parcial gravada'}: ${minutes} min em ${huntName}.`;
    } catch { notice = 'Não foi possível gravar a medição.'; }
    if (session.lostLines > 0) notice += ' Parte do log não foi lida; as taxas podem estar subestimadas.';
    this.ended.set(session.accountId, {accountId: session.accountId, reason, measurement, huntName, notice: reasons[reason] + notice, endedAt: endAt});
  }
  /** Fechamento do aplicativo: grava o parcial de cada medição até a última leitura. */
  dispose(): void {
    for (const session of [...this.sessions.values()]) this.finish(session, 'session', session.readAt);
    clearInterval(this.timer); this.timer = undefined;
  }
}
