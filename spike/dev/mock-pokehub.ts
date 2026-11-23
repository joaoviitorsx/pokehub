// Prévia no navegador: finge o window.pokehub exposto por spike/electron/preload.ts. Só para desenvolvimento.
import type { Profile, ProfileInput } from '../domain/profiles';
import type { ExtensionInfo } from '../contracts/extensions';
import type { HuntRow, HuntSnapshot } from '../contracts/hunt';
import type { MarketListing, MarketScan } from '../domain/market';
import type { UpdateInfo, UpdateStatus } from '../contracts/update';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
const ok = <T>(data: T): Promise<Result<T>> => new Promise(resolve => setTimeout(() => resolve({ok: true, data}), 40));
const params = new URLSearchParams(location.search);
const empty = params.get('state') === 'empty';
const now = '2026-11-23T12:00:00.000Z';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seed: [string, string, string, string][] = [
  ['Principal', 'principal@exemplo.com', 'Ash', '#e5484d'],
  ['Farm Kanto', 'farm.kanto@exemplo.com', 'Brock', '#3fa7d6'],
  ['Shiny Hunter', 'shiny@exemplo.com', 'Misty', '#ffca3a'],
  ['Mercado', 'mercado@exemplo.com', 'Gary', '#59cd90'],
];
let profiles: Profile[] = empty ? [] : seed.map(([label, emailLabel, characterName, colorToken], i) => ({id: uid(i + 1), label, emailLabel, characterName, colorToken, createdAt: now, updatedAt: now}));
const states: Record<string, string> = {[uid(1)]: 'ready', [uid(2)]: 'loading', [uid(3)]: 'auth_required', [uid(4)]: 'error'};
let preferences: 'grid' | 'focus-first' = 'grid';
let perfPrefs = {lite: params.get('lite') === '1', muteUnfocused: false};

const ext = (o: Partial<ExtensionInfo> & Pick<ExtensionInfo, 'id' | 'name'>): ExtensionInfo => ({catalogId: null, version: null, path: `C:\\Extensoes\\${o.name}`, enabled: true, loaded: 4, sessions: 4, verdict: 'leitura', findings: [], hosts: [], approvedHosts: [], pending: false, error: null, ...o});
let extensions: ExtensionInfo[] = [
  ext({id: 'hunt', catalogId: 'hunt', name: '/hunt', version: '1.0.23', verdict: 'externa', hosts: ['pokeidle.io'], approvedHosts: ['pokeidle.io'], findings: [{kind: 'network', file: 'hunt.js', detail: 'https://pokeidle.io/atlas.png'}]}),
  ext({id: 'lhfeijlnlbglakplddjgbaopgcdfkcmm', catalogId: 'smart-market', name: 'Smart Market', version: '1.2.2', verdict: 'interage', findings: [{kind: 'click', file: 'content.js', detail: 'element.click() em botões de compra'}]}),
  ext({id: 'x1', name: 'Auto Clicker Pro', version: '0.9.0', enabled: false, loaded: 0, verdict: 'bloqueada', error: 'Bloqueada: envia eventos sintéticos e usa eval.', findings: [{kind: 'eval', file: 'bg.js', detail: 'new Function(...)'}, {kind: 'dispatch', file: 'bg.js', detail: 'dispatchEvent(new MouseEvent)'}]}),
];
let update: UpdateInfo = {version: '0.1.0', packaged: true, autoCheck: true, status: {state: 'available', version: '0.1.1', notes: 'Novo painel de mercado e correções de sessão.'}};

