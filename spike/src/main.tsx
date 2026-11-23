import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Profile, ProfileInput } from '../domain/profiles';
import type { DiagnosticsSample } from '../contracts/diagnostics';
import type { StartupMode } from '../contracts/preferences';
import type { AuditFinding, AuditVerdict, ExtensionInfo } from '../contracts/extensions';
import type { UpdateInfo, UpdateStatus } from '../contracts/update';
import './style.css';
import { removeProfileAndData } from './remove-profile';
import { profileFormChanged } from './profile-form';
import { elementOf } from './element';
import { El, Icon, ViewIcon, elements, icons } from './icons';
import { HuntSide, loadSidePrefs, saveSidePrefs } from './hunt-side';
import type { HuntSnapshot } from '../contracts/hunt';
import { columns, COL_HEAD, MAX_PROFILES, sideMinWidth, sideWidth, SIDE_PANEL, TOP_BAR } from '../electron/layout';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
type Status = {id:string;state:string};
declare global { interface Window { pokehub: {
 list(): Promise<Result<Profile[]>>; initialFocus():Promise<Result<string|null>>; getPreferences():Promise<Result<StartupMode>>; setStartupMode(mode:StartupMode):Promise<Result<StartupMode>>; create(input:ProfileInput): Promise<Result<Profile>>; update(id:string,input:ProfileInput): Promise<Result<Profile>>; remove(id:string): Promise<Result<void>>;
 layout(id:string|null,hide:boolean,side:boolean,panel?:number): Promise<Result<void>>; drag(active:boolean): Promise<Result<void>>; huntSnapshot(id:string,soLiberadas?:boolean):Promise<Result<HuntSnapshot>>; onToggleSide(callback:()=>void):()=>void; reload(id:string): Promise<Result<void>>; restart(id:string): Promise<Result<void>>; clearSession(id:string): Promise<Result<void>>; states(): Promise<Result<Record<string,string>>>; diagnostics():Promise<Result<DiagnosticsSample>>; onStatus(callback:(status:Status)=>void):()=>void; onFocus(callback:(id:string|null)=>void):()=>void; autoFocus():Promise<Result<string|null>>; onAutoFocus(callback:(id:string|null)=>void):()=>void;
 extensions: {list():Promise<Result<ExtensionInfo[]>>; detect():Promise<Result<ExtensionInfo[]>>; add():Promise<Result<ExtensionInfo[]>>; toggle(id:string,enabled:boolean):Promise<Result<ExtensionInfo[]>>; remove(id:string):Promise<Result<ExtensionInfo[]>>; openStore(id:string):Promise<Result<void>>};
 updates: {get():Promise<Result<UpdateInfo>>; check():Promise<Result<UpdateInfo>>; download():Promise<Result<UpdateInfo>>; install():Promise<Result<void>>; setAuto(enabled:boolean):Promise<Result<UpdateInfo>>; onStatus(callback:(status:UpdateStatus)=>void):()=>void};
} } }
const blank: ProfileInput = {label:'',emailLabel:'',characterName:'',colorToken:'#d4a65f'};
const labels: Record<string,string> = {loading:'Carregando',ready:'Página carregada',offline:'Sem conexão',auth_required:'Login no provedor',error:'Erro ao carregar'};
const shortLabels: Record<string,string> = {loading:'Carregando',ready:'',offline:'Offline',auth_required:'Login',error:'Erro'};
// Arte original: cápsula oval inclinada com faixa diagonal e gema; criatura genérica.
const capsule = <g transform="rotate(-35 12 12)"><path d="M12 6.5H8.5a5.5 5.5 0 0 0 0 11H12z" fill="#ffca3a"/><path d="M12 6.5h3.5a5.5 5.5 0 0 1 0 11H12z" fill="#f25f5c"/><path d="M10.4 6.5h3.4l-1.4 11H9z" fill="#eef1f6"/><path d="M11.7 9.4l2 2.6-2 2.6-2-2.6z" fill="#3fa7d6"/></g>;
const Logo = () => <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">{capsule}</svg>;
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
const verdicts: Record<AuditVerdict,string> = {leitura:'Só leitura',interage:'Interage com a página',bloqueada:'Bloqueada'};
const findingLabels: Record<AuditFinding['kind'],string> = {network:'Rede fora do jogo',link:'Link',fetch:'Rede/socket',click:'Clique',dispatch:'Evento na página',send:'Envio por socket',eval:'Código dinâmico',skipped:'Não auditado'};
const SMART_MARKET_ID = 'lhfeijlnlbglakplddjgbaopgcdfkcmm';
const extSignature = (list: ExtensionInfo[]) => list.map(item => `${item.id}|${item.path}|${item.enabled}`).join(',');
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
 const [ext,setExt] = useState<ExtensionInfo[] | null>(null);
 const [openFindings,setOpenFindings] = useState<string | null>(null);
 const [upd,setUpd] = useState<UpdateInfo | null>(null);
 const [extReload,setExtReload] = useState(false);
 const [side,setSide] = useState(false);
 const [sidePrefs,setSidePrefs] = useState(loadSidePrefs);
 useEffect(() => saveSidePrefs(sidePrefs),[sidePrefs]);
 const [size,setSize] = useState(() => ({w:window.innerWidth,h:window.innerHeight}));
 useEffect(() => {
   const update = () => setSize({w:window.innerWidth,h:window.innerHeight});
   window.addEventListener('resize',update);
   return () => window.removeEventListener('resize',update);
 },[]);
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
   const unsubscribeUpdate = window.pokehub.updates.onStatus(status => setUpd(old => old ? {...old,status} : old));
   void window.pokehub.updates.get().then(result => {if (result.ok) setUpd(result.data);}).catch(() => undefined);
   // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial assíncrona via IPC no mount
   void initialize().catch(() => {setMessage('Não foi possível carregar os perfis.');setLoadError(true);setLoaded(true);});
   void window.pokehub.states().then(result => {if(result.ok) setStates(old => ({...result.data,...old}));}).catch(() => setMessage('Não foi possível consultar os estados das sessões.'));
   return () => {unsubscribe();unsubscribeFocus();unsubscribeAutoFocus();unsubscribeUpdate();};
 },[]);
 const active = profiles.find(p => p.id === (focus ?? autoFocus));
 // A lateral só existe na Grade; no Foco o usuário usa o painel /hunt dentro do jogo. `side` guarda a escolha para a volta.
 const wide = size.w >= sideMinWidth(profiles.length); // a grade ainda cabe ao lado da lateral
 useEffect(() => { document.documentElement.style.setProperty('--grid-min',`${sideMinWidth(profiles.length) - SIDE_PANEL}px`); },[profiles.length]);
 const sideAllowed = loaded && !loadError && profiles.length > 0 && !active && wide;
 const sideShown = side && sideAllowed && editor === null;
 useEffect(() => window.pokehub.onToggleSide(() => { if (sideAllowed && editor === null) setSide(open => !open); }),[sideAllowed,editor]);
 useEffect(() => { if (loaded) void window.pokehub.layout(focus,editor !== null || loadError,sideShown,sidePrefs.width).then(result => {if (!result.ok) setMessage(result.error);}).catch(() => setMessage('Falha de comunicação com o aplicativo.')); },[focus,editor,loaded,loadError,profiles.length,sideShown,sidePrefs.width]);
 const unsavedProfile = editor !== null && editor !== 'settings' && editor !== 'diagnostics' && profileFormChanged(initialForm,form);
 const unsavedSettings = editor === 'settings' && startupMode !== null && savedStartupMode !== null && startupMode !== savedStartupMode;
 useEffect(() => {
   if (!unsavedProfile && !unsavedSettings && !busy) return;
   const preventUnload = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue = '';};
   window.addEventListener('beforeunload',preventUnload);
   return () => window.removeEventListener('beforeunload',preventUnload);
 },[unsavedProfile,unsavedSettings,busy]);
 function canLeaveEditor() { return !(unsavedProfile || unsavedSettings) || window.confirm('Descartar alterações não salvas?'); }
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
   setEditor('settings');setStartupMode(null);setSavedStartupMode(null);setSettingsSaved(false);setExt(null);setExtReload(false);setOpenFindings(null);setMessage('');setBusy(true);
   try {const result=await window.pokehub.getPreferences();if(result.ok) {setStartupMode(result.data);setSavedStartupMode(result.data);}else setMessage(result.error);
     const extensions=await window.pokehub.extensions.list();if(extensions.ok) setExt(extensions.data);
     const info=await window.pokehub.updates.get();if(info.ok) setUpd(info.data);}
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
 // As extensões aplicam na hora (não dependem de "Salvar"); páginas já abertas só mudam ao recarregar.
 async function changeExtensions(action: () => Promise<Result<ExtensionInfo[]>>) {
   if (busy) return;
   setBusy(true);setMessage('');
   try {
     const result=await action();
     if (!result.ok) {setMessage(result.error);return;}
     if (ext && result.data.some(item => item.sessions > 0) && extSignature(result.data) !== extSignature(ext)) setExtReload(true);
     setExt(result.data);
   } catch {setMessage('Não foi possível atualizar as extensões.');}
   finally {setBusy(false);}
 }
 async function removeExtension(item: ExtensionInfo) {
   if (!window.confirm(`Remover “${item.name}” da lista? A pasta da extensão não é apagada.`)) return;
   await changeExtensions(() => window.pokehub.extensions.remove(item.id));
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
// Atualização do app: o selo da barra e a seção de Configurações usam o mesmo estado.
 async function updateAction(action: () => Promise<Result<UpdateInfo>>) {
   try {const result=await action();if (result.ok) setUpd(result.data);else setMessage(result.error);}
   catch {setMessage('Não foi possível falar com o atualizador.');}
 }
 async function installUpdate() {
   if (!canLeaveEditor()) return;
   try {const result=await window.pokehub.updates.install();if (!result.ok) setMessage(result.error);}
   catch {setMessage('Não foi possível reiniciar para atualizar.');}
 }
 const updState = upd?.status;
 const updatePill = updState?.state === 'available' ? <button className="update" title={updState.notes ? `Baixar a atualização · ${updState.notes}` : 'Baixar a atualização'} onClick={() => void updateAction(window.pokehub.updates.download)}>Atualização {updState.version}</button>
  : updState?.state === 'downloading' ? <button className="update" disabled aria-label={`Baixando a atualização, ${updState.percent ?? 0}%`}>Baixando {updState.percent ?? 0}%</button>
  : updState?.state === 'ready' ? <button className="update ready" title="Reinicia o PokéHub e instala a atualização" onClick={() => void installUpdate()}>Reiniciar e atualizar</button> : null;
 const updText = !upd ? '' : {idle:'Ainda não verificado.',checking:'Verificando…',available:`Versão ${upd.status.version ?? ''} disponível.`,none:'Você já usa a versão mais recente.',downloading:`Baixando… ${upd.status.percent ?? 0}%`,ready:'Atualização baixada. Reinicie para instalar.',error:'A última verificação falhou.',disabled:'A atualização automática só funciona no aplicativo instalado.'}[upd.status.state];
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
 const focusIndex = active ? profiles.indexOf(active) : null;
 const colsShown = loaded && !loadError && editor === null && profiles.length > 0;
 const rects = colsShown ? columns(Math.max(0,size.w),Math.max(size.h,TOP_BAR),profiles.length,focusIndex,sideWidth(size.w,sideShown,focusIndex,sidePrefs.width,profiles.length)) : [];
 const barAlert = message !== '' && editor === null && (loadError || profiles.length > 0);
 const smallWindow = 'Janela pequena: exibindo uma sessão por vez. Amplie para ver a grade.';
 return <>
 <header className="bar"><div className="brand"><Logo/><strong>PokéHub</strong></div>
 {barAlert ? <div className="bar-alert" role="alert"><span title={message}>{message}</span><button className="icon" aria-label="Dispensar aviso" title="Dispensar aviso" onClick={() => setMessage('')}><Icon d={icons.close}/></button></div> :
 <nav aria-label="Sessões"><div className="seg" role="group" aria-label="Visualização"><button disabled={!loaded || loadError || busy} aria-keyshortcuts="Control+0" title={autoFocus ? smallWindow : 'Grade (Ctrl+0)'} aria-pressed={!active} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(null);}}}><ViewIcon mode="grid"/><span>Grade</span></button><button disabled={!loaded || loadError || busy || profiles.length === 0} title="Focar uma sessão" aria-pressed={Boolean(active)} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(active?.id ?? profiles[0]?.id ?? null);}}}><ViewIcon mode="focus"/><span>Foco</span></button></div>{autoFocus && <span className="sr" role="status">{smallWindow}</span>}{profiles.map((p,index) => {const state=states[p.id] ?? '';const label=labels[state] ?? 'Iniciando';const short=shortLabels[state] ?? 'Iniciando';return <button key={p.id} className="tab" style={{'--c':p.colorToken} as CSSProperties} disabled={!loaded || loadError || busy} aria-keyshortcuts={`Control+${index+1}`} title={`Focar ${p.label} (Ctrl+${index+1}) · ${label}`} aria-pressed={active?.id===p.id} onClick={() => {if (canLeaveEditor()) {setEditor(null);setFocus(p.id);}}}><El color={p.colorToken}/><span className="name">{p.label}</span><span className="st" data-state={state}><b/><span className="sr">{label}</span>{short && <small aria-hidden="true">{short}</small>}</span></button>;})}<i className="ind" ref={indicator} aria-hidden="true"/></nav>}
 <div className="tools">{updatePill}{active && <div className="group" role="group" aria-label={`Sessão ${active.label}`}><button className="icon" disabled={busy || loadError} aria-label={`Editar ${active.label}`} title={`Editar ${active.label}`} onClick={() => openEditor(active)}><Icon d={icons.edit}/></button><button className="icon" disabled={busy || loadError} aria-label={`Recarregar ${active.label}`} title={`Recarregar ${active.label}`} onClick={() => void reload(active.id)}><Icon d={icons.reload}/></button><button className="icon" disabled={busy || loadError} aria-label={`Reabrir sessão de ${active.label}`} title={`Reabrir sessão de ${active.label}`} onClick={() => void restart(active.id)}><Icon d={icons.restart}/></button></div>}<button className="icon" disabled={!sideAllowed || busy} aria-label="Onde caçar?" aria-keyshortcuts="Control+H" title={active ? 'Onde caçar? · Disponível na Grade' : !wide ? 'Onde caçar? · Disponível na Grade com a janela mais larga' : 'Onde caçar? (Ctrl+H)'} aria-pressed={sideShown} onClick={() => {if (editor === null) setSide(!side); else if (canLeaveEditor()) {setEditor(null);setMessage('');setSide(true);}}}><Icon d={icons.target}/></button><button className="icon" disabled={!loaded || busy} aria-label="Configurações" title="Configurações" aria-pressed={editor==='settings'} onClick={() => void openSettings()}><Icon d={icons.settings}/></button><button className="icon" disabled={!loaded || busy} aria-label="Diagnóstico" title="Diagnóstico" aria-pressed={editor==='diagnostics'} onClick={openDiagnostics}><Icon d={icons.diagnostics}/></button><button className="primary" disabled={!loaded || loadError || profiles.length >= MAX_PROFILES || busy} title={profiles.length >= MAX_PROFILES ? `Limite de ${MAX_PROFILES} perfis atingido` : 'Novo perfil'} onClick={() => openEditor()}><Icon d={icons.plus}/><span>Perfil</span></button></div></header>
 {editor === 'settings' && <main><section className="panel" aria-busy={busy}><h1>Configurações</h1><p>Escolha como o workspace aparece na próxima abertura.</p>{startupMode && <fieldset className="settings-choice"><legend>Ao iniciar</legend><label><input type="radio" name="startupMode" checked={startupMode==='grid'} onChange={() => {setStartupMode('grid');setSettingsSaved(false);}}/>Abrir em grade</label><label><input type="radio" name="startupMode" checked={startupMode==='focus-first'} onChange={() => {setStartupMode('focus-first');setSettingsSaved(false);}}/>Focar a primeira conta</label></fieldset>}{!startupMode && busy && <p role="status">Carregando configuração…</p>}<div className="actions"><button className="primary" disabled={busy || !startupMode} onClick={() => void saveSettings()}>Salvar</button><button disabled={busy} onClick={() => {if (canLeaveEditor()) {setEditor(null);setMessage('');}}}>Voltar</button></div>{settingsSaved && <p role="status">Preferência salva para a próxima abertura.</p>}{message && <p role="alert">{message}</p>}
 {ext && <section className="zone ext" aria-labelledby="ext-title"><h2 id="ext-title">Extensões</h2>
  {ext.length === 0 && <p className="ext-state" data-on="false">Nenhuma extensão. Use “Detectar no navegador” para achar /hunt e Smart Market, ou adicione uma pasta.</p>}
  <ul className="ext-list">{ext.map(item => <li key={item.id} className="ext-card">
   <div className="ext-head"><strong>{item.name}</strong>{item.version && <small>{item.version}</small>}{item.verdict && <span className="verdict" data-verdict={item.verdict}>{verdicts[item.verdict]}</span>}<span className="grow"/>
    <label className="switch mini"><span className="sr">Usar {item.name}</span><input type="checkbox" role="switch" checked={item.enabled} disabled={busy || item.verdict === 'bloqueada'} onChange={event => {const enabled=event.target.checked;void changeExtensions(() => window.pokehub.extensions.toggle(item.id,enabled));}}/></label>
    <button className="danger" disabled={busy} onClick={() => void removeExtension(item)}>Remover</button></div>
   <p className="ext-state" role="status" data-on={item.enabled && item.loaded > 0}>{!item.enabled ? 'Desativada.' : item.verdict === 'bloqueada' ? 'Não será carregada.' : item.sessions === 0 ? 'Será carregada ao abrir uma sessão.' : `Carregada em ${item.loaded} de ${item.sessions} ${item.sessions === 1 ? 'sessão' : 'sessões'}.`}</p>
   {item.error && <p role="alert">{item.error}</p>}
   {item.findings.length > 0 && <><button className="link" aria-expanded={openFindings === item.id} onClick={() => setOpenFindings(openFindings === item.id ? null : item.id)}>{openFindings === item.id ? 'Ocultar achados' : `Ver achados (${item.findings.length})`}</button>
    {openFindings === item.id && <ul className="findings">{item.findings.map((finding,index) => <li key={index} data-kind={finding.kind}><b>{findingLabels[finding.kind]}</b> <span>{finding.detail}</span> <small>{finding.file}</small></li>)}</ul>}</>}
   <p className="ext-path">{item.path}</p></li>)}</ul>
  {!ext.some(item => item.catalogId === SMART_MARKET_ID) && <p className="ext-state" data-on="false">Smart Market não detectada. Instale-a pela Chrome Web Store (chromewebstore.google.com, id {SMART_MARKET_ID}) e use “Detectar no navegador”. <button className="link" disabled={busy} onClick={() => void window.pokehub.extensions.openStore(SMART_MARKET_ID)}>Abrir a página da loja</button></p>}
  <div className="actions"><button disabled={busy} onClick={() => void changeExtensions(() => window.pokehub.extensions.detect())}>Detectar no navegador</button><button disabled={busy} onClick={() => void changeExtensions(() => window.pokehub.extensions.add())}>Adicionar pasta…</button>{extReload && <button className="primary" disabled={busy} onClick={() => void reloadSessions()}>Recarregar sessões para aplicar</button>}</div>
  <p className="note">/hunt e Smart Market são de terceiros e rodam dentro das suas sessões do jogo. O PokéHub não as copia nem as modifica. Cada pasta passa por uma auditoria estática (o código não é executado): extensões que compram, vendem ou clicam sozinhas (automação) não são suportadas. “Só leitura” e “Interage com a página” são estimativas pelo que o código parece fazer, não garantia.</p>
 </section>}
 {upd && <section className="zone ext" aria-labelledby="upd-title"><h2 id="upd-title">Atualizações</h2>
  <p className="ext-state" data-on="false">Versão atual: {upd.version}</p>
  <label className="switch"><span>Verificar automaticamente (ao abrir e a cada 6 h)</span><input type="checkbox" role="switch" checked={upd.autoCheck} disabled={!upd.packaged} onChange={event => {const enabled=event.target.checked;void updateAction(() => window.pokehub.updates.setAuto(enabled));}}/></label>
  <p className="ext-state" role="status" data-on={upd.status.state === 'none' || upd.status.state === 'ready'}>{updText}</p>
  {upd.status.error && <p role="alert">{upd.status.error}</p>}
  <div className="actions"><button disabled={!upd.packaged || upd.status.state === 'checking' || upd.status.state === 'downloading'} onClick={() => void updateAction(window.pokehub.updates.check)}>Verificar agora</button>{upd.status.state === 'available' && <button className="primary" onClick={() => void updateAction(window.pokehub.updates.download)}>Baixar {upd.status.version}</button>}{upd.status.state === 'ready' && <button className="primary" onClick={() => void installUpdate()}>Reiniciar e atualizar</button>}</div>
 </section>}</section></main>}
 {editor === 'diagnostics' && <main><section className="panel" aria-busy={busy}><h1>Diagnóstico local</h1><p>Valores dos processos do PokéHub, incluindo as páginas do jogo. Os dados ficam nesta máquina.</p>{diagnostics && <dl className="diagnostics"><div><dt>Processos</dt><dd>{diagnostics.processCount}</dd></div><div><dt>Memória residente somada</dt><dd>{diagnostics.memoryKb === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR').format(diagnostics.memoryKb)} KB`}</dd></div><div><dt>CPU somada</dt><dd>{diagnostics.cpuPercent === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuPercent)}%`}</dd></div>{diagnostics.cpuIntervalMs !== null && <div><dt>Intervalo aproximado da CPU</dt><dd>{new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuIntervalMs / 1000)} s</dd></div>}</dl>}<p>A memória compartilhada pode ser contada mais de uma vez. A CPU pode ultrapassar 100% e exige duas amostras com pelo menos 1 segundo de intervalo; mudanças nos processos reiniciam a comparação.</p>{diagnostics && <p>Última amostra: {new Date(diagnostics.sampledAt).toLocaleTimeString('pt-BR')}</p>}<div className="actions"><button className="primary" disabled={busy} onClick={() => void sampleDiagnostics()}>{busy ? 'Consultando…' : 'Atualizar'}</button><button disabled={busy} onClick={() => {if (canLeaveEditor()) {setEditor(null);setMessage('');}}}>Voltar</button></div>{message && <p role="alert">{message}</p>}</section></main>}
 {editor !== null && editor !== 'diagnostics' && editor !== 'settings' && <main><section className="panel"><h1>{editor==='new'?'Novo perfil':'Editar perfil'}</h1><p>O e-mail é apenas uma identificação. O login acontece na página oficial do jogo.</p><form aria-busy={busy} onSubmit={event => void submit(event)}><label>Nome do perfil<input required maxLength={80} value={form.label} onChange={e => setForm({...form,label:e.target.value})}/></label><label>E-mail de identificação<input required type="email" maxLength={254} value={form.emailLabel} onChange={e => setForm({...form,emailLabel:e.target.value})}/></label><label>Personagem (opcional)<input maxLength={80} value={form.characterName} onChange={e => setForm({...form,characterName:e.target.value})}/></label><label className="color" style={{'--c':form.colorToken} as CSSProperties}>Cor<span><input type="color" value={form.colorToken} onChange={e => setForm({...form,colorToken:e.target.value})}/><El color={form.colorToken}/>{elements[elementOf(form.colorToken)].name}</span></label><div className="actions"><button className="primary" disabled={busy}>Salvar</button><button type="button" disabled={busy} onClick={() => {if (canLeaveEditor()) setEditor(null);}}>Cancelar</button></div>{editor !== 'new' && <div className="zone"><h2>Dados e remoção</h2><div className="actions"><button type="button" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void clearSession(profile);}}>Limpar dados da sessão</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void remove(profile);}}>Remover só o perfil</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void removeWithData(profile);}}>Apagar perfil e dados</button></div></div>}</form>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 {colsShown && <div className="cols">{profiles.map((p,index) => {const r = rects[index]; if (!r) return null; const state = states[p.id] ?? ''; const label = labels[state] ?? 'Iniciando'; const short = shortLabels[state] ?? 'Iniciando'; const focused = active?.id === p.id;
  return <section key={p.id} className="col-head" aria-label={`Sessão ${p.label}`} data-state={state} style={{'--c':p.colorToken,left:r.x,top:r.y,width:r.width,height:COL_HEAD} as CSSProperties}>
   <El color={p.colorToken}/><strong title={p.characterName ? `${p.label} · ${p.characterName}` : p.label}>{p.label}</strong>{short && <span className="pill" data-state={state} role="status" title={label}>{short}</span>}<span className="grow"/>
   <button className="icon" disabled={busy || (focused && Boolean(autoFocus))} aria-pressed={focused} aria-label={focused ? `Voltar à grade` : `Focar ${p.label}`} title={focused ? (autoFocus ? smallWindow : 'Voltar à grade') : `Focar ${p.label} (Ctrl+${index+1})`} onClick={() => setFocus(focused ? null : p.id)}><ViewIcon mode={focused ? 'grid' : 'focus'}/></button>
   <button className="icon" disabled={busy} aria-label={`Recarregar ${p.label}`} title={`Recarregar ${p.label}`} onClick={() => void reload(p.id)}><Icon d={icons.reload}/></button>
   <button className="icon" disabled={busy} aria-label={`Reabrir sessão de ${p.label}`} title={`Reabrir sessão de ${p.label}`} onClick={() => void restart(p.id)}><Icon d={icons.restart}/></button>
  </section>;})}</div>}
 {sideShown && <HuntSide profiles={profiles} states={states} prefs={sidePrefs} onPrefs={setSidePrefs} onClose={() => setSide(false)} onSettings={() => void openSettings()}/>}
 {!loaded && <main><section className="panel" role="status"><h1>Carregando perfis</h1><p>Preparando suas sessões locais.</p></section></main>}
 {loaded && loadError && editor === null && <main><section className="panel"><h1>Não foi possível carregar os perfis</h1><p>Verifique o armazenamento local e tente novamente.</p><button className="primary" onClick={() => {setLoaded(false);void initialize().catch(() => {setLoadError(true);setLoaded(true);});}}>Tentar novamente</button></section></main>}
 {loaded && !loadError && editor === null && profiles.length === 0 && <main><section className="panel empty"><Logo/><h1>Suas sessões em um só lugar</h1><p>Crie um perfil para abrir o PokéIdle. Cada perfil usa uma sessão local separada.</p><button className="primary" onClick={() => openEditor()}>Criar primeiro perfil</button>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
