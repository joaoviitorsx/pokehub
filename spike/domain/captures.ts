import { parsePtNumber } from './market';

/** Uma captura da lista "CAPTURAS" da sessão do jogo (painel esquerdo). Dados só de leitura. */
export interface Capture {
  profileId: string; name: string; level: number | null;
  time: string;                 // HH:MM, como o jogo mostra
  at: string;                   // ISO, derivado da data local em que foi vista pela 1ª vez
  potencia: number | null; iv: number | null; quality: number | null; nota: number | null;
  shiny: boolean; record: boolean; hints: string[];
}
/** Textos crus de uma linha (já limitados pelo processo principal). */
export interface RawCapture { name: string; nv: string; hora: string; pot: string; potCls: string; iv: string; q: string; n: string; badge: string; cls: string; txt: string }
export type AlertKind = 'shiny' | 'p5' | 'recorde' | 'nota';
export interface AlertRules { notaMin?: number | null }

const GENERIC = new Set(['capturas-linha', 'cap-card']);
const num = (value: string, max: number): number | null => {
  const m = /\d[\d.,]*/.exec(value), n = m ? parsePtNumber(m[0].replace(/[.,]+$/, '')) : null;
  return n !== null && n >= 0 && n <= max ? n : null;
};
/** "9:05" / "14:53" → "09:05" / "14:53"; fora da faixa → null. */
export function normalizeTime(value: string): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}
/** Data de "HH:MM" no dia local de `now`; se ficaria mais de 5 min no futuro, é de ontem (virada da meia-noite). */
export function resolveAt(time: string, now: Date): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (at.getTime() > now.getTime() + 5 * 60_000) at.setDate(at.getDate() - 1);
  return at.toISOString();
}
/** Linha crua → captura; sem nome ou sem hora válida, descarta (null). */
export function parseCapture(raw: RawCapture, profileId: string, now: Date): Capture | null {
  const name = raw.name.replace(/[✨★]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40), time = normalizeTime(raw.hora);
  if (!name || !time) return null;
  const lv = /\d{1,3}(?:\.\d{3})*|\d{1,6}/.exec(raw.nv), level = lv ? Number(lv[0].replace(/\./g, '')) : null;
  const pot = /P\s*([1-5])\b/i.exec(raw.pot) ?? /(?:^|\s)p([1-5])(?:\s|$)/i.exec(raw.potCls);
  const tokens = raw.cls.toLowerCase().split(/\s+/).filter(t => /^[\w-]{1,24}$/.test(t) && !GENERIC.has(t)).slice(0, 8);
  const badge = raw.badge.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 24);
  const hints = [...new Set(badge && /^[\p{L}\d -]+$/u.test(badge) ? [...tokens, badge] : tokens)];
  const body = `${raw.cls} ${raw.txt} ${raw.name}`;
  return {
    profileId, name, level: level !== null && level >= 1 ? level : null, time, at: resolveAt(time, now),
    potencia: pot ? Number(pot[1]) : null, iv: num(raw.iv, 1e4), quality: num(raw.q, 1e9), nota: num(raw.n, 1e9),
    shiny: /shiny|✨/i.test(body), record: /recorde/i.test(`${raw.cls} ${badge}`), hints,
  };
}
/** Chave de deduplicação: (conta, nome, nível, hora, P, IV, Q, nota). */
export const captureKey = (c: Capture): string => [c.profileId, c.name, c.level, c.time, c.potencia, c.iv, c.quality, c.nota].join('|');
/** Capturas de `current` que ainda não estão em `prev` (mantém a ordem; ignora repetidas dentro de `current`). */
export function diffNew(prev: readonly Capture[] | ReadonlySet<string>, current: readonly Capture[]): Capture[] {
  const seen = new Set<string>(Array.isArray(prev) ? (prev as readonly Capture[]).map(captureKey) : (prev as ReadonlySet<string>));
  return current.filter(c => { const key = captureKey(c); if (seen.has(key)) return false; seen.add(key); return true; });
}
/** Motivos de alerta: Shiny, P5, recorde e (opcional) nota mínima. */
export function alertsOf(c: Capture, rules: AlertRules = {}): AlertKind[] {
  const out: AlertKind[] = [];
  if (c.shiny) out.push('shiny');
  if (c.potencia === 5) out.push('p5');
  if (c.record) out.push('recorde');
  if (rules.notaMin != null && c.nota !== null && c.nota >= rules.notaMin) out.push('nota');
  return out;
}
export const ALERT_LABEL: Record<AlertKind, string> = {shiny: 'Shiny', p5: 'P5', recorde: 'Recorde', nota: 'Nota alta'};
export const alertText = (c: Capture, kinds: readonly AlertKind[]): string => `${kinds.map(k => ALERT_LABEL[k]).join(' · ')}: ${c.name}${c.level ? ` Nv ${c.level}` : ''}${c.potencia ? ` P${c.potencia}` : ''}${c.nota !== null ? ` · N ${c.nota}` : ''}`;
