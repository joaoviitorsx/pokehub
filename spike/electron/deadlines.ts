/*
 * Lembretes de prazo: a cada 5 min (10 min no Modo leve) lê os bônus ativos de cada conta pronta (`#tr-ativos`, script fixo no
 * mundo isolado) e avisa 1 dia e 1 hora antes do fim. Cada aviso sai uma vez (lembrado em `prazos-avisados.json`, chave com o fim:
 * renovar o bônus zera). A interface recebe a lista atual de cada conta para mostrar a contagem regressiva.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEADLINE_SCRIPT, dueReminders, sanitizeDeadlines, type Deadline } from '../domain/deadlines';
import type { MarketTarget } from './market-scan';
import { atGame, timed } from './hunt-snapshot';

export const DEADLINE_INTERVAL_MS = 5 * 60_000, DEADLINE_LITE_INTERVAL_MS = 10 * 60_000;
export interface DeadlineDeps {
  known: () => {id: string; label: string}[];
  target: (id: string) => MarketTarget | null;
  enabled: () => boolean;
  lite: () => boolean;
  file: string;
  notify: (title: string, body: string) => void;
  emit: (all: Record<string, Deadline[]>) => void;
}
export function createDeadlines(deps: DeadlineDeps) {
  const current: Record<string, Deadline[]> = {};
  let done = new Set<string>();
  try { const list: unknown = JSON.parse(readFileSync(deps.file, 'utf8')); if (Array.isArray(list)) done = new Set(list.filter((k): k is string => typeof k === 'string').slice(-500)); } catch { /* primeira vez */ }
  const save = () => { try { writeFileSync(deps.file, JSON.stringify([...done].slice(-500))); } catch { /* só não lembra entre reinícios */ } };
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, stopped = false, lastSig = '', savedSig = [...done].join(',');
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const now = Date.now();
      const contas = deps.known();
      for (const id of Object.keys(current)) if (!contas.some(c => c.id === id)) delete current[id];
      for (const conta of contas) {
        if (stopped) return;
        const target = deps.target(conta.id);
        if (!target || !atGame(target.url)) continue;
        const items = sanitizeDeadlines(await timed(target.run(DEADLINE_SCRIPT), 4_000).catch(() => null), now);
        if (!items) continue;
        current[conta.id] = items;
        if (!deps.enabled()) continue;
        for (const r of dueReminders(items, now, done, conta.id)) {
          done.add(r.key);
          const fim = new Date(r.d.ate).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
          deps.notify(`Prazo · ${conta.label}`, `${r.d.nome || 'Bônus'} acaba em ${r.rotulo} (${fim}). Renove se quiser manter.`);
        }
      }
      // limpa chaves de bônus que já acabaram há mais de 2 dias
      const kept = new Set([...done].filter(k => Number(k.split('|')[2]) > now - 2 * 86_400_000));
      const doneSig = [...kept].join(',');
      if (doneSig !== savedSig) { done = kept; savedSig = doneSig; save(); }
      const sig = JSON.stringify(current);
      if (sig !== lastSig) { lastSig = sig; deps.emit({...current}); }
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(), deps.lite() ? DEADLINE_LITE_INTERVAL_MS : DEADLINE_INTERVAL_MS);
    }
  }
  return {
    start() { stopped = false; clearTimeout(timer); timer = setTimeout(() => void tick(), 30_000); },
    refresh() { clearTimeout(timer); void tick(); },
    stop() { stopped = true; clearTimeout(timer); },
    all: () => ({...current}),
  };
}
