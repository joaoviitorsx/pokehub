import { isProfileId } from '../domain/profiles';

export function partitionFor(id: string): string {
  if (!isProfileId(id)) throw new Error('Identificador de perfil inválido');
  return `persist:pokehub-${id}`;
}
/** Sessão da Twitch do perfil: separada da sessão do jogo (cookies, armazenamento e rede próprios). */
export function twitchPartitionFor(id: string): string {
  if (!isProfileId(id)) throw new Error('Identificador de perfil inválido');
  return `persist:pokehubtw-${id}`;
}
