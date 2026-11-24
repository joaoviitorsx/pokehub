// Regras puras de "Quem colocar em campo?" e da tipagem do dia (nomes, cores e recomendação).
import type { PickMember, TeamMetric } from '../contracts/team';

/** As 18 tipagens do jogo (como o jogo as envia) em português, com a cor da etiqueta. */
export const TIPOS: Record<string, {nome: string; cor: string}> = {
  NORMAL:{nome:'Normal', cor:'#a8a77a'}, FIRE:{nome:'Fogo', cor:'#ee8130'}, WATER:{nome:'Água', cor:'#6390f0'}, ELECTRIC:{nome:'Elétrico', cor:'#e8c11c'},
  GRASS:{nome:'Planta', cor:'#7ac74c'}, ICE:{nome:'Gelo', cor:'#73cec6'}, FIGHTING:{nome:'Lutador', cor:'#c22e28'}, POISON:{nome:'Veneno', cor:'#a33ea1'},
  GROUND:{nome:'Terra', cor:'#d4b052'}, FLYING:{nome:'Voador', cor:'#8f7ee6'}, PSYCHIC:{nome:'Psíquico', cor:'#f95587'}, BUG:{nome:'Inseto', cor:'#94a51a'},
  ROCK:{nome:'Pedra', cor:'#b6a136'}, GHOST:{nome:'Fantasma', cor:'#735797'}, DRAGON:{nome:'Dragão', cor:'#6f35fc'}, DARK:{nome:'Sombrio', cor:'#705746'},
  STEEL:{nome:'Aço', cor:'#9a9ab8'}, FAIRY:{nome:'Fada', cor:'#d685ad'},
};
export const tipoNome = (tipo: string | null | undefined) => tipo ? TIPOS[tipo.toUpperCase()]?.nome ?? tipo : '';
export const tipoCor = (tipo: string | null | undefined) => tipo ? TIPOS[tipo.toUpperCase()]?.cor ?? '#c9a9b4' : '#c9a9b4';

export interface Recommendation {
  /** o melhor DA EQUIPE pela métrica: é o que dá para colocar em campo agora */
  melhor: PickMember | null;
  emCampo: PickMember | null;
  /** ganho relativo do melhor sobre o em campo (0,35 = +35%); null se não dá para comparar */
  ganho: number | null;
  /** o em campo já é o melhor da equipe (ou empata em até 3%) */
  manter: boolean;
  /** alguém da coleção (fora da equipe) superaria o melhor da equipe em mais de 3%: dica secundária */
  colecao: {membro: PickMember; ganho: number} | null;
  ordenados: PickMember[];
}
const valor = (m: PickMember, metric: TeamMetric) => m.melhor[metric]?.valor ?? 0;
/** Ordena pela métrica e decide: manter o em campo (empate até 3%) ou trocar. */
export function recommend(membros: readonly PickMember[], metric: TeamMetric): Recommendation {
  const ordenados = [...membros].sort((a, b) => valor(b, metric) - valor(a, metric) || Number(b.equipe) - Number(a.equipe) || Number(b.ativo) - Number(a.ativo) || b.nivel - a.nivel);
  const emCampo = membros.find(m => m.ativo) ?? null;
  const melhor = ordenados.find(m => m.equipe && valor(m, metric) > 0) ?? null;
  const base = emCampo ? valor(emCampo, metric) : 0;
  const top = melhor ? valor(melhor, metric) : 0;
  const ganho = emCampo && base > 0 && melhor ? top / base - 1 : null;
  const manter = Boolean(emCampo && melhor && (melhor === emCampo || (ganho !== null && ganho <= 0.03 + 1e-9)));
  const fora = ordenados.find(m => !m.equipe && valor(m, metric) > 0) ?? null;
  const ref = manter && emCampo ? base : top;
  const colecao = fora && ref > 0 && valor(fora, metric) / ref - 1 > 0.03 ? {membro: fora, ganho: valor(fora, metric) / ref - 1} : fora && ref === 0 ? {membro: fora, ganho: 0} : null;
  return {melhor, emCampo, ganho, manter, colecao, ordenados};
}
/** Tempo até a troca da tipagem (meia-noite de Brasília, `fim` vem do jogo). */
export function tempoAte(fim: number | null, now: number): string {
  if (!fim || fim <= now) return '';
  const min = Math.round((fim - now) / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
/** Texto da notificação da tipagem do dia; null quando a conta não tem ninguém do tipo (não avisa à toa). */
export function dayTypeNotice(tipo: string, conta: string, equipe: readonly string[], colecao: readonly string[]): {title: string; body: string} | null {
  if (!equipe.length && !colecao.length) return null;
  const lista = (nomes: readonly string[]) => nomes.slice(0, 3).join(', ') + (nomes.length > 3 ? ` e mais ${nomes.length - 3}` : '');
  const onde = equipe.length ? `Na equipe: ${lista(equipe)}.` : `Na coleção: ${lista(colecao)} (coloque na equipe para usar).`;
  return {title:`Tipagem do dia: ${tipoNome(tipo)} 2×`, body:`${conta} · ${onde} Ataque, defesa e vida dobram nas hunts até a meia-noite.`};
}
