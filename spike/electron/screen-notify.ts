// Avisos do PC para a tela remota (R5), sem Electron: texto da notificação e o agrupador de `remote:changed` (o hub dispara `onChange` em rajada).
export type ScreenNoticeKind = 'tela' | 'controle';
/** Texto da notificação nativa: o PC avisa SEMPRE que um celular começa a ver ou controlar, mesmo com a janela escondida. */
export function screenNotice(kind: ScreenNoticeKind, device: string, account: string): {title: string; body: string} {
  return kind === 'controle'
    ? {title: 'PokéHub — controle remoto', body: `Celular ${device} está CONTROLANDO ${account} — Ctrl+Shift+F12 encerra`}
    : {title: 'PokéHub — tela remota', body: `Celular ${device} está vendo ${account}`};
}
/** `notify()` quantas vezes quiser: a bandeja atualiza na hora (ela já agrupa) e o `remote:changed` da janela sai UMA vez, ~300 ms depois da última. */
export function createChangeNotifier(o: {send(): void; refresh(): void; ms?: number}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    notify() { try { o.refresh(); } catch { /* bandeja */ } clearTimeout(timer); timer = setTimeout(() => { timer = undefined; try { o.send(); } catch { /* janela fechada */ } }, o.ms ?? 300); },
    cancel() { clearTimeout(timer); timer = undefined; },
  };
}
