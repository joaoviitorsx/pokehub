interface ClosableContents {
  isDestroyed(): boolean;
  close(): void;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}
export function closeContents(contents: ClosableContents, timeoutMs = 5000): Promise<void> {
  if (contents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); contents.removeListener('destroyed', done); };
    const done = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('Tempo esgotado ao encerrar sessão')); } }, timeoutMs);
    contents.once('destroyed', done);
    try { contents.close(); if (contents.isDestroyed()) done(); }
    catch (error) { if (!settled) { settled = true; cleanup(); reject(error); } }
  });
}