const huntNames = ['Rota 3', 'Floresta de Viridian', 'Monte Lua', 'Caverna Rubi', 'Lago Azul', 'Torre Pokémon', 'Ilha Seafoam', 'Rota 22', 'Mansão Pokémon', 'Cidade Fuchsia', 'Cume do Monte', 'Liga Pokémon'];
const regions = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh'];
const hunts: HuntRow[] = huntNames.map((nome, i) => ({nome, regiao: regions[i % 4]!, nivel: 8 + i * 6, xpPorHora: 480000 - i * 31000, abatesPorHora: 1200 - i * 55, mataEm: 2.5 + i * 0.4, ouroPorHora: 95000 - i * 6200, shinyPorHora: i % 5 === 4 ? null : 0.4 - i * 0.02, estimado: i % 3 === 0, umHit: i < 4, mortesPorHora: i > 8 ? 3 : 0, piorGolpe: 0.08 + i * 0.07, liberada: i < 9, sprite: null}));
const huntSnapshot = (soLiberadas?: boolean): HuntSnapshot => ({estado: 'ok', pokemon: {nome: 'Charizard', nivel: 62, sprite: null}, bonus: {pokemon: 1.15, treinador: 1.1, itens: [{nome: 'Amuleto de XP', mult: 1.2}]}, hunts: soLiberadas ? hunts.filter(h => h.liberada) : hunts, liberadas: 9, total: 12, filtro: {ordem: 'xp', soLiberadas: Boolean(soLiberadas)}, versaoJogo: '2.14.0', versaoExtensao: '1.0.23'});
const names = ['Charizard', 'Gengar', 'Dragonite', 'Alakazam', 'Machamp', 'Gyarados', 'Arcanine', 'Snorlax', 'Lapras', 'Tyranitar', 'Scizor', 'Umbreon'];
const listings: MarketListing[] = Array.from({length: 15}, (_, i) => {
  const gold = i % 3 !== 2, label = (['desconto', 'no preço', 'acima'] as const)[i % 3]!;
  return {id: `L${i + 1}`, name: names[i % names.length]!, level: 20 + i * 4, potencia: 60 + (i * 7) % 40, nota: 3.2 + ((i * 13) % 17) / 10, shiny: i % 6 === 0, price: gold ? 250000 + i * 180000 : 40 + i * 12, currency: gold ? 'gold' : 'orb', smart: {label, pct: label === 'desconto' ? -(8 + i) : label === 'acima' ? 12 + i : 1, market: gold ? 300000 + i * 190000 : 50 + i * 12}};
});
// Vitrine simulada: 3 páginas de 5 anúncios; `?query=` define a busca (vazio = sem busca) e `?pages=` o total (>30 testa a recusa).
const queryParam = params.get('query') ?? 'Charizard', totalPages = Math.max(1, Number(params.get('pages')) || 3);
let marketPage = 1, reading = false, stopRead = false;
const scanPage = (): MarketScan => ({open: true, smart: true, page: marketPage, pages: totalPages, query: queryParam, listings: listings.slice(((marketPage - 1) % 3) * 5, ((marketPage - 1) % 3) * 5 + 5).map(l => ({...l, id: `P${marketPage}-${l.id}`}))});
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function readAllMock(id: string) {
  reading = true; stopRead = false; let collected = 0;
  const step = (done: boolean, error?: string) => emit('market-progress', {profileId: id, page: marketPage, pages: totalPages, collected, done, ...(error ? {error} : {}), ...(done ? {} : {scan: scanPage()})});
  collected += 5; step(false);
  while (!stopRead && marketPage < totalPages) { await wait(900); if (stopRead) break; marketPage++; collected += 5; step(false); }
  reading = false; step(true);
}
const diagnostics = () => ({sampledAt: new Date().toISOString(), memoryKb: 1_450_000 + Math.round(Math.random() * 90000), cpuPercent: 4 + Math.random() * 6, cpuIntervalMs: 2000, processCount: 11});

// Monitor por conta simulado: a conta 2 passa de 2 GB para exibir o aviso e o botão Recarregar; suspensas não têm processo.
const processes = () => ({
  sampledAt: new Date().toISOString(),
  accounts: profiles.map((p, i) => states[p.id] === 'suspended' ? {id: p.id, cpuPercent: null, privateKb: null, workingSetKb: null} : {id: p.id, cpuPercent: 2 + Math.random() * 8, privateKb: i === 1 ? 2_300_000 + Math.round(Math.random() * 40000) : 900_000 + i * 150_000, workingSetKb: 1_100_000 + i * 150_000}),
  hub: {cpuPercent: 1.2, privateKb: 180_000, workingSetKb: 260_000, count: 2},
  gpu: {cpuPercent: 3.4, privateKb: 210_000, workingSetKb: 240_000, count: 1},
  other: {cpuPercent: 0.2, privateKb: 60_000, workingSetKb: 90_000, count: 3},
});

