interface ShortcutInput {
  type: string; key: string; control: boolean; alt: boolean; shift: boolean; meta: boolean; isAutoRepeat: boolean; isComposing: boolean;
}
export function shortcutIndex(input: ShortcutInput): number | undefined {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.shift || input.meta || input.isAutoRepeat || input.isComposing || !/^[0-4]$/.test(input.key)) return undefined;
  return Number(input.key);
}
export function shortcutFocus(input: ShortcutInput, profileIds: readonly string[]): string | null | undefined {
  const index = shortcutIndex(input);
  if (index === undefined) return undefined;
  return index === 0 ? null : profileIds[index - 1];
}
/** Ctrl+H alterna a lateral "Onde caçar?". */
export function isSideShortcut(input: ShortcutInput): boolean {
  return input.type === 'keyDown' && input.control && !input.alt && !input.shift && !input.meta && !input.isAutoRepeat && !input.isComposing && input.key.toLowerCase() === 'h';
}
