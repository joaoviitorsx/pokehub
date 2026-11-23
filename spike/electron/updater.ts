// Atualização automática pelo GitHub Releases (electron-updater). Só age no app empacotado.
import { app } from 'electron';
import type { UpdateStatus } from '../contracts/update';
import { INITIAL_UPDATE, reduceUpdate, type UpdateEvent } from './update-status';

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000; // verificação que falhou (sem rede, release incompleta) tenta de novo logo
const STALE_MS = 60 * 60 * 1000; // ao reabrir a janela pela bandeja, verifica de novo se a última verificação tem mais de 1 h

export interface Updater { status(): UpdateStatus; check(manual: boolean): Promise<UpdateStatus>; checkIfStale(): void; download(): Promise<UpdateStatus>; install(): boolean; dispose(): void }

export function createUpdater(options: {autoCheck: () => boolean; onStatus: (status: UpdateStatus) => void}): Updater {
  let status: UpdateStatus = INITIAL_UPDATE;
  const apply = (event: UpdateEvent) => { const next = reduceUpdate(status,event); if (next !== status) { status = next; options.onStatus(status); } return status; };
  if (!app.isPackaged) { apply({type:'disable'}); return {status:() => status, check:async () => status, checkIfStale() {}, download:async () => status, install:() => false, dispose() {}}; }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater'); // só carrega empacotado
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', info => apply({type:'available',version:info.version,notes:typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]*>/g,' ') : ''}));
  autoUpdater.on('update-not-available', () => apply({type:'none'}));
  autoUpdater.on('download-progress', progress => apply({type:'progress',percent:progress.percent}));
  autoUpdater.on('update-downloaded', () => apply({type:'downloaded'}));
  autoUpdater.on('error', error => { console.error('Falha na atualização:',error?.message); apply({type:'error',message:status.state === 'downloading' ? 'Não foi possível baixar a atualização.' : 'Não foi possível verificar atualizações.'}); });
  async function check(manual: boolean) {
    if (!manual && !options.autoCheck()) return status;
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status;
    apply({type:'checking'}); lastCheck = Date.now(); clearTimeout(retry);
    try { await autoUpdater.checkForUpdates(); } catch { apply({type:'error',message:'Não foi possível verificar atualizações.'}); }
    if (status.state === 'error') retry = setTimeout(() => { void check(false); }, RETRY_AFTER_ERROR_MS);
    return status;
  }
  let lastCheck = 0; let retry: ReturnType<typeof setTimeout> | undefined;
  const first = setTimeout(() => { void check(false); }, FIRST_CHECK_MS);
  const every = setInterval(() => { void check(false); }, CHECK_EVERY_MS);
  return {
    status: () => status,
    check,
    checkIfStale() { if (lastCheck > 0 && Date.now() - lastCheck > STALE_MS) void check(false); },
    async download() {
      if (status.state !== 'available') return status;
      apply({type:'start-download'});
      try { await autoUpdater.downloadUpdate(); } catch { apply({type:'error',message:'Não foi possível baixar a atualização.'}); }
      return status;
    },
    install() { if (status.state !== 'ready') return false; autoUpdater.quitAndInstall(false,true); return true; },
    dispose() { clearTimeout(first); clearInterval(every); clearTimeout(retry); },
  };
}
