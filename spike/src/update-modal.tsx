import { useEffect, useRef } from 'react';
import type { UpdateStatus } from '../contracts/update';
import { Ball, Icon, icons } from './icons';

const mb = (bytes?: number) => bytes === undefined ? '' : (bytes / 1_048_576).toLocaleString('pt-BR', {maximumFractionDigits: bytes >= 10 * 1_048_576 ? 0 : 1});
const INSTALL_DELAY_MS = 1600; // tempo para ler "Instalando…" antes do app fechar

/**
 * Modal da atualização: novidades → "Atualizar agora" → barra de download → instala em silêncio e o PokéHub reabre sozinho
 * na versão nova. `started` diz que o usuário pediu pelo modal (aí, ao terminar o download, instala sem outro clique).
 */
export function UpdateModal({status, current, started, onStart, onInstall, onClose}: {status: UpdateStatus; current: string; started: boolean; onStart: () => void; onInstall: () => void; onClose: () => void}) {
  const installing = useRef(false);
  const ready = status.state === 'ready';
  useEffect(() => {
    if (!ready || !started || installing.current) return;
    installing.current = true;
    const timer = window.setTimeout(onInstall, INSTALL_DELAY_MS);
    return () => { clearTimeout(timer); installing.current = false; };
  }, [ready, started, onInstall]);
  const busy = status.state === 'downloading' || (ready && started);
  const notes = (status.notes ?? '').split(/\s*(?:\r?\n|•|- )\s*/).map(line => line.trim()).filter(Boolean).slice(0, 8);
  const percent = status.state === 'downloading' ? status.percent ?? 0 : ready ? 100 : 0;
  const phase = ready && started ? 'instalando' : ready ? 'pronta' : status.state === 'downloading' ? 'baixando' : status.error ? 'erro' : 'nova';
  return <div className="ask-dialog upd-modal" role="dialog" aria-modal="true" aria-labelledby="upd-tit" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); }}>
    <div className="upd-card" data-phase={phase}>
      <div className="upd-hero" aria-hidden="true"><Ball className={phase === 'baixando' || phase === 'instalando' ? 'upd-ball spin' : 'upd-ball'}/></div>
      <h2 id="upd-tit">{phase === 'instalando' ? 'Instalando…' : phase === 'pronta' ? 'Atualização baixada' : phase === 'baixando' ? 'Baixando a atualização' : `Nova versão ${status.version ?? ''}`}</h2>
      <p className="upd-sub">{phase === 'instalando' ? 'O PokéHub vai fechar, instalar e abrir sozinho na versão nova. Suas contas e logins continuam salvos.'
        : phase === 'pronta' ? 'Pronto para instalar. O PokéHub fecha, instala e abre de novo em alguns segundos.'
        : phase === 'baixando' ? 'Pode continuar jogando enquanto baixa.'
        : `Você está na ${current}. A ${status.version ?? 'nova versão'} já está disponível.`}</p>
      {phase === 'nova' || phase === 'erro' ? notes.length > 0 && <ul className="upd-notes">{notes.map((line, i) => <li key={i}>{line}</li>)}</ul> : null}
      {(phase === 'baixando' || phase === 'pronta' || phase === 'instalando') && <div className="upd-prog">
        <div className="upd-bar" role="progressbar" aria-label="Progresso do download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width: `${percent}%`}}/></div>
        <p><b>{percent}%</b>{status.total ? <span>{mb(status.transferred)} de {mb(status.total)} MB{status.bps ? ` · ${mb(status.bps)} MB/s` : ''}</span> : null}</p>
      </div>}
      {status.error && phase === 'erro' && <p className="upd-err" role="alert"><Icon d={icons.warn}/>{status.error} Confira a conexão e tente de novo.</p>}
      <div className="upd-btns">
        {phase === 'nova' || phase === 'erro' ? <><button onClick={onClose}>Depois</button><button className="primary" autoFocus onClick={onStart}><Icon d={icons.download}/>{phase === 'erro' ? 'Tentar de novo' : 'Atualizar agora'}</button></>
          : phase === 'pronta' ? <><button onClick={onClose}>Depois</button><button className="primary" autoFocus onClick={onInstall}><Icon d={icons.restart}/>Reiniciar e atualizar</button></>
          : phase === 'baixando' ? <button onClick={onClose}>Continuar em segundo plano</button> : null}
      </div>
    </div>
  </div>;
}
