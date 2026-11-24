import { useEffect, useState } from 'react';
import { deadlineTitle, restante, urgencia, type Deadline } from '../domain/deadlines';
import { Icon, icons } from './icons';

/** Bônus ativos da conta escolhida com a contagem regressiva (o aviso no sistema sai 1 dia e 1 hora antes). */
export function DeadlinesStrip({id, active}: {id: string | undefined; active: boolean}) {
  const [all, setAll] = useState<Record<string, Deadline[]>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    void window.pokehub.deadlines.get().then(result => { if (alive && result.ok) setAll(result.data); }).catch(() => undefined);
    const off = window.pokehub.deadlines.onChanged(next => setAll(next));
    return () => { alive = false; off(); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000); // contagem em minutos: um render por minuto, só com a aba à vista
    return () => clearInterval(timer);
  }, [active]);
  const items = (id ? all[id] ?? [] : []).filter(d => d.ate > now).sort((a, b) => a.ate - b.ate);
  if (!active || !items.length) return null;
  const urgente = items.some(d => urgencia(d.ate, now) !== 'ok');
  return <section className="dl" aria-label="Prazos dos bônus" data-urgente={urgente || undefined}>
    <h3><Icon d={icons.stopwatch}/>Prazos dos bônus</h3>
    <ul>{items.map(d => <li key={`${d.tipo}-${d.ate}`} data-u={urgencia(d.ate, now)} title={`${deadlineTitle(d)} · ${d.nome} · até ${new Date(d.ate).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}`}>
      <span className="dl-nome"><b>{deadlineTitle(d)}</b><small>{d.nome}</small></span>
      <span className="dl-t">{restante(d.ate, now)}</span>
    </li>)}</ul>
  </section>;
}
