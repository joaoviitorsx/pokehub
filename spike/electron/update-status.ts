// Máquina de estados da atualização (pura, sem Electron): o wrapper em updater.ts só traduz os eventos do electron-updater.
import type { UpdateStatus } from '../contracts/update';

export type UpdateEvent =
  | {type:'disable'}
  | {type:'checking'}
  | {type:'available'; version: string; notes?: string}
  | {type:'none'}
  | {type:'start-download'}
  | {type:'progress'; percent: number}
  | {type:'downloaded'}
  | {type:'error'; message: string};

export const INITIAL_UPDATE: UpdateStatus = {state:'idle'};
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\p{Cc}+/gu,' ').trim().slice(0,max) : '';

export function reduceUpdate(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  if (status.state === 'disabled') return status;
  const busy = status.state === 'downloading' || status.state === 'ready';
  switch (event.type) {
    case 'disable': return {state:'disabled'};
    case 'checking': return busy ? status : {state:'checking'};
    case 'available': {
      if (busy) return status;
      const version = clean(event.version,40), notes = clean(event.notes,500);
      return version ? {state:'available',version,...(notes ? {notes} : {})} : {state:'error',error:'Resposta de atualização inválida.'};
    }
    case 'none': return busy ? status : {state:'none'};
    case 'start-download': return status.state === 'available' ? {...status,state:'downloading',percent:0} : status;
    case 'progress': return status.state === 'downloading' ? {...status,percent:Number.isFinite(event.percent) ? Math.min(100,Math.max(0,Math.round(event.percent))) : 0} : status;
    case 'downloaded': return status.state === 'downloading' ? {state:'ready',...(status.version ? {version:status.version} : {})} : status;
    case 'error': {
      if (status.state === 'available' && status.error) return status; // o mesmo erro chega pelo evento e pela promessa
      const error = clean(event.message,200) || 'Falha na atualização.';
      // erro ao baixar mantém a versão para tentar de novo; erro ao verificar volta ao estado de erro simples
      return status.state === 'downloading' && status.version ? {state:'available',version:status.version,...(status.notes ? {notes:status.notes} : {}),error} : {state:'error',error};
    }
  }
}
