// Lembretes de prazo: bônus ativos da conta (VIP, Boost/Boss da guild, bônus Twitch/Kick e o que mais o jogo listar em
// `#tr-ativos`) e quando avisar. Puro.

export interface Deadline {
  /** chave estável do tipo (vip, guild-boost, guild-boss, twitch, kick, ou o primeiro nome de classe) */
  tipo: string;
  /** rótulo curto que o jogo mostra (ex.: "+50% XP", "Boost Guild +10% XP") */
  nome: string;
  /** fim do bônus (epoch ms) */
  ate: number;
}
/** Quando avisar antes do fim: 24 h e 1 h. */
export const DEADLINE_STEPS = [{ms: 24 * 3_600_000, rotulo: '1 dia'}, {ms: 3_600_000, rotulo: '1 hora'}] as const;
const TIPOS: Record<string, string> = {vip:'VIP', 'guild-boost':'Boost da Guild', 'guild-boss':'Boss Raid da Guild', twitch:'Bônus Twitch', kick:'Bônus Kick'};
export const deadlineTitle = (d: Deadline) => TIPOS[d.tipo] ?? 'Bônus';

/** Script fixo (mundo isolado): lê só os bônus com prazo de `#tr-ativos`. Nada de clique ou rede. */
export const DEADLINE_SCRIPT = `(() => {
  const box = document.querySelector('#tr-ativos');
  if (!box) return null;
  return Array.from(box.querySelectorAll(':scope > .tr-ativo')).slice(0, 20).flatMap((b) => {
    const t = b.querySelector('[data-ate]');
    if (!t) return [];
    const cls = Array.from(b.classList).filter((c) => c !== 'tr-ativo');
    const tipo = ['vip', 'guild-boost', 'guild-boss', 'twitch', 'kick'].find((c) => cls.includes(c)) || cls[0] || 'bonus';
    const nome = (b.querySelector('.tr-ativo-nome') || b).textContent.replace(/\\s+/g, ' ').trim().slice(0, 60);
    return [{tipo: String(tipo).slice(0, 24), nome, ate: Number(t.getAttribute('data-ate'))}];
  });
})()`;
/** Valida o retorno da página: tipo simples, nome curto sem controles, fim plausível (até 2 anos à frente). */
export function sanitizeDeadlines(raw: unknown, now: number): Deadline[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    const tipo = typeof r.tipo === 'string' && /^[a-z0-9-]{2,24}$/.test(r.tipo) ? r.tipo : null;
    const nome = typeof r.nome === 'string' ? r.nome.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 60) : '';
    const ate = typeof r.ate === 'number' && Number.isFinite(r.ate) && r.ate > now - 86_400_000 && r.ate < now + 730 * 86_400_000 ? r.ate : null;
    return tipo && ate !== null ? [{tipo, nome, ate}] : [];
  });
}
/** Quais avisos cabem agora: o menor degrau já alcançado, um por bônus (chave inclui o fim, então renovar zera). */
export function dueReminders(items: readonly Deadline[], now: number, done: ReadonlySet<string>, conta: string): {key: string; d: Deadline; rotulo: string}[] {
  return items.flatMap(d => {
    const falta = d.ate - now;
    if (falta <= 0) return [];
    const step = [...DEADLINE_STEPS].reverse().find(s => falta <= s.ms); // 1 h antes de 1 dia
    if (!step) return [];
    const key = `${conta}|${d.tipo}|${d.ate}|${step.ms}`;
    return done.has(key) ? [] : [{key, d, rotulo: step.rotulo}];
  });
}
/** "17 dias", "3 d 4 h", "5 h 20", "12 min". */
export function restante(ate: number, now: number): string {
  const min = Math.max(0, Math.round((ate - now) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return d >= 3 ? `${d} dias` : `${d} d ${h % 24} h`;
}
export const urgencia = (ate: number, now: number): 'ok' | 'perto' | 'agora' => ate - now <= 3_600_000 ? 'agora' : ate - now <= 24 * 3_600_000 ? 'perto' : 'ok';
