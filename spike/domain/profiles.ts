export interface ProfileInput { label: string; emailLabel: string; characterName: string; colorToken: string }
export interface Profile extends ProfileInput { id: string; createdAt: string; updatedAt: string }
export class ProfileLimitError extends Error {}
export function isProfileId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
function validate(input: ProfileInput): ProfileInput {
  const {label,emailLabel,characterName,colorToken} = input;
  if (typeof label !== 'string' || typeof emailLabel !== 'string' || typeof characterName !== 'string' || typeof colorToken !== 'string') throw new Error('Dados inválidos');
  const clean = {label:label.trim(),emailLabel:emailLabel.trim(),characterName:characterName.trim(),colorToken};
  if (!clean.label || clean.label.length > 80 || clean.characterName.length > 80 || clean.emailLabel.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.emailLabel) || !/^#[0-9a-f]{6}$/i.test(colorToken)) throw new Error('Dados inválidos');
  return clean;
}
export function createProfile(existing: readonly Profile[], input: ProfileInput, id: string, now: string): Profile {
  if (existing.length >= 4 || !isProfileId(id) || existing.some(profile => profile.id === id)) throw new Error('Não foi possível criar o perfil');
  return {...validate(input),id,createdAt:now,updatedAt:now};
}
export function updateProfile(profile: Profile, input: ProfileInput, now: string): Profile {
  return {...profile,...validate(input),updatedAt:now};
}