type LayoutCall = {id: string | null; hide: boolean; side: boolean; panel: number; account: string | null};
export const layoutState: LayoutCall = {id: null, hide: false, side: false, panel: 340, account: null};
const layoutListeners = new Set<() => void>();
export const onLayoutChange = (cb: () => void) => { layoutListeners.add(cb); return () => { layoutListeners.delete(cb); }; };
const bus = new EventTarget();
export const emit = (type: string, detail?: unknown) => bus.dispatchEvent(new CustomEvent(type, {detail}));
const on = <T>(type: string, cb: (value: T) => void) => { const l = (e: Event) => cb((e as CustomEvent<T>).detail); bus.addEventListener(type, l); return () => bus.removeEventListener(type, l); };
const withExt = () => ok(extensions.map(e => ({...e})));
const setUpdate = (status: UpdateStatus) => { update = {...update, status}; emit('update', status); };

window.pokehub = {
  list: () => ok(profiles.map(p => ({...p}))),
  getPreferences: () => ok(preferences),
  getPerformance: () => ok({...perfPrefs}),
  setPerformance: change => { perfPrefs = {...perfPrefs, ...change}; return ok({...perfPrefs}); },
  suspend: id => { states[id] = 'suspended'; emit('status', {id, state: 'suspended'}); return ok(undefined); },
  resume: id => { states[id] = 'loading'; emit('status', {id, state: 'loading'}); setTimeout(() => { states[id] = 'ready'; emit('status', {id, state: 'ready'}); }, 1200); return ok(undefined); },
  processes: () => ok(processes()),
  setStartupMode: mode => { preferences = mode; return ok(mode); },
  initialFocus: () => ok(null),
  create: (input: ProfileInput) => { const p: Profile = {...input, id: uid(profiles.length + 10), createdAt: now, updatedAt: now}; profiles = [...profiles, p]; states[p.id] = 'loading'; return ok(p); },
  update: (id, input) => { const p = {...profiles.find(x => x.id === id)!, ...input}; profiles = profiles.map(x => x.id === id ? p : x); return ok(p); },
  remove: id => { profiles = profiles.filter(p => p.id !== id); return ok(undefined); },
  layout: (id, hide, side, panel = 340, account = null) => { Object.assign(layoutState, {id, hide, side, panel, account}); layoutListeners.forEach(l => l()); return ok(undefined); },
  drag: () => ok(undefined),
  huntSnapshot: (_id, soLiberadas) => ok(huntSnapshot(soLiberadas)),
  market: {
    scan: () => ok(scanPage()),
    readAll: id => {
      if (!queryParam) return ok(undefined).then(() => ({ok: false as const, error: 'Busque uma espécie no Mercado antes (ex.: Venusaur) — o Mercado inteiro tem centenas de páginas.'}));
      if (totalPages > 30) return ok(undefined).then(() => ({ok: false as const, error: `Esta busca tem ${totalPages} páginas; o limite é 30.`}));
      if (reading) return ok(undefined).then(() => ({ok: false as const, error: 'Já existe uma leitura de páginas em andamento nesta conta.'}));
      marketPage = 1; void readAllMock(id); return ok(undefined);
    },
    stop: () => { const was = reading; stopRead = true; return ok(was); },
    onProgress: cb => on<Parameters<typeof cb>[0]>('market-progress', cb),
  },
  onToggleSide: cb => on<void>('toggle-side', cb),
  onToggleExpand: cb => on<string | null>('toggle-expand', cb),
  reload: () => ok(undefined), restart: () => ok(undefined), clearSession: () => ok(undefined),
  states: () => ok({...states}),
  diagnostics: () => ok(diagnostics()),
  autoFocus: () => ok(null),
  extensions: {
    list: withExt, detect: withExt, add: withExt,
    toggle: (id, enabled) => { extensions = extensions.map(e => e.id === id ? {...e, enabled} : e); return withExt(); },
    remove: id => { extensions = extensions.filter(e => e.id !== id); return withExt(); },
    approve: (id, hosts) => { extensions = extensions.map(e => e.id === id ? {...e, approvedHosts: hosts, pending: false} : e); return withExt(); },
    openStore: () => ok(undefined),
  },
  updates: {
    get: () => ok(update),
    check: () => { setUpdate({state: 'available', version: '0.1.1', notes: update.status.notes}); return ok(update); },
    download: () => { setUpdate({state: 'ready', version: '0.1.1'}); return ok(update); },
    install: () => ok(undefined),
    setAuto: enabled => { update = {...update, autoCheck: enabled}; return ok(update); },
    onStatus: cb => on<UpdateStatus>('update', cb),
  },
  onAutoFocus: cb => on<string | null>('auto-focus', cb),
  onFocus: cb => on<string | null>('focus', cb),
  onStatus: cb => on<{id: string; state: string}>('status', cb),
};
export const mockProfiles = () => profiles;
