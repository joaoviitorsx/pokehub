import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
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
import { columns, COL_HEAD, MAX_PROFILES, sideWidth, TOP_BAR } from '../electron/layout';

type Result<T> = {ok:true; data:T} | {ok:false; error:string};
type Status = {id:string;state:string};
declare global { interface Window { pokehub: {
 list(): Promise<Result<Profile[]>>; initialFocus():Promise<Result<string|null>>; getPreferences():Promise<Result<StartupMode>>; setStartupMode(mode:StartupMode):Promise<Result<StartupMode>>; create(input:ProfileInput): Promise<Result<Profile>>; update(id:string,input:ProfileInput): Promise<Result<Profile>>; remove(id:string): Promise<Result<void>>;
 layout(id:string|null,hide:boolean,side:boolean,panel?:number,account?:string|null): Promise<Result<void>>; onToggleExpand(callback:(id:string|null)=>void):()=>void; drag(active:boolean): Promise<Result<void>>; huntSnapshot(id:string,soLiberadas?:boolean):Promise<Result<HuntSnapshot>>; onToggleSide(callback:()=>void):()=>void; reload(id:string): Promise<Result<void>>; restart(id:string): Promise<Result<void>>; clearSession(id:string): Promise<Result<void>>; states(): Promise<Result<Record<string,string>>>; diagnostics():Promise<Result<DiagnosticsSample>>; onStatus(callback:(status:Status)=>void):()=>void; onFocus(callback:(id:string|null)=>void):()=>void; autoFocus():Promise<Result<string|null>>; onAutoFocus(callback:(id:string|null)=>void):()=>void;
 extensions: {list():Promise<Result<ExtensionInfo[]>>; detect():Promise<Result<ExtensionInfo[]>>; add():Promise<Result<ExtensionInfo[]>>; toggle(id:string,enabled:boolean):Promise<Result<ExtensionInfo[]>>; remove(id:string):Promise<Result<ExtensionInfo[]>>; approve(id:string,hosts:string[]):Promise<Result<ExtensionInfo[]>>; openStore(id:string):Promise<Result<void>>};
 updates: {get():Promise<Result<UpdateInfo>>; check():Promise<Result<UpdateInfo>>; download():Promise<Result<UpdateInfo>>; install():Promise<Result<void>>; setAuto(enabled:boolean):Promise<Result<UpdateInfo>>; onStatus(callback:(status:UpdateStatus)=>void):()=>void};
} } }
const blank: ProfileInput = {label:'',emailLabel:'',characterName:'',colorToken:'#d4a65f'};
const labels: Record<string,string> = {loading:'Carregando',ready:'Página carregada',offline:'Sem conexão',auth_required:'Login no provedor',error:'Erro ao carregar'};
const shortLabels: Record<string,string> = {loading:'Carregando',ready:'',offline:'Offline',auth_required:'Login',error:'Erro'};
// Bola de captura em quatro cores (mesma arte de build/icon.svg, sem o fundo): ids únicos por instância.
function Logo() {
 const id = useId();
 return <svg className="logo" viewBox="62 62 388 388" aria-hidden="true"><defs><clipPath id={`${id}c`}><circle cx="256" cy="256" r="184"/></clipPath><radialGradient id={`${id}s`} cx="34%" cy="28%" r="70%"><stop offset="0" stopColor="#fff" stopOpacity=".35"/><stop offset=".45" stopColor="#fff" stopOpacity="0"/></radialGradient></defs>
  <g clipPath={`url(#${id}c)`}><rect x="72" y="72" width="184" height="184" fill="#f25f5c"/><rect x="256" y="72" width="184" height="184" fill="#ffca3a"/><rect x="72" y="256" width="184" height="184" fill="#3fa7d6"/><rect x="256" y="256" width="184" height="184" fill="#59cd90"/><rect x="72" y="72" width="368" height="368" fill={`url(#${id}s)`}/><rect x="72" y="238" width="368" height="36" fill="#14171f"/><rect x="253" y="72" width="6" height="368" fill="#14171f"/></g>
  <circle cx="256" cy="256" r="184" fill="none" stroke="#14171f" strokeWidth="20"/><circle cx="256" cy="256" r="66" fill="#14171f"/><circle cx="256" cy="256" r="44" fill="#eef1f6"/><circle cx="256" cy="256" r="22" fill="none" stroke="#c9ced8" strokeWidth="6"/></svg>;
}
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
const verdicts: Record<AuditVerdict,string> = {leitura:'Só leitura',interage:'Interage com a página',externa:'Acessa outros sites',bloqueada:'Bloqueada'};
const findingLabels: Record<AuditFinding['kind'],string> = {network:'Rede fora do jogo',link:'Link',fetch:'Rede/socket',click:'Clique',dispatch:'Evento na página',send:'Envio por socket',eval:'Código dinâmico',skipped:'Não auditado'};
const SMART_MARKET_ID = 'lhfeijlnlbglakplddjgbaopgcdfkcmm';
const extSignature = (list: ExtensionInfo[]) => list.map(item => `${item.id}|${item.path}|${item.enabled}|${item.approvedHosts.join(';')}`).join(',');
const fairUse = 'Use apenas suas contas e respeite o limite total do jogo.';
type Section = 'accounts' | 'ext' | 'upd' | 'layout' | 'diag';
const sections: {id: Section; label: string}[] = [{id:'accounts',label:'Contas'},{id:'ext',label:'Extensões'},{id:'upd',label:'Atualizações'},{id:'layout',label:'Layout'},{id:'diag',label:'Diagnóstico'}];
const expandHint = 'Ctrl+Shift+Enter alterna de qualquer lugar (inclusive dentro do jogo); Esc ou Ctrl+Enter na barra e nos cabeçalhos também voltam à grade.';
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));
function App() {
 const [profiles,setProfiles] = useState<Profile[]>([]);
 const [states,setStates] = useState<Record<string,string>>({});
 const [focus,setFocus] = useState<string|null>(null);
 const [expandedId,setExpandedId] = useState<string|null>(null); // conta aberta por "Expandir" a partir da grade: Esc/o mesmo botão voltam à grade
 const [autoFocus,setAutoFocus] = useState<string|null>(null);
 const [editor,setEditor] = useState<'new'|'manage'|string|null>(null);
 const [editorFrom,setEditorFrom] = useState<'manage'|null>(null); // o formulário de perfil foi aberto por Gerenciar → Contas: volta para lá
 const [section,setSection] = useState<Section>('accounts');
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
 const [sidePick,setSidePick] = useState<string|null>(null);
 const [sidePrefs,setSidePrefs] = useState(loadSidePrefs);
 useEffect(() => saveSidePrefs(sidePrefs),[sidePrefs]);
 const [size,setSize] = useState(() => ({w:window.innerWidth,h:window.innerHeight}));
 useEffect(() => {
   const update = () => setSize({w:window.innerWidth,h:window.innerHeight});
   window.addEventListener('resize',update);
   return () => window.removeEventListener('resize',update);
 },[]);
 const focusEventReceived = useRef(false);
 const hoverCol = useRef<string|null>(null); // última coluna sob o ponteiro: alvo do Ctrl+Enter
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
 if (expandedId !== null && focus !== expandedId) setExpandedId(null); // qualquer outra troca de foco encerra o "expandido"
 const active = profiles.find(p => p.id === (focus ?? autoFocus));
 // A lateral "Onde caçar?" vale em qualquer modo (grade, foco, expandido). Se a grade não couber ao lado dela, o processo principal reduz colunas/linhas
 // e, em último caso, mostra só a conta escolhida na lateral (foco automático). Largura: sideWidth() em electron/layout.ts.
 const sideAllowed = loaded && !loadError && profiles.length > 0;
 const sideShown = side && sideAllowed && editor === null;
 useEffect(() => window.pokehub.onToggleSide(() => { if (sideAllowed && editor === null) setSide(open => !open); }),[sideAllowed,editor]);
 useEffect(() => { if (loaded) void window.pokehub.layout(focus,editor !== null || loadError,sideShown,sidePrefs.width,sideShown ? sidePick : null).then(result => {if (!result.ok) setMessage(result.error);}).catch(() => setMessage('Falha de comunicação com o aplicativo.')); },[focus,editor,loaded,loadError,profiles.length,sideShown,sidePrefs.width,sidePick]);
 const unsavedProfile = editor !== null && editor !== 'manage' && profileFormChanged(initialForm,form);
 const unsavedSettings = editor === 'manage' && startupMode !== null && savedStartupMode !== null && startupMode !== savedStartupMode;
 useEffect(() => {
   if (!unsavedProfile && !unsavedSettings && !busy) return;
   const preventUnload = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue = '';};
   window.addEventListener('beforeunload',preventUnload);
   return () => window.removeEventListener('beforeunload',preventUnload);
 },[unsavedProfile,unsavedSettings,busy]);
 function canLeaveEditor() { return !(unsavedProfile || unsavedSettings) || window.confirm('Descartar alterações não salvas?'); }
 // Fecha qualquer tela (formulário, Gerenciar) e opcionalmente muda o foco.
 function go(id: string|null|undefined) { if (!canLeaveEditor()) return; setEditor(null);setEditorFrom(null);setMessage('');if (id !== undefined) setFocus(id); }
 // Salvar/cancelar/remover um perfil volta a Gerenciar se foi de lá que o formulário abriu.
 function closeEditor() { const back = editor === 'manage' || editorFrom === 'manage'; setEditor(back ? 'manage' : null);setEditorFrom(null); }
 function openEditor(profile?: Profile) {
   if (editor !== 'manage' && !canLeaveEditor()) return;
   const values = profile ? {label:profile.label,emailLabel:profile.emailLabel,characterName:profile.characterName,colorToken:profile.colorToken} : blank;
   setEditorFrom(editor === 'manage' ? 'manage' : null);setMessage('');setForm(values);setInitialForm(values);setEditor(profile?.id ?? 'new');
 }
 async function submit(event: FormEvent) {
   event.preventDefault(); if (!editor || busy) return; setBusy(true);setMessage('');
   try { const result = editor === 'new' ? await window.pokehub.create(form) : await window.pokehub.update(editor,form);
     if (!result.ok) {setMessage(result.error);return;} await refresh();closeEditor();
   } catch {setMessage('Falha de comunicação com o aplicativo.');} finally {setBusy(false);}
 }
 async function remove(profile: Profile) {
   if (!window.confirm(`Remover o perfil “${profile.label}”? Os dados de login locais não serão apagados.`)) return;
   setBusy(true);try {const result = await window.pokehub.remove(profile.id);if (!result.ok) {setMessage(result.error);return;} if (focus === profile.id) setFocus(null);closeEditor();await refresh();} catch {setMessage('Falha de comunicação com o aplicativo.');} finally {setBusy(false);}
 }
 async function removeWithData(profile: Profile) {
   if (!window.confirm(`Apagar o perfil “${profile.label}” e os dados locais de sua sessão? A ação é irreversível e exigirá novo login.`)) return;
   setBusy(true); setMessage('');
   try {
     const result = await removeProfileAndData({clear: async () => (await window.pokehub.clearSession(profile.id)).ok, remove: async () => (await window.pokehub.remove(profile.id)).ok});
     if (result === 'clear-failed') {setMessage('Não foi possível confirmar a limpeza. O perfil foi mantido; os dados podem ter sido parcialmente apagados.');return;}
     if (result === 'remove-failed') {setMessage('Os dados foram limpos, mas não foi possível confirmar a remoção do perfil. Atualize a lista e verifique.');await refresh();return;}
     if (focus === profile.id) setFocus(null); closeEditor(); await refresh();
   } catch {setMessage('Não foi possível concluir a operação. Atualize a lista e verifique o perfil.');}
   finally {setBusy(false);}
 }
 async function sampleDiagnostics() {
   setBusy(true); setMessage('');
   try { const result = await window.pokehub.diagnostics(); if (result.ok) setDiagnostics(result.data); else setMessage(result.error); }
   catch { setMessage('Não foi possível obter o diagnóstico local.'); }
   finally { setBusy(false); }
 }
 function selectSection(next: Section) {
   setSection(next);setMessage('');
   if (next === 'diag') {setDiagnostics(null);void sampleDiagnostics();}
 }
 // Gerenciar: contas, extensões, atualizações, layout e diagnóstico numa tela só. Os dados são carregados ao abrir.
 async function openManage(target: Section = 'accounts') {
   if (editor !== 'manage' && !canLeaveEditor()) return;
   setEditor('manage');setEditorFrom(null);setSection(target);setStartupMode(null);setSavedStartupMode(null);setSettingsSaved(false);setExt(null);setExtReload(false);setOpenFindings(null);setDiagnostics(null);setMessage('');setBusy(true);
   try {const result=await window.pokehub.getPreferences();if(result.ok) {setStartupMode(result.data);setSavedStartupMode(result.data);}else setMessage(result.error);
     const extensions=await window.pokehub.extensions.list();if(extensions.ok) setExt(extensions.data);
     const info=await window.pokehub.updates.get();if(info.ok) setUpd(info.data);}
   catch {setMessage('Não foi possível carregar as configurações.');}
   finally {setBusy(false);}
   if (target === 'diag') void sampleDiagnostics();
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
 async function approveExtension(item: ExtensionInfo) {
   const sites = item.hosts.join(', ');
   if (!window.confirm(`Permitir que “${item.name}” acesse ${sites}?\n\nA extensão roda dentro das suas sessões do jogo e passará a fazer requisições a esses sites; eles verão o seu IP. O PokéHub não vê nem filtra esse tráfego. Só permita se você confia na extensão e nesses sites.\n\nSe a extensão passar a acessar outro site, o PokéHub deixa de carregá-la e pergunta de novo.`)) return;
   await changeExtensions(() => window.pokehub.extensions.approve(item.id,item.hosts));
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
// Atualização do app: o selo da barra e a seção de Gerenciar usam o mesmo estado.
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
 const rects = colsShown ? columns(Math.max(0,size.w),Math.max(size.h,TOP_BAR),profiles.length,focusIndex,sideWidth(size.w,sideShown,sidePrefs.width)) : [];
 // Expandir uma conta é o foco nela, lembrando que veio da grade; as sessões continuam abertas (nada recarrega).
 const expand = (id: string) => {setExpandedId(id);setFocus(id);};
 const collapse = () => {setExpandedId(null);setFocus(null);};
 useEffect(() => {
   const toggle = (id: string|null) => {
     if (!colsShown || busy) return;
     if (focus !== null) {setExpandedId(null);setFocus(null);return;}
     const target = [id,hoverCol.current].find(candidate => candidate && profiles.some(p => p.id === candidate)) ?? profiles[0]?.id;
     if (target) {setExpandedId(target);setFocus(target);}
   };
   const key = (event: KeyboardEvent) => {
     if (event.defaultPrevented || event.altKey || event.metaKey) return;
     if (event.key === 'Escape' && expandedId !== null && colsShown && !typing(event.target)) {event.preventDefault();setExpandedId(null);setFocus(null);}
     else if (event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !typing(event.target)) {event.preventDefault();toggle(null);}
   };
   window.addEventListener('keydown',key);
   const unsubscribe = window.pokehub.onToggleExpand(toggle);
   return () => {window.removeEventListener('keydown',key);unsubscribe();};
 },[colsShown,busy,focus,expandedId,profiles]);
 const barAlert = message !== '' && editor === null && (loadError || profiles.length > 0);
 const smallWindow = 'Janela pequena: exibindo uma sessão por vez. Amplie para ver a grade.';
 return <>
 <header className="bar"><div className="brand"><Logo/><strong>PokéHub</strong></div>
 {barAlert ? <div className="bar-alert" role="alert"><span title={message}>{message}</span><button className="icon" aria-label="Dispensar aviso" title="Dispensar aviso" onClick={() => setMessage('')}><Icon d={icons.close}/></button></div> :
 <nav aria-label="Sessões"><div className="seg" role="group" aria-label="Visualização"><button disabled={!loaded || loadError || busy} aria-keyshortcuts="Control+0" title={autoFocus ? smallWindow : 'Grade (Ctrl+0)'} aria-pressed={!active} onClick={() => go(null)}><ViewIcon mode="grid"/><span>Grade</span></button><button disabled={!loaded || loadError || busy || profiles.length === 0} title="Focar uma sessão" aria-pressed={Boolean(active)} onClick={() => go(active?.id ?? profiles[0]?.id ?? null)}><ViewIcon mode="focus"/><span>Foco</span></button></div>{autoFocus && <span className="sr" role="status">{smallWindow}</span>}{profiles.map((p,index) => {const state=states[p.id] ?? '';const label=labels[state] ?? 'Iniciando';const short=shortLabels[state] ?? 'Iniciando';return <button key={p.id} className="tab" style={{'--c':p.colorToken} as CSSProperties} disabled={!loaded || loadError || busy} aria-keyshortcuts={`Control+${index+1}`} title={`Focar ${p.label} (Ctrl+${index+1}) · ${label}`} aria-pressed={active?.id===p.id} onClick={() => go(p.id)}><El color={p.colorToken}/><span className="name">{p.label}</span><span className="st" data-state={state}><b/><span className="sr">{label}</span>{short && <small aria-hidden="true">{short}</small>}</span></button>;})}<i className="ind" ref={indicator} aria-hidden="true"/></nav>}
 <div className="tools">{updatePill}<button className="icon" disabled={!sideAllowed || busy} aria-label="Onde caçar?" aria-keyshortcuts="Control+H" title="Onde caçar? (Ctrl+H)" aria-pressed={sideShown} onClick={() => {if (editor === null) setSide(!side); else if (canLeaveEditor()) {setEditor(null);setEditorFrom(null);setMessage('');setSide(true);}}}><Icon d={icons.target}/></button><button className="icon" disabled={!loaded || busy} aria-label="Gerenciar" title="Gerenciar contas, extensões, atualizações e layout" aria-pressed={editor==='manage' || editorFrom==='manage'} onClick={() => void openManage()}><Icon d={icons.gear}/></button><button className="primary" disabled={!loaded || loadError || profiles.length >= MAX_PROFILES || busy} title={profiles.length >= MAX_PROFILES ? `Limite de ${MAX_PROFILES} perfis atingido` : 'Novo perfil'} onClick={() => openEditor()}><Icon d={icons.plus}/><span>Perfil</span></button></div></header>
 {editor === 'manage' && <main><section className="panel manage" aria-busy={busy}>
  <div className="manage-nav" role="group" aria-label="Seções de Gerenciar">{sections.map(item => <button key={item.id} aria-pressed={section === item.id} onClick={() => selectSection(item.id)}>{item.label}</button>)}<span className="grow"/><button onClick={() => go(undefined)}>Fechar</button></div>
  <div className="manage-body"><h1>Gerenciar · {sections.find(item => item.id === section)?.label}</h1>
  {section === 'accounts' && <section aria-label="Contas">
   <p>Seus perfis do jogo. Cada um usa uma sessão local separada.</p>
   {profiles.length === 0 ? <p className="ext-state" data-on="false">Nenhum perfil ainda.</p> : <ul className="acc-list">{profiles.map(p => {const state=states[p.id] ?? '';return <li key={p.id} className="acc-row" style={{'--c':p.colorToken} as CSSProperties}>
    <div className="acc-main"><El color={p.colorToken}/><strong>{p.label}</strong><span className="pill" data-state={state}>{labels[state] ?? 'Iniciando'}</span></div>
    <small>{p.characterName ? `${p.characterName} · ` : ''}{p.emailLabel}</small>
    <div className="actions"><button disabled={busy} onClick={() => openEditor(p)}>Editar</button><button disabled={busy} onClick={() => void reload(p.id)}>Recarregar</button><button disabled={busy} onClick={() => void restart(p.id)}>Reabrir sessão</button><button disabled={busy} onClick={() => void clearSession(p)}>Limpar dados</button><button className="danger" disabled={busy} onClick={() => void remove(p)}>Remover</button></div></li>;})}</ul>}
   <div className="actions"><button className="primary" disabled={busy || loadError || profiles.length >= MAX_PROFILES} title={profiles.length >= MAX_PROFILES ? `Limite de ${MAX_PROFILES} perfis atingido` : 'Novo perfil'} onClick={() => openEditor()}><Icon d={icons.plus}/>Novo perfil</button></div>
   <p className="note">{fairUse}</p></section>}
  {section === 'ext' && (ext ? <section className="ext" aria-label="Extensões">
  {ext.length === 0 && <p className="ext-state" data-on="false">Nenhuma extensão. Use “Detectar no navegador” para achar /hunt e Smart Market, ou adicione uma pasta.</p>}
  <ul className="ext-list">{ext.map(item => <li key={item.id} className="ext-card">
   <div className="ext-head"><strong>{item.name}</strong>{item.version && <small>{item.version}</small>}{item.verdict && <span className="verdict" data-verdict={item.verdict}>{verdicts[item.verdict]}</span>}<span className="grow"/>
    <label className="switch mini"><span className="sr">Usar {item.name}</span><input type="checkbox" role="switch" checked={item.enabled} disabled={busy || item.verdict === 'bloqueada'} onChange={event => {const enabled=event.target.checked;void changeExtensions(() => window.pokehub.extensions.toggle(item.id,enabled));}}/></label>
    <button className="danger" disabled={busy} onClick={() => void removeExtension(item)}>Remover</button></div>
   <p className="ext-state" role="status" data-on={item.enabled && item.loaded > 0}>{!item.enabled ? 'Desativada.' : item.verdict === 'bloqueada' ? 'Não será carregada.' : item.pending ? 'Não será carregada até você permitir os sites abaixo.' : item.sessions === 0 ? 'Será carregada ao abrir uma sessão.' : `Carregada em ${item.loaded} de ${item.sessions} ${item.sessions === 1 ? 'sessão' : 'sessões'}.`}</p>
   {item.error && <p role="alert">{item.error}</p>}
   {item.verdict === 'externa' && item.hosts.length > 0 && <div className="ext-hosts"><p>Esta extensão acessa outros sites (além do jogo):</p><ul>{item.hosts.map(host => <li key={host}><code>{host}</code>{item.approvedHosts.includes(host) && <small> · permitido</small>}</li>)}</ul>
    {item.pending && <button className="primary" disabled={busy} onClick={() => void approveExtension(item)}>Permitir estes sites</button>}</div>}
   {item.findings.length > 0 && <><button className="link" aria-expanded={openFindings === item.id} onClick={() => setOpenFindings(openFindings === item.id ? null : item.id)}>{openFindings === item.id ? 'Ocultar achados' : `Ver achados (${item.findings.length})`}</button>
    {openFindings === item.id && <ul className="findings">{item.findings.map((finding,index) => <li key={index} data-kind={finding.kind}><b>{findingLabels[finding.kind]}</b> <span>{finding.detail}</span> <small>{finding.file}</small></li>)}</ul>}</>}
   <p className="ext-path">{item.path}</p></li>)}</ul>
  {!ext.some(item => item.catalogId === SMART_MARKET_ID) && <p className="ext-state" data-on="false">Smart Market não detectada. Instale-a pela Chrome Web Store (chromewebstore.google.com, id {SMART_MARKET_ID}) e use “Detectar no navegador”. <button className="link" disabled={busy} onClick={() => void window.pokehub.extensions.openStore(SMART_MARKET_ID)}>Abrir a página da loja</button></p>}
  <div className="actions"><button disabled={busy} onClick={() => void changeExtensions(() => window.pokehub.extensions.detect())}>Detectar no navegador</button><button disabled={busy} onClick={() => void changeExtensions(() => window.pokehub.extensions.add())}>Adicionar pasta…</button>{extReload && <button className="primary" disabled={busy} onClick={() => void reloadSessions()}>Recarregar sessões para aplicar</button>}</div>
  <p className="note">/hunt e Smart Market são de terceiros e rodam dentro das suas sessões do jogo. O PokéHub não as copia nem as modifica. Cada pasta passa por uma auditoria estática (o código não é executado): extensões que compram, vendem ou clicam sozinhas (automação) não são suportadas. “Só leitura”, “Interage com a página” e “Acessa outros sites” são estimativas pelo que o código parece fazer, não garantia. Uma extensão que acessa outros sites só carrega depois que você permite aquela lista exata de sites.</p>
 </section> : busy ? <p role="status">Carregando extensões…</p> : null)}
  {section === 'upd' && (upd ? <section className="ext" aria-label="Atualizações">
  <p className="ext-state" data-on="false">Versão atual: {upd.version}</p>
  <label className="switch"><span>Verificar automaticamente (ao abrir e a cada 6 h)</span><input type="checkbox" role="switch" checked={upd.autoCheck} disabled={!upd.packaged} onChange={event => {const enabled=event.target.checked;void updateAction(() => window.pokehub.updates.setAuto(enabled));}}/></label>
  <p className="ext-state" role="status" data-on={upd.status.state === 'none' || upd.status.state === 'ready'}>{updText}</p>
  {upd.status.error && <p role="alert">{upd.status.error}</p>}
  <div className="actions"><button disabled={!upd.packaged || upd.status.state === 'checking' || upd.status.state === 'downloading'} onClick={() => void updateAction(window.pokehub.updates.check)}>Verificar agora</button>{upd.status.state === 'available' && <button className="primary" onClick={() => void updateAction(window.pokehub.updates.download)}>Baixar {upd.status.version}</button>}{upd.status.state === 'ready' && <button className="primary" onClick={() => void installUpdate()}>Reiniciar e atualizar</button>}</div>
 </section> : <p role="status">Carregando…</p>)}
  {section === 'layout' && <section aria-label="Layout"><p>Escolha como o workspace aparece na próxima abertura.</p>{startupMode && <fieldset className="settings-choice"><legend>Ao iniciar</legend><label><input type="radio" name="startupMode" checked={startupMode==='grid'} onChange={() => {setStartupMode('grid');setSettingsSaved(false);}}/>Abrir em grade</label><label><input type="radio" name="startupMode" checked={startupMode==='focus-first'} onChange={() => {setStartupMode('focus-first');setSettingsSaved(false);}}/>Focar a primeira conta</label></fieldset>}{!startupMode && busy && <p role="status">Carregando configuração…</p>}<div className="actions"><button className="primary" disabled={busy || !startupMode} onClick={() => void saveSettings()}>Salvar</button></div>{settingsSaved && <p role="status">Preferência salva para a próxima abertura.</p>}
   <p className="note">Atalhos: Ctrl+0 grade, Ctrl+1–4 foca uma conta, Ctrl+H abre o “Onde caçar?”. {expandHint}</p></section>}
  {section === 'diag' && <section aria-label="Diagnóstico"><p>Valores dos processos do PokéHub, incluindo as páginas do jogo. Os dados ficam nesta máquina.</p>{diagnostics && <dl className="diagnostics"><div><dt>Processos</dt><dd>{diagnostics.processCount}</dd></div><div><dt>Memória residente somada</dt><dd>{diagnostics.memoryKb === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR').format(diagnostics.memoryKb)} KB`}</dd></div><div><dt>CPU somada</dt><dd>{diagnostics.cpuPercent === null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuPercent)}%`}</dd></div>{diagnostics.cpuIntervalMs !== null && <div><dt>Intervalo aproximado da CPU</dt><dd>{new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(diagnostics.cpuIntervalMs / 1000)} s</dd></div>}</dl>}<p>A memória compartilhada pode ser contada mais de uma vez. A CPU pode ultrapassar 100% e exige duas amostras com pelo menos 1 segundo de intervalo; mudanças nos processos reiniciam a comparação.</p>{diagnostics && <p>Última amostra: {new Date(diagnostics.sampledAt).toLocaleTimeString('pt-BR')}</p>}<div className="actions"><button className="primary" disabled={busy} onClick={() => void sampleDiagnostics()}>{busy ? 'Consultando…' : 'Atualizar'}</button></div></section>}
  {message && <p role="alert">{message}</p>}</div></section></main>}
 {editor !== null && editor !== 'manage' && <main><section className="panel"><h1>{editor==='new'?'Novo perfil':'Editar perfil'}</h1><p>O e-mail é apenas uma identificação. O login acontece na página oficial do jogo.</p><form aria-busy={busy} onSubmit={event => void submit(event)}><label>Nome do perfil<input required maxLength={80} value={form.label} onChange={e => setForm({...form,label:e.target.value})}/></label><label>E-mail de identificação<input required type="email" maxLength={254} value={form.emailLabel} onChange={e => setForm({...form,emailLabel:e.target.value})}/></label><label>Personagem (opcional)<input maxLength={80} value={form.characterName} onChange={e => setForm({...form,characterName:e.target.value})}/></label><label className="color" style={{'--c':form.colorToken} as CSSProperties}>Cor<span><input type="color" value={form.colorToken} onChange={e => setForm({...form,colorToken:e.target.value})}/><El color={form.colorToken}/>{elements[elementOf(form.colorToken)].name}</span></label><div className="actions"><button className="primary" disabled={busy}>Salvar</button><button type="button" disabled={busy} onClick={() => {if (canLeaveEditor()) closeEditor();}}>Cancelar</button></div>{editor !== 'new' && <div className="zone"><h2>Dados e remoção</h2><div className="actions"><button type="button" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void clearSession(profile);}}>Limpar dados da sessão</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void remove(profile);}}>Remover só o perfil</button><button type="button" className="danger" disabled={busy} onClick={() => {const profile=profiles.find(p=>p.id===editor);if(profile) void removeWithData(profile);}}>Apagar perfil e dados</button></div></div>}</form>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 {colsShown && <div className="cols">{profiles.map((p,index) => {const r = rects[index]; if (!r) return null; const state = states[p.id] ?? ''; const label = labels[state] ?? 'Iniciando'; const short = shortLabels[state] ?? 'Iniciando'; const focused = active?.id === p.id; const expanded = expandedId === p.id && focused;
  const toggle = () => { if (focused) { if (focus !== null) collapse(); } else expand(p.id); };
  return <section key={p.id} className="col-head" aria-label={`Sessão ${p.label}`} data-state={state} style={{'--c':p.colorToken,left:r.x,top:r.y,width:r.width,height:COL_HEAD} as CSSProperties}
   onPointerEnter={() => {hoverCol.current = p.id;}} onDoubleClick={event => {if (!busy && !(event.target as HTMLElement).closest('button') && !(focused && focus === null)) toggle();}}>
   <El color={p.colorToken}/><strong title={p.characterName ? `${p.label} · ${p.characterName}` : p.label}>{p.label}</strong>{short && <span className="pill" data-state={state} role="status" title={label}>{short}</span>}<span className="grow"/>
   <button className="icon" disabled={busy || (focused && focus === null)} aria-pressed={expanded} aria-keyshortcuts="Control+Shift+Enter" aria-label={focused ? 'Voltar à grade' : `Expandir ${p.label}`} title={focused ? (focus === null ? smallWindow : `Voltar à grade (${expanded ? 'Esc · ' : ''}Ctrl+Shift+Enter)`) : `Expandir ${p.label} (Ctrl+Shift+Enter ou duplo clique no cabeçalho). ${expandHint}`} onClick={toggle}><Icon d={focused ? icons.collapse : icons.expand}/></button>
   <button className="icon" disabled={busy} aria-label={`Recarregar ${p.label}`} title={`Recarregar ${p.label}`} onClick={() => void reload(p.id)}><Icon d={icons.reload}/></button>
   <button className="icon" disabled={busy} aria-label={`Reabrir sessão de ${p.label}`} title={`Reabrir sessão de ${p.label}`} onClick={() => void restart(p.id)}><Icon d={icons.restart}/></button>
  </section>;})}</div>}
 {sideShown && <HuntSide profiles={profiles} states={states} prefs={sidePrefs} onPrefs={setSidePrefs} onClose={() => setSide(false)} onSettings={() => void openManage('ext')} focusId={active?.id ?? null} onAccount={setSidePick}/>}
 {!loaded && <main><section className="panel" role="status"><h1>Carregando perfis</h1><p>Preparando suas sessões locais.</p></section></main>}
 {loaded && loadError && editor === null && <main><section className="panel"><h1>Não foi possível carregar os perfis</h1><p>Verifique o armazenamento local e tente novamente.</p><button className="primary" onClick={() => {setLoaded(false);void initialize().catch(() => {setLoadError(true);setLoaded(true);});}}>Tentar novamente</button></section></main>}
 {loaded && !loadError && editor === null && profiles.length === 0 && <main><section className="panel empty"><Logo/><h1>Suas sessões em um só lugar</h1><p>Crie um perfil para abrir o PokéIdle. Cada perfil usa uma sessão local separada.</p><button className="primary" onClick={() => openEditor()}>Criar primeiro perfil</button>{message && <p role="alert">{message}</p>}<p className="note">{fairUse}</p></section></main>}
 </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
