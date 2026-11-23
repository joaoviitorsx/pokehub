// Prévia no navegador: finge o window.pokehub exposto por spike/electron/preload.ts. Só para desenvolvimento.
import type { Profile, ProfileInput } from '../domain/profiles';
import type { ExtensionInfo } from '../contracts/extensions';
import type { NetworkInfo, NetworkMode } from '../contracts/network';
import type { HuntRow, HuntSnapshot, HuntSprite } from '../contracts/hunt';
import type { MarketListing, MarketScan } from '../domain/market';
import type { UpdateInfo, UpdateStatus } from '../contracts/update';
import type { PerformancePrefs } from '../contracts/preferences';
import type { Capture } from '../domain/captures';
import { createMockShop } from './mock-shop';

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
const sidePrefs = {width: Number(params.get('sidew')) || 340, rows: Number(params.get('rows')) || 10, compact: params.get('compact') === '1', liberadas: params.get('liberadas') !== '0'};
try { localStorage.setItem('pokehub.side', JSON.stringify(sidePrefs)); } catch { /* prévia sem armazenamento */ } // ?sidew=280..520 &rows=5|10|20 &compact=1
const accountCount = Math.min(4, Math.max(1, Number(params.get('accounts')) || 4)); // ?accounts=1..4
let profiles: Profile[] = empty ? [] : seed.slice(0, accountCount).map(([label0, emailLabel, characterName, colorToken], i) => ({id: uid(i + 1), label: params.get('long') === '1' ? `${label0} · conta com nome bem comprido ${i + 1}` : label0, emailLabel, characterName, colorToken, createdAt: now, updatedAt: now}));
const states: Record<string, string> = {[uid(1)]: 'ready', [uid(2)]: 'loading', [uid(3)]: 'auth_required', [uid(4)]: 'error'};
if (params.get('allready') === '1') for (const key of Object.keys(states)) states[key] = 'ready'; // ?allready=1: todas as contas prontas
let preferences: 'grid' | 'focus-first' = 'grid';
let winState = {maximized: false, focused: true};
let trayPrefs = {onClose: true, onMinimize: true, hintShown: false};
let perfPrefs = {lite: params.get('lite') === '1', muteUnfocused: false};

const ext = (o: Partial<ExtensionInfo> & Pick<ExtensionInfo, 'id' | 'name'>): ExtensionInfo => ({catalogId: null, version: null, path: `C:\\Extensoes\\${o.name}`, enabled: true, loaded: 4, sessions: 4, verdict: 'leitura', findings: [], hosts: [], approvedHosts: [], pending: false, error: null, ...o});
let extensions: ExtensionInfo[] = [
  ext({id: 'hunt', catalogId: 'hunt', name: '/hunt', version: '1.0.23', verdict: 'externa', hosts: ['pokeidle.io'], approvedHosts: ['pokeidle.io'], findings: [{kind: 'network', file: 'hunt.js', detail: 'https://pokeidle.io/atlas.png'}]}),
  ext({id: 'lhfeijlnlbglakplddjgbaopgcdfkcmm', catalogId: 'smart-market', name: 'Smart Market', version: '1.2.2', verdict: 'interage', findings: [{kind: 'click', file: 'content.js', detail: 'element.click() em botões de compra'}]}),
  ext({id: 'x1', name: 'Auto Clicker Pro', version: '0.9.0', enabled: false, loaded: 0, verdict: 'bloqueada', error: 'Bloqueada: envia eventos sintéticos e usa eval.', findings: [{kind: 'eval', file: 'bg.js', detail: 'new Function(...)'}, {kind: 'dispatch', file: 'bg.js', detail: 'dispatchEvent(new MouseEvent)'}]}),
];
let update: UpdateInfo = {version: '0.1.0', packaged: true, autoCheck: true, status: {state: 'available', version: '0.1.1', notes: 'Novo painel de mercado e correções de sessão.'}};

