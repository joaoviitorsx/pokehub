import type { ProfileInput } from '../domain/profiles';
export function profileFormChanged(initial: ProfileInput, current: ProfileInput): boolean {
  return initial.label !== current.label || initial.emailLabel !== current.emailLabel || initial.characterName !== current.characterName || initial.colorToken !== current.colorToken;
}
