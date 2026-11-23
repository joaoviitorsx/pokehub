// Nome amigável do aparelho a partir do User-Agent (usado no celular e como reserva no servidor). Puro, sem Node nem DOM.
/** Remove controles, formatação invisível (bidi etc.) e espaços repetidos; no máximo 40 caracteres. */
export const sanitizeName = (value: unknown): string => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
export function deviceNameFromUA(ua: string | undefined | null): string {
  const text = (ua ?? '').slice(0, 400);
  const os = /iPhone/i.test(text) ? 'iPhone' : /iPad/i.test(text) ? 'iPad' : /Android/i.test(text) ? (/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/i.exec(text)?.[1] ?? 'Android') : /Windows/i.test(text) ? 'Windows' : /Mac OS X|Macintosh/i.test(text) ? 'Mac' : /Linux/i.test(text) ? 'Linux' : 'Celular';
  const browser = /Edg(?:e|A|iOS)?\//i.test(text) ? 'Edge' : /OPR\/|Opera/i.test(text) ? 'Opera' : /SamsungBrowser/i.test(text) ? 'Samsung Internet' : /Firefox|FxiOS/i.test(text) ? 'Firefox' : /Chrome|CriOS/i.test(text) ? 'Chrome' : /Safari/i.test(text) ? 'Safari' : '';
  return sanitizeName(browser ? `${os} · ${browser}` : os) || 'Celular';
}
