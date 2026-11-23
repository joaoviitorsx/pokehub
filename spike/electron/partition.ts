import { isProfileId } from '../domain/profiles';

export function partitionFor(id: string): string {
  if (!isProfileId(id)) throw new Error('Identificador de perfil inválido');
  return `persist:pokehub-${id}`;
}
