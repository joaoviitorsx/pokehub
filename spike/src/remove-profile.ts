export async function removeProfileAndData(actions: {clear(): Promise<boolean>; remove(): Promise<boolean>}): Promise<'removed' | 'clear-failed' | 'remove-failed'> {
  try { if (!await actions.clear()) return 'clear-failed'; }
  catch { return 'clear-failed'; }
  try { return await actions.remove() ? 'removed' : 'remove-failed'; }
  catch { return 'remove-failed'; }
}