// Retratos reais (atlas + janela) copiados de https://pokeidle.io/tracker/api/sprites em 2026-11-23; só URLs, nenhuma imagem no repositório.
const atlas = (lt: number, x: number, w: number): HuntSprite => ({url: `https://pokeidle.io/assets/asset-packs/outfits/male/${lt}/outfits-male-${lt}-00-${hash[lt]}.webp`, x, y: 2, w, h: w});
const hash: Record<number, string> = {2: 'be33c2bc8dab', 3: 'db2fbcffcc6c', 4: '6d1493b52558', 5: '41d09caaf101', 6: 'f9c285dcb70b', 7: 'd0294ef34646', 9: 'ea564acc6d19', 10: '17539951f766', 11: '82219c097599', 14: 'a3f7235eb82e', 15: '423a9bf03911', 16: '26fd95172e31'};
const portraits: HuntSprite[] = [atlas(3, 398, 64), atlas(6, 206, 32), atlas(9, 530, 64), atlas(5, 662, 64), atlas(2, 206, 32), atlas(10, 530, 64), atlas(4, 398, 64), atlas(7, 662, 64), atlas(11, 398, 64), atlas(14, 398, 64), atlas(15, 398, 64), atlas(16, 662, 64)];
const huntNames = ['Rota 3', 'Floresta de Viridian (clareira do Pikachu raro)', 'Monte Lua', 'Caverna Rubi', 'Lago Azul', 'Torre Pokémon', 'Ilha Seafoam', 'Rota 22', 'Mansão Pokémon', 'Cidade Fuchsia', 'Cume do Monte', 'Liga Pokémon'];
const regions = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh'];
const hunts: HuntRow[] = huntNames.map((nome, i) => ({nome, regiao: regions[i % 4]!, nivel: 8 + i * 6, xpPorHora: 480000 - i * 31000, abatesPorHora: 1200 - i * 55, mataEm: 2.5 + i * 0.4, ouroPorHora: 95000 - i * 6200, shinyPorHora: i % 5 === 4 ? null : 0.4 - i * 0.02, estimado: i % 3 === 0, umHit: i < 4, mortesPorHora: i > 8 ? 3 : 0, piorGolpe: 0.08 + i * 0.07, liberada: i < 9, sprite: i === 5 ? null : portraits[i % portraits.length]!}));
const huntSnapshot = (soLiberadas?: boolean): HuntSnapshot => ({estado: 'ok', pokemon: {nome: 'Charizard', nivel: 62, sprite: portraits[0]!}, bonus: {pokemon: 1.15, treinador: 1.1, itens: [{nome: 'Amuleto de XP', mult: 1.2}]}, hunts: soLiberadas ? hunts.filter(h => h.liberada) : hunts, liberadas: 9, total: 12, filtro: {ordem: 'xp', soLiberadas: Boolean(soLiberadas)}, versaoJogo: '2.14.0', versaoExtensao: '1.0.23'});
const names = ['Charizard', 'Gengar', 'Dragonite', 'Alakazam', 'Machamp', 'Gyarados', 'Arcanine', 'Snorlax', 'Lapras', 'Tyranitar', 'Scizor', 'Umbreon'];
const listings: MarketListing[] = Array.from({length: 15}, (_, i) => {
  const gold = i % 3 !== 2, label = (['desconto', 'no preço', 'acima'] as const)[i % 3]!;
  return {id: `L${i + 1}`, name: names[i % names.length]!, level: 20 + i * 4, potencia: 1 + (i * 7) % 5, nota: 3.2 + ((i * 13) % 17) / 10, shiny: i % 6 === 0, price: gold ? 250000 + i * 180000 : 40 + i * 12, currency: gold ? 'gold' : 'orb', smart: {label, pct: label === 'desconto' ? -(8 + i) : label === 'acima' ? 12 + i : 1, market: gold ? 300000 + i * 190000 : 50 + i * 12}};
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
let net: NetworkInfo = {mode: 'registrar', allowlist: [], unknown: [{host: 'cdn.exemplo.net', count: 12, firstSeen: Date.now() - 60000, account: 'a', accountName: 'Conta 1'}]};
const network = (): NetworkInfo => ({...net, allowlist: [...net.allowlist], unknown: net.unknown.map(row => ({...row}))});
const withExt = () => ok(extensions.map(e => ({...e})));
const setUpdate = (status: UpdateStatus) => { update = {...update, status}; emit('update', status); };

// Capturas simuladas: histórico inicial e, com a lateral aberta, uma nova a cada ~5 s (algumas Shiny/P5/recorde). ?captures=0 começa sem histórico.
const capNames = ['Charmander', 'Pidgey', 'Gastly', 'Eevee', 'Dratini', 'Larvitar', 'Abra', 'Ponyta', 'Magikarp', 'Machop', 'Bulbasaur', 'Zubat'];
let capSeq = 0;
const fakeCapture = (minutesAgo: number): Capture => {
  const i = capSeq++, at = new Date(Date.now() - minutesAgo * 60_000), p = profiles[i % Math.max(1, profiles.length)]?.id ?? uid(1), pot = i % 7 === 3 ? 5 : 1 + (i * 3) % 4;
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return {profileId: p, name: capNames[(i * 5) % capNames.length]!, level: 12 + (i * 17) % 60, time, at: at.toISOString(), potencia: pot, iv: 60 + (i * 23) % 70, quality: Math.round((0.6 + ((i * 7) % 20) / 10) * 1000) / 1000, nota: Math.round((1.2 + ((i * 11) % 80) / 10) * 1000) / 1000, shiny: i % 9 === 4, record: i % 8 === 5, hints: i % 8 === 5 ? ['recorde'] : []};
};
let captureLog: Capture[] = params.get('captures') === '0' ? [] : Array.from({length: 14}, (_, k) => fakeCapture(k * 3 + 1));
let captureTimer = 0;
const shop = createMockShop(() => profiles.map(p => p.id), p => emit('shop-progress', p));
window.pokehub = {
  list: () => ok(profiles.map(p => ({...p}))),
  getPreferences: () => ok(preferences),
  getPerformance: () => ok({...perfPrefs}),
  setPerformance: change => { perfPrefs = {...perfPrefs, ...change}; return ok({...perfPrefs}); },
  win: {
    state: () => ok({...winState}),
    minimize: () => ok(undefined),
    toggleMaximize: () => { winState = {...winState, maximized: !winState.maximized}; emit('winstate', {...winState}); return ok(undefined); },
    close: () => ok(undefined),
    onState: cb => on<{maximized: boolean; focused: boolean}>('winstate', cb),
  },
  getTray: () => ok({...trayPrefs}),
  setTray: change => { trayPrefs = {...trayPrefs, ...change}; return ok({...trayPrefs}); },
  onPerformance: cb => on<PerformancePrefs>('performance', cb),
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
  shop: {
    read: id => { const r = shop.read(id); return r; },
    buy: (id, order) => shop.buy(id, order),
    run: plan => shop.run(plan),
    stop: () => ok(shop.stop()),
    onProgress: cb => on<Parameters<typeof cb>[0]>('shop-progress', cb),
  },
  captures: {
    list: query => ok(captureLog.filter(c => (!query?.profileId || c.profileId === query.profileId)).slice(0, query?.limit ?? 100)),
    clear: () => { captureLog = []; return ok(undefined); },
    watch: open => {
      clearInterval(captureTimer); // (o Shiny inicial só roda uma vez por abertura)
      if (open) { const push = (c: Capture) => { captureLog = [c, ...captureLog].slice(0, 200); emit('captures-new', [c]); }; captureTimer = window.setInterval(() => push(fakeCapture(0)), 5000); window.setTimeout(() => push({...fakeCapture(0), shiny: true}), 2000); } // a 1ª simulada é Shiny: mostra o aviso logo
      return ok(undefined);
    },
    onNew: cb => on<Capture[]>('captures-new', cb),
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
  network: {
    get: () => ok(network()),
    setMode: mode => { net = {...net, mode: mode as NetworkMode}; return ok(network()); },
    allow: host => { net = {...net, allowlist: [...net.allowlist, host], unknown: net.unknown.filter(row => row.host !== host)}; return ok(network()); },
    disallow: host => { net = {...net, allowlist: net.allowlist.filter(item => item !== host)}; return ok(network()); },
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
