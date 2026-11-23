import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Profile, ProfileInput } from '../domain/profiles';
import type { DiagnosticsSample } from '../contracts/diagnostics';
import type { HuntExtensionStatus, StartupMode } from '../contracts/preferences';
import './style.css';
import { removeProfileAndData } from './remove-profile';
import { profileFormChanged } from './profile-form';
import { elementOf } from './element';
import { El, Icon, ViewIcon, elements, icons } from './icons';
import { PokemonProfessor } from './pokemon-professor';
import { HuntSide, loadSidePrefs, saveSidePrefs } from './hunt-side';
import type { HuntSnapshot, HuntTeam } from '../contracts/hunt';
import type { GrindolinoApi } from '../contracts/grindolino';
import type { LiveApi } from '../contracts/live';
import type { AnalyticsApi } from '../contracts/analytics';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
type Status = {id:string;state:string};
declare global { interface Window { pokehub: {
 list(): Promise<Result<Profile[]>>; initialFocus():Promise<Result<string|null>>; getPreferences():Promise<Result<StartupMode>>; setStartupMode(mode:StartupMode):Promise<Result<StartupMode>>; create(input:ProfileInput): Promise<Result<Profile>>; update(id:string,input:ProfileInput): Promise<Result<Profile>>; remove(id:string): Promise<Result<void>>;
 layout(id:string|null,hide:boolean,side:boolean,panel?:number): Promise<Result<void>>; drag(active:boolean): Promise<Result<void>>; huntSnapshot(id:string,soLiberadas?:boolean):Promise<Result<HuntSnapshot>>; huntTeam(id:string):Promise<Result<HuntTeam>>; onToggleSide(callback:()=>void):()=>void; reload(id:string): Promise<Result<void>>; restart(id:string): Promise<Result<void>>; clearSession(id:string): Promise<Result<void>>; states(): Promise<Result<Record<string,string>>>; diagnostics():Promise<Result<DiagnosticsSample>>; onStatus(callback:(status:Status)=>void):()=>void; onFocus(callback:(id:string|null)=>void):()=>void; autoFocus():Promise<Result<string|null>>; onAutoFocus(callback:(id:string|null)=>void):()=>void;
 extension: {status():Promise<Result<HuntExtensionStatus>>; detect():Promise<Result<HuntExtensionStatus>>; choose():Promise<Result<HuntExtensionStatus>>; set(enabled:boolean):Promise<Result<HuntExtensionStatus>>};
 grindolino?: GrindolinoApi; // ausente enquanto o preload não expõe a API
 live?: LiveApi;
 analytics?: AnalyticsApi;
} } }
const blank: ProfileInput = {label:'',emailLabel:'',characterName:'',colorToken:'#d4a65f'};
const labels: Record<string,string> = {loading:'Carregando',ready:'Página carregada',offline:'Sem conexão',auth_required:'Login no provedor',error:'Erro ao carregar'};
const shortLabels: Record<string,string> = {loading:'Carregando',ready:'',offline:'Offline',auth_required:'Login',error:'Erro'};
// Arte original: cápsula oval inclinada com faixa diagonal e gema; criatura genérica.
const capsule = <g transform="rotate(-35 12 12)"><path d="M12 6.5H8.5a5.5 5.5 0 0 0 0 11H12z" fill="#ffca3a"/><path d="M12 6.5h3.5a5.5 5.5 0 0 1 0 11H12z" fill="#f25f5c"/><path d="M10.4 6.5h3.4l-1.4 11H9z" fill="#eef1f6"/><path d="M11.7 9.4l2 2.6-2 2.6-2-2.6z" fill="#3fa7d6"/></g>;
const Logo = () => <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">{capsule}</svg>;
const Buddy = () => <svg className="buddy" viewBox="0 0 160 100" aria-hidden="true">
 <g className="orbit"><path d={elements.flame.d} fill="#f25f5c" transform="translate(14 30)"/><path d={elements.drop.d} fill="#3fa7d6" transform="translate(30 6)"/><path d={elements.leaf.d} fill="#59cd90" transform="translate(116 8)"/><path d={elements.bolt.d} fill="#ffca3a" transform="translate(132 34)"/></g>
 <g transform="translate(44 34) scale(.6)"><path className="twinkle" d={elements.star.d} fill="#ffca3a"/></g><g transform="translate(108 44) scale(.5)"><path className="twinkle late" d={elements.star.d} fill="#eef1f6"/></g>
 <ellipse className="shade" cx="74" cy="92" rx="26" ry="4"/>
 <g className="float"><path d="M74 31c0-9 4-13 10-14" fill="none" stroke="#3aa873" strokeWidth="3" strokeLinecap="round"/><path d="M88 11l4 5-4 5-4-5z" fill="#ffca3a"/><path d="M54 40c-3-7-2-12 1-15 5 2 8 6 9 11zM94 40c3-7 2-12-1-15-5 2-8 6-9 11z" fill="#3aa873"/><ellipse cx="62" cy="85" rx="8" ry="4.5" fill="#3aa873"/><ellipse cx="86" cy="85" rx="8" ry="4.5" fill="#3aa873"/><path d="M74 30c19 0 31 13 31 30 0 15-12 25-31 25S43 75 43 60c0-17 12-30 31-30z" fill="#59cd90"/><ellipse cx="74" cy="68" rx="17" ry="11" fill="#c9f2dc"/><ellipse cx="63" cy="54" rx="3.6" ry="5" fill="#0f1218"/><ellipse cx="85" cy="54" rx="3.6" ry="5" fill="#0f1218"/><circle cx="64.2" cy="52" r="1.4" fill="#fff"/><circle cx="86.2" cy="52" r="1.4" fill="#fff"/><path d="M70 62q4 3.5 8 0" fill="none" stroke="#0f1218" strokeWidth="1.8" strokeLinecap="round"/></g>
 <g transform="translate(108 70)">{capsule}</g>
