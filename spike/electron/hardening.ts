import { chmodSync } from 'node:fs';

// Chaves (sem "--") das chaves de linha de comando que abrem o processo principal ou o renderer a depuração remota.
export const DANGEROUS_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-port'] as const;

/** Devolve as chaves perigosas presentes. `has` costuma ser `app.commandLine.hasSwitch`. Função pura: não depende do Electron. */
export function dangerousSwitches(has: (name: string) => boolean): string[] {
  return DANGEROUS_SWITCHES.filter(name => has(name));
}

/** No Linux a pasta de dados fica só para o dono (0700): cookies das contas e o banco não ficam legíveis a outros usuários. Erros são ignorados. */
export function restrictUserData(directory: string, platform: string = process.platform, chmod: (path: string, mode: number) => void = chmodSync): void {
  if (platform !== 'linux') return;
  try { chmod(directory, 0o700); } catch { /* melhor esforço */ }
}
