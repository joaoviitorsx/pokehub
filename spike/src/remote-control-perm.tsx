// "Pode controlar a tela" (R5): permissão SEPARADA do "pode agir". Controlar = controle total da conta (sem teto, Market, venda/troca), por isso só se liga aqui, no PC,
// depois de uma confirmação nativa do sistema. Componente pequeno e isolado: a seção de acesso remoto só o insere na lista de aparelhos.
import type { RemoteDevice } from '../contracts/remote';

type Result<T> = {ok: true; data: T} | {ok: false; error: string};
interface Client { setCanControl(id: string, value: boolean): Promise<Result<RemoteDevice[]>> }
const client = () => (window.pokehub as unknown as {remote: Client}).remote;

export const controlPermLabel = (device: Pick<RemoteDevice, 'canControl'>): string => `Pode controlar a tela: ${device.canControl ? 'sim' : 'não'} (controle total da conta: sem teto de gastos, com Market, venda e troca; sempre com PIN)`;
export function RemoteControlPerm({device, busy, run}: {device: RemoteDevice; busy: boolean; run: (action: () => Promise<Result<unknown>>) => Promise<unknown>}) {
  return <label className="switch" data-perm="control"><span>{controlPermLabel(device)}</span>
    <input type="checkbox" role="switch" checked={device.canControl === true} disabled={busy} onChange={event => void run(() => client().setCanControl(device.id, event.target.checked))}/></label>;
}