</svg>;
// Sublinhado único das abas: segue a aba ativa lida do DOM (a largura muda com rótulo, estado e media query).
function placeIndicator(el: HTMLElement | null) {
 if (!el) return;
 const tab = el.parentElement?.querySelector<HTMLElement>('.tab[aria-pressed=true]');
 el.dataset.on = String(Boolean(tab));
 if (!tab) return;
 el.style.width = `${tab.offsetWidth - 20}px`;
 el.style.transform = `translateX(${tab.offsetLeft + 10}px)`;
 el.style.setProperty('--c',tab.style.getPropertyValue('--c'));
}
// Igual a GRID_MIN_WIDTH + SIDE_PANEL em spike/electron/layout.ts: abaixo disso a grade não cabe ao lado da lateral.
const wideQuery = '(min-width: 1060px)';
const fairUse = 'Use apenas suas contas e respeite o limite total do jogo.';
function App() {
 const [profiles,setProfiles] = useState<Profile[]>([]);
 const [states,setStates] = useState<Record<string,string>>({});
 const [focus,setFocus] = useState<string|null>(null);
 const [autoFocus,setAutoFocus] = useState<string|null>(null);
 const [editor,setEditor] = useState<'new'|string|null>(null);
 const [form,setForm] = useState<ProfileInput>(blank);
 const [initialForm,setInitialForm] = useState<ProfileInput>(blank);
 const [message,setMessage] = useState('');
 const [busy,setBusy] = useState(false);
 const [loaded,setLoaded] = useState(false);
 const [loadError,setLoadError] = useState(false);
 const [diagnostics,setDiagnostics] = useState<DiagnosticsSample | null>(null);
 const [startupMode,setStartupMode] = useState<StartupMode | null>(null);
 const [savedStartupMode,setSavedStartupMode] = useState<StartupMode | null>(null);
 const [settingsSaved,setSettingsSaved] = useState(false);
 const [ext,setExt] = useState<HuntExtensionStatus | null>(null);
 const [extReload,setExtReload] = useState(false);
 const [side,setSide] = useState(false);
 const [sidePrefs,setSidePrefs] = useState(loadSidePrefs);
 useEffect(() => saveSidePrefs(sidePrefs),[sidePrefs]);
 const [wide,setWide] = useState(() => window.matchMedia(wideQuery).matches);
 const focusEventReceived = useRef(false);
 const indicator = useRef<HTMLElement>(null);
 useLayoutEffect(() => {
   const place = () => placeIndicator(indicator.current);
   place();window.addEventListener('resize',place);
   return () => window.removeEventListener('resize',place);
 });
 async function refresh() {
   const result = await window.pokehub.list();
   if (result.ok) {setProfiles(result.data);setLoadError(false);} else {setLoadError(true);setMessage(result.error);}
   setLoaded(true);
 }
 async function initialize() {
   const [profilesResult,focusResult] = await Promise.all([window.pokehub.list(),window.pokehub.initialFocus()]);
   if (!profilesResult.ok || !focusResult.ok) {
     setLoadError(true);setMessage(!profilesResult.ok ? profilesResult.error : !focusResult.ok ? focusResult.error : '');setLoaded(true);return;
   }
   setProfiles(profilesResult.data);
   if (!focusEventReceived.current) setFocus(focusResult.data);
   setLoadError(false);setLoaded(true);
 }
 useEffect(() => {
   let receivedAutoFocus = false;
   const unsubscribeAutoFocus = window.pokehub.onAutoFocus(id => {receivedAutoFocus = true;setAutoFocus(id);});
   void window.pokehub.autoFocus().then(result => {if (result.ok && !receivedAutoFocus) setAutoFocus(result.data);}).catch(() => setMessage('Não foi possível consultar o layout.'));
   const unsubscribeFocus = window.pokehub.onFocus(id => {focusEventReceived.current = true;setFocus(id);});
   const unsubscribe = window.pokehub.onStatus(({id,state}) => setStates(old => ({...old,[id]:state})));
   // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial assíncrona via IPC no mount
   void initialize().catch(() => {setMessage('Não foi possível carregar os perfis.');setLoadError(true);setLoaded(true);});
   void window.pokehub.states().then(result => {if(result.ok) setStates(old => ({...result.data,...old}));}).catch(() => setMessage('Não foi possível consultar os estados das sessões.'));
   return () => {unsubscribe();unsubscribeFocus();unsubscribeAutoFocus();};
 },[]);
 const active = profiles.find(p => p.id === (focus ?? autoFocus));
 // A lateral só existe na Grade; no Foco o usuário usa o painel /hunt dentro do jogo. `side` guarda a escolha para a volta.
 const sideAllowed = loaded && !loadError && profiles.length > 0 && !active && wide;
 const sideShown = side && sideAllowed && editor === null;
 useEffect(() => {
   const media = window.matchMedia(wideQuery);
   const change = () => setWide(media.matches);
   media.addEventListener('change',change);
   return () => media.removeEventListener('change',change);
 },[]);
 useEffect(() => window.pokehub.onToggleSide(() => { if (sideAllowed && editor === null) setSide(open => !open); }),[sideAllowed,editor]);
 useEffect(() => { if (loaded) void window.pokehub.layout(focus,editor !== null || loadError,sideShown,sidePrefs.width).then(result => {if (!result.ok) setMessage(result.error);}).catch(() => setMessage('Falha de comunicação com o aplicativo.')); },[focus,editor,loaded,loadError,profiles.length,sideShown,sidePrefs.width]);
 const unsavedProfile = editor !== null && editor !== 'settings' && editor !== 'diagnostics' && editor !== 'grindolino' && editor !== 'history' && profileFormChanged(initialForm,form);
 const unsavedSettings = editor === 'settings' && startupMode !== null && savedStartupMode !== null && startupMode !== savedStartupMode;
 const unsavedGrind = false;
 useEffect(() => {
   if (!unsavedProfile && !unsavedSettings && !unsavedGrind && !busy) return;
   const preventUnload = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue = '';};
   window.addEventListener('beforeunload',preventUnload);
   return () => window.removeEventListener('beforeunload',preventUnload);
 },[unsavedProfile,unsavedSettings,unsavedGrind,busy]);
 function canLeaveEditor() { return !(unsavedProfile || unsavedSettings || unsavedGrind) || window.confirm('Descartar alterações não salvas?'); }
 function openEditor(profile?: Profile) {
   if (!canLeaveEditor()) return;
   const values = profile ? {label:profile.label,emailLabel:profile.emailLabel,characterName:profile.characterName,colorToken:profile.colorToken} : blank;
   setMessage('');setForm(values);setInitialForm(values);setEditor(profile?.id ?? 'new');
 }
 async function submit(event: FormEvent) {
   event.preventDefault(); if (!editor || busy) return; setBusy(true);setMessage('');
   try { const result = editor === 'new' ? await window.pokehub.create(form) : await window.pokehub.update(editor,form);
     if (!result.ok) {setMessage(result.error);return;} await refresh();setEditor(null);
   } catch {setMessage('Falha de comunicação com o aplicativo.');} finally {setBusy(false);}
 }
 async function remove(profile: Profile) {
   if (!window.confirm(`Remover o perfil “${profile.label}”? Os dados de login locais não serão apagados.`)) return;
   setBusy(true);try {const result = await window.pokehub.remove(profile.id);if (!result.ok) {setMessage(result.error);return;} if (focus === profile.id) setFocus(null);setEditor(null);await refresh();} catch {setMessage('Falha de comunicação com o aplicativo.');} finally {setBusy(false);}
 }
 async function removeWithData(profile: Profile) {
   if (!window.confirm(`Apagar o perfil “${profile.label}” e os dados locais de sua sessão? A ação é irreversível e exigirá novo login.`)) return;
   setBusy(true); setMessage('');
   try {
     const result = await removeProfileAndData({clear: async () => (await window.pokehub.clearSession(profile.id)).ok, remove: async () => (await window.pokehub.remove(profile.id)).ok});
     if (result === 'clear-failed') {setMessage('Não foi possível confirmar a limpeza. O perfil foi mantido; os dados podem ter sido parcialmente apagados.');return;}
     if (result === 'remove-failed') {setMessage('Os dados foram limpos, mas não foi possível confirmar a remoção do perfil. Atualize a lista e verifique.');await refresh();return;}
     if (focus === profile.id) setFocus(null); setEditor(null); await refresh();
   } catch {setMessage('Não foi possível concluir a operação. Atualize a lista e verifique o perfil.');}
   finally {setBusy(false);}
 }
 async function openSettings() {
   if (!canLeaveEditor()) return;
   setEditor('settings');setStartupMode(null);setSavedStartupMode(null);setSettingsSaved(false);setExt(null);setExtReload(false);setMessage('');setBusy(true);
   try {const result=await window.pokehub.getPreferences();if(result.ok) {setStartupMode(result.data);setSavedStartupMode(result.data);}else setMessage(result.error);
     const extension=await window.pokehub.extension.status();if(extension.ok) setExt(extension.data);}
   catch {setMessage('Não foi possível carregar as configurações.');}
   finally {setBusy(false);}
 }
 async function saveSettings() {
   if (!startupMode || busy) return;
   setBusy(true);setMessage('');setSettingsSaved(false);
   try {const result=await window.pokehub.setStartupMode(startupMode);if(result.ok){setStartupMode(result.data);setSavedStartupMode(result.data);setSettingsSaved(true);}else setMessage(result.error);}
   catch {setMessage('Não foi possível salvar as configurações.');}
   finally {setBusy(false);}
 }
 // A extensão aplica na hora (não depende de "Salvar"); páginas já abertas só mudam ao recarregar.
 async function changeExtension(action: () => Promise<Result<HuntExtensionStatus>>) {
   if (busy) return;
   setBusy(true);setMessage('');
   try {
     const result=await action();
     if (!result.ok) {setMessage(result.error);return;}
     if (ext && result.data.sessions > 0 && (result.data.enabled !== ext.enabled || result.data.path !== ext.path)) setExtReload(true);
     setExt(result.data);
   } catch {setMessage('Não foi possível atualizar a extensão.');}
   finally {setBusy(false);}
 }
 async function reloadSessions() {
   if (busy) return;
   setBusy(true);setMessage('');
   try {
     const results=await Promise.all(profiles.map(profile => window.pokehub.reload(profile.id)));
     if (results.every(result => result.ok)) setExtReload(false); else setMessage('Nem todas as sessões recarregaram. Use “Recarregar” em cada sessão.');
   } catch {setMessage('Não foi possível recarregar as sessões.');}
   finally {setBusy(false);}
 }
 const extState = !ext ? '' : !ext.enabled ? 'Desativada. Ative para usar a extensão que você instalou no navegador.' : !ext.name ? 'Ativada, mas não carregada.' : ext.sessions === 0 ? `${ext.name} ${ext.version} · será carregada ao abrir uma sessão` : `${ext.name} ${ext.version} · carregada em ${ext.loaded} de ${ext.sessions} ${ext.sessions === 1 ? 'sessão' : 'sessões'}`;
 async function sampleDiagnostics() {
   setBusy(true); setMessage('');
   try { const result = await window.pokehub.diagnostics(); if (result.ok) setDiagnostics(result.data); else setMessage(result.error); }
   catch { setMessage('Não foi possível obter o diagnóstico local.'); }
   finally { setBusy(false); }
 }
 function openDiagnostics() {if (!canLeaveEditor()) return;setDiagnostics(null);setMessage('');setEditor('diagnostics');void sampleDiagnostics();}
 async function clearSession(profile: Profile) {
   if (!window.confirm(`Apagar os dados locais da sessão de “${profile.label}”? Você precisará entrar novamente. Esta ação não pode ser desfeita.`)) return;
   setBusy(true); setMessage('');
   try {const result = await window.pokehub.clearSession(profile.id); setMessage(result.ok ? 'Dados locais da sessão apagados. Entre novamente no jogo.' : result.error);}
   catch {setMessage('A limpeza pode ter sido parcial. Verifique a sessão e tente novamente.');}
   finally {setBusy(false);}
 }
 async function reload(id: string) {
   try {const result = await window.pokehub.reload(id); if (!result.ok) setMessage(result.error);}
   catch {setMessage('Não foi possível recarregar a sessão.');}
 }
 async function restart(id: string) {
   try {const result = await window.pokehub.restart(id); if (!result.ok) setMessage(result.error);}
   catch {setMessage('Não foi possível reabrir a sessão.');}
 }
 const barAlert = message !== '' && editor === null && (loadError || profiles.length > 0);
 const smallWindow = 'Janela pequena: exibindo uma sessão por vez. Amplie para ver a grade.';
 return <>
 <header className="bar"><div className="brand"><Logo/><strong>PokéHub</strong></div>
 {barAlert ? <div className="bar-alert" role="alert"><span title={message}>{message}</span><button className="icon" aria-label="Dispensar aviso" title="Dispensar aviso" onClick={() => setMessage('')}><Icon d={icons.close}/></button></div> :
 <nav aria-label="Sessões"><div className="seg" role="group" aria-label="Visualização"><button disabled={!loaded || loadError || busy} aria-keyshortcuts="Control+0" title={autoFocus ? smallWindow : 'Grade (Ctrl+0)'} aria-pressed={!active} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(null);}}}><ViewIcon mode="grid"/><span>Grade</span></button><button disabled={!loaded || loadError || busy || profiles.length === 0} title="Focar uma sessão" aria-pressed={Boolean(active)} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(active?.id ?? profiles[0]?.id ?? null);}}}><ViewIcon mode="focus"/><span>Foco</span></button></div>{autoFocus && <span className="sr" role="status">{smallWindow}</span>}{profiles.map((p,index) => {const state=states[p.id] ?? '';const label=labels[state] ?? 'Iniciando';const short=shortLabels[state] ?? 'Iniciando';return <button key={p.id} className="tab" style={{'--c':p.colorToken} as CSSProperties} disabled={!loaded || loadError || busy} aria-keyshortcuts={`Control+${index+1}`} title={`Focar ${p.label} (Ctrl+${index+1}) · ${label}`} aria-pressed={active?.id===p.id} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(p.id);}}}><El color={p.colorToken}/><span className="name">{p.label}</span><span className="st" data-state={state}><b/><span className="sr">{label}</span>{short && <small aria-hidden="true">{short}</small>}</span></button>;})}<i className="ind" ref={indicator} aria-hidden="true"/></nav>}
 <div className="tools">{active && <div className="group" role="group" aria-label={`Sessão ${active.label}`}><button className="icon" disabled={busy || loadError} aria-label={`Editar ${active.label}`} title={`Editar ${active.label}`} onClick={() => openEditor(active)}><Icon d={icons.edit}/></button><button className="icon" disabled={busy || loadError} aria-label={`Recarregar ${active.label}`} title={`Recarregar ${active.label}`} onClick={() => void reload(active.id)}><Icon d={icons.reload}/></button><button className="icon" disabled={busy || loadError} aria-label={`Reabrir sessão de ${active.label}`} title={`Reabrir sessão de ${active.label}`} onClick={() => void restart(active.id)}><Icon d={icons.restart}/></button></div>}<button className="icon" disabled={!sideAllowed || busy} aria-label="Onde caçar?" aria-keyshortcuts="Control+H" title={active ? 'Onde caçar? · Disponível na Grade' : !wide ? 'Onde caçar? · Disponível na Grade com a janela mais larga' : 'Onde caçar? (Ctrl+H)'} aria-pressed={sideShown} onClick={() => {if (editor === null) setSide(!side); else if (canLeaveEditor()) {setEditor(null);setMessage('');setSide(true);}}}><Icon d={icons.target}/></button><button className="icon" disabled={!loaded || busy} aria-label="Professor Grindolino" title="Professor Grindolino: avaliar Pokémon" aria-pressed={editor==='grindolino'} onClick={() => {if (editor !== 'grindolino' && canLeaveEditor()) {setMessage('');setEditor('grindolino');}}}><Icon d={icons.flask}/></button><button className="icon" disabled={!loaded || busy} aria-label="Configurações" title="Configurações" aria-pressed={editor==='settings'} onClick={() => void openSettings()}><Icon d={icons.settings}/></button><button className="icon" disabled={!loaded || busy} aria-label="Diagnóstico" title="Diagnóstico" aria-pressed={editor==='diagnostics'} onClick={openDiagnostics}><Icon d={icons.diagnostics}/></button><button className="primary" disabled={!loaded || loadError || profiles.length >= 4 || busy} title={profiles.length >= 4 ? 'Limite de 4 perfis atingido' : 'Novo perfil'} onClick={() => openEditor()}><Icon d={icons.plus}/><span>Perfil</span></button></div></header>
 {editor === 'settings' && <main><section className="panel" aria-busy={busy}><h1>Configurações</h1><p>Escolha como o workspace aparece na próxima abertura.</p>{startupMode && <fieldset className="settings-choice"><legend>Ao iniciar</legend><label><input type="radio" name="startupMode" checked={startupMode==='grid'} onChange={() => {setStartupMode('grid');setSettingsSaved(false);}}/>Abrir em grade</label><label><input type="radio" name="startupMode" checked={startupMode==='focus-first'} onChange={() => {setStartupMode('focus-first');setSettingsSaved(false);}}/>Focar a primeira conta</label></fieldset>}{!startupMode && busy && <p role="status">Carregando configuração…</p>}<div className="actions"><button className="primary" disabled={busy || !startupMode} onClick={() => void saveSettings()}>Salvar</button><button disabled={busy} onClick={() => {if (canLeaveEditor()) {setEditor(null);setMessage('');}}}>Voltar</button></div>{settingsSaved && <p role="status">Preferência salva para a próxima abertura.</p>}{message && <p role="alert">{message}</p>}
 {ext && <section className="zone ext" aria-labelledby="ext-title"><h2 id="ext-title">Extensão /hunt</h2>
  <label className="switch"><span>Usar nas sessões do jogo</span><input type="checkbox" role="switch" checked={ext.enabled} disabled={busy} onChange={event => {const enabled=event.target.checked;void changeExtension(() => window.pokehub.extension.set(enabled));}}/></label>
  <p className="ext-state" role="status" data-on={Boolean(ext.enabled && ext.name)}>{extState}</p>
  {ext.path && <p className="ext-path">{ext.path}</p>}
  {ext.error && <p role="alert">{ext.error}</p>}
  <div className="actions"><button disabled={busy} onClick={() => void changeExtension(() => window.pokehub.extension.detect())}>Detectar no navegador</button><button disabled={busy} onClick={() => void changeExtension(() => window.pokehub.extension.choose())}>Escolher pasta…</button>{extReload && <button className="primary" disabled={busy} onClick={() => void reloadSessions()}>Recarregar sessões para aplicar</button>}</div>
  <p className="note">A extensão é de terceiros (Liang) e roda dentro das suas sessões do jogo. O PokéHub não a modifica nem a distribui.</p>
 </section>}</section></main>}
 {editor === 'diagnostics' && <main><section className="panel" aria-busy={busy}><h1>Diagnóstico local</h1><p>Valores dos processos do PokéHub, incluindo as páginas do jogo. Os dados ficam nesta máquina.</p>{diagnostics && <dl className="diagnostics"><div><dt>Processos</dt><dd>{diagnostics.processCount}</dd></div><div><dt>Memória residente somada</dt><dd>{diagnostics.memoryKb === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR').format(diagnostics.memoryKb)} KB`}</dd></div><div><dt>CPU somada</dt><dd>{diagnostics.cpuPercent === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuPercent)}%`}</dd></div>{diagnostics.cpuIntervalMs !== null && <div><dt>Intervalo aproximado da CPU</dt><dd>{new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuIntervalMs / 1000)} s</dd></div>}</dl>}<p>A memória compartilhada pode ser contada mais de uma vez. A CPU pode ultrapassar 100% e exige duas amostras com pelo menos 1 segundo de intervalo; mudanças nos processos reiniciam a comparação.</p>{diagnostics && <p>Última amostra: {new Date(diagnostics.sampledAt).toLocaleTimeString('pt-BR')}</p>}<div className="actions"><button className="primary" disabled={busy} onClick={() => void sampleDiagnostics()}>{busy ? 'Consultando…' : 'Atualizar'}</button><button disabled={busy} onClick={() => {if (canLeaveEditor()) {setEditor(null);setMessage('');}}}>Voltar</button></div>{message && <p role="alert">{message}</p>}</section></main>}
 {editor === 'grindolino' && <main><PokemonProfessor profiles={profiles} states={states} onClose={() => setEditor(null)}/></main>}
 {editor !== null && editor !== 'diagnostics' && editor !== 'settings' && editor !== 'grindolino' && editor !== 'history' && <main><section className="panel"><h1>{editor==='new'?'Novo perfil':'Editar perfil'}</h1><p>O e-mail é apenas uma identificação. O login acontece na página oficial do jogo.</p><form aria-busy={busy} onSubmit={event => void submit(event)}><label>Nome do perfil<input required maxLength={80} value={form.label} onChange={e => setForm({...form,label:e.target.value})}/></label><label>E-mail de identificação<input required type="email" maxLength={254} value={form.emailLabel} onChange={e => setForm({...form,emailLabel:e.target.value})}/></label><label>Personagem (opcional)<input maxLength={80} value={form.characterName} onChange={e => setForm({...form,characterName:e.target.value})}/></label><label className="color" style={{'--c':form.colorToken} as CSSProperties}>Cor<span><input type="color" value={form.colorToken} onChange={e => setForm({...form,colorToken:e.target.value})}/><El color={form.colorToken}/>{elements[elementOf(form.colorToken)].name}</span></label><div className="actions"><button className="primary" disabled={busy}>Salvar</button><button type="button" disabled={busy} onClick={() => {if (canLeaveEditor()) setEditor(null);}}>Cancelar</button></div>{editor !== 'new' && <div className="zone"><h2>Dados e remoção</h2><div className="actions"><button type="button" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void clearSession(profile);}}>Limpar dados da sessão</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void remove(profile);}}>Remover só o perfil</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void removeWithData(profile);}}>Apagar perfil e dados</button></div></div>}</form>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 {sideShown && <HuntSide profiles={profiles} states={states} prefs={sidePrefs} onPrefs={setSidePrefs} onClose={() => setSide(false)} onSettings={() => void openSettings()}/>}
 {!loaded && <main><section className="panel" role="status"><h1>Carregando perfis</h1><p>Preparando suas sessões locais.</p></section></main>}
 {loaded && loadError && editor === null && <main><section className="panel"><h1>Não foi possível carregar os perfis</h1><p>Verifique o armazenamento local e tente novamente.</p><button className="primary" onClick={() => {setLoaded(false);void initialize().catch(() => {setLoadError(true);setLoaded(true);});}}>Tentar novamente</button></section></main>}
 {loaded && !loadError && editor === null && profiles.length === 0 && <main><section className="panel empty"><Buddy/><h1>Suas sessões em um só lugar</h1><p>Crie um perfil para abrir o PokéIdle. Cada perfil usa uma sessão local separada.</p><button className="primary" onClick={() => openEditor()}>Criar primeiro perfil</button>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
