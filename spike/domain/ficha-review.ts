// "Esse Pokémon é bom para caçar?" — avaliação pura a partir do que a ficha do jogo (#ficha) mostra. Sem imports nem constantes
// de fora: `avaliarFicha` é serializada (toString) e roda dentro da página, por isso tudo o que usa fica dentro dela.

export type StatKey = 'hp' | 'atk' | 'def' | 'spAtk' | 'spDef' | 'spd';
export type Stats = Record<StatKey, number | null>;
/** O que a ficha mostra: nota 0–10, qualidade 0,8–1,8, potência P1–P5, IV de cada stat (1–32) e stats-base da espécie. */
export interface FichaDados { nota: number | null; quality: number | null; potencia: number | null; ivs: Stats; base: Stats; /** pontos de refino já aplicados em cada stat-base (0 = nenhum) */ refino?: Stats }
export type Perfil = 'fisico' | 'especial' | 'misto';
export type Faixa = 'otimo' | 'bom' | 'medio' | 'fraco';
export interface Motivo { texto: string; tom: 'bom' | 'ruim' | 'neutro' }
export interface Avaliacao {
  score: number; faixa: Faixa; titulo: string; perfil: Perfil; chave: StatKey[];
  subtitulo: string; motivos: Motivo[]; ivs: {k: StatKey; rotulo: string; iv: number | null; chave: boolean; tom: 'bom' | 'ruim' | 'neutro'}[];
  /** Ordem sugerida de refino (stats-base com pedras) para caçar; SPD não refina no jogo. `aviso`: refino já gasto onde quase não ajuda. */
  refino: {ordem: StatKey[]; texto: string; aviso: string | null};
}

/**
 * Pesos para hunt (PvE): o ataque que os golpes usam domina; IV de SPD encurta a recarga (até 7%, e vale mais em espécie rápida);
 * qualidade multiplica todos os stats; potência soma poder (+5% a +100%); HP e defesas seguram as hunts difíceis.
 * Perfil pelos stats-base da espécie: ATK ≥ 15% acima de SP.ATK = físico, o contrário = especial, senão misto.
 */
export function avaliarFicha(d: FichaDados): Avaliacao {
  const ROT: Record<StatKey, string> = {hp:'HP', atk:'ATK', def:'DEF', spAtk:'SP.ATK', spDef:'SP.DEF', spd:'SPD'};
  const ORDEM: StatKey[] = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd'];
  const n = (iv: number | null) => iv === null ? null : Math.min(1, Math.max(0, (iv - 1) / 31));
  const fmt3 = (x: number) => x.toLocaleString('pt-BR', {minimumFractionDigits:3, maximumFractionDigits:3});
  const bA = d.base.atk, bS = d.base.spAtk;
  const perfil: Perfil = bA !== null && bS !== null && bA > 0 && bS > 0 ? (bA >= bS * 1.15 ? 'fisico' : bS >= bA * 1.15 ? 'especial' : 'misto') : 'misto';
  const chave: StatKey[] = perfil === 'fisico' ? ['atk'] : perfil === 'especial' ? ['spAtk'] : ['atk', 'spAtk'];
  // ataque efetivo: no misto, a média ponderada pelos stats-base
  let ataque: number | null;
  if (perfil === 'misto') {
    const a = n(d.ivs.atk), s = n(d.ivs.spAtk), wa = bA ?? 1, ws = bS ?? 1;
    ataque = a !== null && s !== null ? (a * wa + s * ws) / (wa + ws) : a ?? s;
  } else ataque = n(d.ivs[chave[0]!]);
  const fSpd = d.base.spd !== null ? Math.min(1.3, Math.max(0.5, d.base.spd / 100)) : 1;
  const defs = [n(d.ivs.def), n(d.ivs.spDef)].filter((x): x is number => x !== null);
  const pot = d.potencia !== null ? ([0, 0, 0.15, 0.3, 0.6, 1][Math.round(d.potencia)] ?? null) : null;
  const q = d.quality !== null ? Math.min(1, Math.max(0, (d.quality - 0.8) / 1.0)) : null;
  const partes: [number, number | null][] = [[0.36, ataque], [0.16 * fSpd, n(d.ivs.spd)], [0.11, n(d.ivs.hp)], [0.09, defs.length ? defs.reduce((s, x) => s + x, 0) / defs.length : null], [0.18, q], [0.10, pot]];
  const usadas = partes.filter((p): p is [number, number] => p[1] !== null);
  const peso = usadas.reduce((s, [w]) => s + w, 0);
  const score = peso > 0 ? Math.round(usadas.reduce((s, [w, x]) => s + w * x, 0) / peso * 100) : 0;
  const faixa: Faixa = score >= 75 ? 'otimo' : score >= 58 ? 'bom' : score >= 40 ? 'medio' : 'fraco';
  const notaAlta = d.nota !== null && d.nota >= 6;
  const ataqueFraco = ataque !== null && ataque < 0.35;
  const titulo = notaAlta && ataqueFraco ? 'Nota alta, mas fraco no ataque' : faixa === 'otimo' ? 'Ótimo para caçar' : faixa === 'bom' ? 'Bom para caçar' : faixa === 'medio' ? 'Mediano para caçar' : 'Fraco para caçar';
  const nomePerfil = perfil === 'fisico' ? 'físico' : perfil === 'especial' ? 'especial' : 'misto';
  const subtitulo = `Perfil ${nomePerfil}${bA !== null && bS !== null ? ` (base ATK ${bA} · SP.ATK ${bS})` : ''}`;

  const motivos: Motivo[] = [];
  const iv = (k: StatKey) => d.ivs[k];
  if (perfil === 'misto' && iv('atk') !== null && iv('spAtk') !== null) {
    const a = iv('atk')!, s = iv('spAtk')!;
    if (Math.min(a, s) <= 10) motivos.push({tom:'ruim', texto:`Golpes físicos e especiais: ${a <= s ? 'ATK' : 'SP.ATK'} ${Math.min(a, s)}/32 enfraquece parte do dano.`});
    else if (Math.min(a, s) >= 26) motivos.push({tom:'bom', texto:`ATK ${a} e SP.ATK ${s}: bom dano com golpes físicos e especiais.`});
  } else if (perfil !== 'misto') {
    const k = chave[0]!, v = iv(k);
    if (v !== null && v <= 12) motivos.push({tom:'ruim', texto:`${ROT[k]} ${v}/32 é o ataque principal dele: menos dano nas hunts.`});
    else if (v !== null && v >= 27) motivos.push({tom:'bom', texto:`${ROT[k]} ${v}/32 no ataque principal: ótimo dano.`});
  }
  const spd = iv('spd');
  if (spd !== null && spd <= 10) motivos.push({tom:'ruim', texto:`SPD ${spd}/32: golpes recarregam mais devagar.`});
  else if (spd !== null && spd >= 27) motivos.push({tom:'bom', texto:`SPD ${spd}/32: golpes recarregam mais rápido.`});
  if (d.quality !== null && d.quality >= 1.5) motivos.push({tom:'bom', texto:`Qualidade ${fmt3(d.quality)} multiplica todos os stats.`});
  else if (d.quality !== null && d.quality < 1.0) motivos.push({tom:'ruim', texto:`Qualidade ${fmt3(d.quality)} puxa todos os stats para baixo.`});
  if (d.potencia !== null && d.potencia >= 4) motivos.push({tom:'bom', texto:`P${d.potencia}: ${d.potencia >= 5 ? '+100%' : '+25%'} de poder.`});
  const outro: StatKey | null = perfil === 'fisico' ? 'spAtk' : perfil === 'especial' ? 'atk' : null;
  if (outro && (iv(outro) ?? 0) >= 26 && (ataque ?? 1) < 0.6) motivos.push({tom:'neutro', texto:`${ROT[outro]} alto quase não ajuda: os golpes dele são ${perfil === 'fisico' ? 'físicos' : 'especiais'}.`});
  const hp = iv('hp');
  if (hp !== null && hp <= 8) motivos.push({tom:'ruim', texto:`HP ${hp}/32: aguenta menos nas hunts difíceis.`});
  if (!motivos.length) motivos.push({tom:'neutro', texto:'IVs sem ponto forte nem fraco no que importa para caçar.'});
  // primeiro o que mais pesa (ruim antes de bom no mesmo nível), no máximo 3
  const ordenados = motivos.slice(0, 6).sort((a, b) => (a.tom === 'ruim' ? 0 : a.tom === 'bom' ? 1 : 2) - (b.tom === 'ruim' ? 0 : b.tom === 'bom' ? 1 : 2)).slice(0, 3);
  // Refino: o ataque que ele usa primeiro (no misto, o de maior base), depois HP e as defesas. SPD não refina.
  const ataques: StatKey[] = perfil === 'fisico' ? ['atk'] : perfil === 'especial' ? ['spAtk'] : ((bA ?? 0) >= (bS ?? 0) ? ['atk', 'spAtk'] : ['spAtk', 'atk']);
  const ordemRefino: StatKey[] = [...ataques, 'hp', ...(perfil === 'especial' ? ['spDef', 'def'] as StatKey[] : ['def', 'spDef'] as StatKey[])];
  const textoRefino = perfil === 'misto' ? `Refino: ${ROT[ataques[0]!]} e ${ROT[ataques[1]!]} (golpes mistos), depois HP.` : `Refino: ${ROT[ataques[0]!]} primeiro, depois HP.`;
  const gasto = outro && d.refino ? d.refino[outro] : null;
  const avisoRefino = outro && gasto !== null && gasto !== undefined && gasto > 0 ? `${ROT[outro]} já tem +${gasto} de refino, que quase não ajuda nas hunts (golpes ${perfil === 'fisico' ? 'físicos' : 'especiais'}).` : null;
  return {
    score, faixa, titulo, perfil, chave, subtitulo, motivos: ordenados, refino: {ordem: ordemRefino, texto: textoRefino, aviso: avisoRefino},
    ivs: ORDEM.map(k => { const v = d.ivs[k]; return {k, rotulo: ROT[k], iv: v, chave: chave.includes(k) || k === 'spd', tom: v === null ? 'neutro' : v >= 27 ? 'bom' : v <= 10 ? 'ruim' : 'neutro'}; }),
  };
}

const CSS = `
.ph-ana{position:relative}
.ph-ana .fi-cartao-tit{display:flex;align-items:center;gap:6px}
.ph-ana-marca{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.4px;opacity:.7;text-transform:none}
.ph-ana-top{display:flex;align-items:center;gap:10px;margin:2px 0 8px}
.ph-ana-num{flex:none;min-width:52px;padding:2px 8px;border-radius:7px;text-align:center;font:800 22px/1.25 Tahoma,Verdana,sans-serif;color:#fff6ef;background:#231520;box-shadow:inset 0 0 0 2px #480e1e,0 2px 0 #0005;text-shadow:0 2px 0 #480e1e}
.ph-ana[data-faixa=otimo] .ph-ana-num{color:#8ff0a8}.ph-ana[data-faixa=bom] .ph-ana-num{color:#c8f08f}
.ph-ana[data-faixa=medio] .ph-ana-num{color:#ffe07a}.ph-ana[data-faixa=fraco] .ph-ana-num{color:#ff9a8c}
.ph-ana-top strong{display:block;font:800 15px/1.2 Tahoma,Verdana,sans-serif}
.ph-ana-top small{display:block;margin-top:2px;font-size:11px;opacity:.8}
.ph-ana-mot{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px}
.ph-ana-mot li{position:relative;padding-left:16px;font-size:12px;line-height:1.35}
.ph-ana-mot li::before{content:'';position:absolute;left:3px;top:5px;width:7px;height:7px;border-radius:50%;background:#c9a9b4}
.ph-ana-mot li[data-tom=bom]::before{background:#6fd08a}.ph-ana-mot li[data-tom=ruim]::before{background:#e0604f}
.ph-ana-ivs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.ph-ana-iv{display:grid;gap:3px;padding:4px 5px;border-radius:5px;background:#0003;box-shadow:inset 0 0 0 1px #480e1e;font-size:10px;font-weight:700;text-align:center}
.ph-ana-iv[data-chave]{box-shadow:inset 0 0 0 2px #fccb0f}
.ph-ana-iv i{display:block;height:5px;border-radius:3px;background:#231520;overflow:hidden}
.ph-ana-iv i b{display:block;height:100%;border-radius:3px;background:#f0c24a}
.ph-ana-iv[data-tom=bom] i b{background:#6fd08a}.ph-ana-iv[data-tom=ruim] i b{background:#e0604f}
.ph-ana-iv span{opacity:.85}
.ph-ana-ref{margin:8px 0 0;padding:6px 8px;border-radius:5px;background:#0003;box-shadow:inset 0 0 0 1px #480e1e;font-size:11px;line-height:1.4}
.ph-ana-ref b{font-weight:800}.ph-ana-ref-aviso{color:#ffb4a8}
.ph-ana.ph-compacto .ph-ana-mot li:nth-child(n+2),.ph-ana.ph-compacto .ph-ana-ivs,.ph-ana.ph-compacto .ph-ana-ref,.ph-ana.ph-compacto .ph-ana-top small{display:none}
.ph-ana.ph-compacto .ph-ana-top{margin-bottom:4px}
.ph-ana.ph-compacto .ph-ana-num{font-size:17px;min-width:42px}`;

/**
 * Script do mundo isolado: lê a ficha aberta (somente texto/números do DOM), avalia e mostra um cartão "Para caçar" logo depois do
 * topo da ficha (ou depois do quadro da Smart Market, compacto). Um MutationObserver refaz ao trocar de Pokémon. Não clica (os
 * botões "+1" de refino gastam pedras e nunca são tocados), não lê campos, não faz rede. `enabled=false` remove tudo.
 */
export const FICHA_VERSION = 2; // subir ao mudar o script: a página troca o observador antigo pelo novo
/** Já instalado nesta página (mesma versão, observando a ficha atual)? Barato: roda a cada ciclo. */
export const FICHA_PROBE = `(() => { const s = window.__phFicha; const f = document.querySelector('#ficha'); return Boolean(s && s.versao === ${FICHA_VERSION} && s.obs && f && s.alvo === f); })()`;
export function fichaScript(enabled: boolean): string {
  const config = JSON.stringify({enabled, css:CSS, versao:FICHA_VERSION});
  return `(() => {
  const C = ${config};
  const avaliar = ${avaliarFicha.toString()};
  const st = window.__phFicha || (window.__phFicha = {obs:null, alvo:null, sig:'', t:0, versao:0});
  const limpar = () => { document.querySelectorAll('.ph-ana').forEach((e) => e.remove()); const css = document.getElementById('ph-ana-css'); if (css) css.remove(); st.sig = ''; };
  if (!C.enabled) { if (st.obs) st.obs.disconnect(); st.obs = null; st.alvo = null; st.versao = 0; limpar(); return 'off'; }
  const trocou = st.versao !== C.versao; st.versao = C.versao; if (trocou) st.sig = '';
  if (!document.getElementById('ph-ana-css')) { const s = document.createElement('style'); s.id = 'ph-ana-css'; s.textContent = C.css; (document.head || document.documentElement).appendChild(s); }
  const num = (t) => { if (t == null) return null; const m = String(t).replace(/\\s+/g, '').match(/-?\\d[\\d.,]*/); if (!m) return null; let s = m[0]; if (s.includes(',')) s = s.replace(/\\./g, '').replace(',', '.'); else if (/^\\d{1,3}(\\.\\d{3})+$/.test(s)) s = s.replace(/\\./g, ''); const v = Number(s); return Number.isFinite(v) ? v : null; };
  const CHAVES = {'HP':'hp','ATK':'atk','DEF':'def','SP.ATK':'spAtk','SP.DEF':'spDef','SPD':'spd'};
  const vazio = () => ({hp:null, atk:null, def:null, spAtk:null, spDef:null, spd:null});
  const ler = (ficha) => {
    const ivs = vazio(), base = vazio();
    ficha.querySelectorAll('.fi-stats:not(.fi-stats-refino) > .fi-stat').forEach((r) => { const k = CHAVES[(r.querySelector('.fi-stat-nome')?.textContent || '').trim().toUpperCase()]; const e = r.querySelector('.fi-iv'); if (k && e) { const v = num(e.textContent); ivs[k] = v !== null && v >= 1 && v <= 32 ? v : null; } });
    const refino = vazio();
    ficha.querySelectorAll('.fi-stats-refino > .fi-stat').forEach((r) => { const k = CHAVES[(r.querySelector('.fi-stat-nome')?.textContent || '').trim().toUpperCase()]; const v = num(r.querySelector('.fi-stat-num')?.textContent); if (k && v !== null && v > 0 && v < 1000) base[k] = v; const m = r.querySelector('.fi-refino-mais'); if (k && m) { const p = num(m.textContent); refino[k] = p !== null && p >= 0 && p < 10000 ? p : 0; } });
    const notaEl = ficha.querySelector('[data-nota]'); const nota = notaEl ? num(notaEl.getAttribute('data-nota').replace('.', ',')) : null;
    const placa = (sel) => { const b = ficha.querySelector(sel + ' b'); return b ? b.textContent : null; };
    const pot = num(placa('.pk-selo-pot')); const q = num(placa('.pk-selo-q'));
    return {nota: nota !== null && nota >= 0 && nota <= 10 ? nota : null, quality: q !== null && q >= 0.5 && q <= 3 ? q : null, potencia: pot !== null && pot >= 1 && pot <= 5 ? pot : null, ivs, base, refino};
  };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const desenhar = () => {
    const ficha = document.querySelector('#ficha');
    if (!ficha || !ficha.getClientRects().length) return;
    const heroi = ficha.querySelector('.fi-heroi'); if (!heroi) return;
    const d = ler(ficha);
    if (Object.values(d.ivs).every((v) => v === null)) { ficha.querySelectorAll('.ph-ana').forEach((e) => e.remove()); st.sig = ''; return; }
    const sm = ficha.querySelector('.pp-badge');
    const ancora = sm && sm.parentElement === heroi.parentElement ? sm : heroi;
    const sig = JSON.stringify([d, Boolean(sm)]);
    const atual = ficha.querySelector('.ph-ana');
    if (atual && st.sig === sig && atual.previousElementSibling === ancora) return;
    st.sig = sig;
    const a = avaliar(d);
    const card = el('section', 'fi-cartao ph-ana' + (sm ? ' ph-compacto' : ''));
    card.dataset.faixa = a.faixa;
    card.setAttribute('aria-label', 'Avaliação do PokéHub para caçar: ' + a.score + ' de 100, ' + a.titulo);
    const tit = el('h3', 'fi-cartao-tit', 'Para caçar'); tit.appendChild(el('span', 'ph-ana-marca', 'PokéHub')); card.appendChild(tit);
    const top = el('div', 'ph-ana-top'); top.appendChild(el('b', 'ph-ana-num', String(a.score)));
    const tx = el('div'); tx.appendChild(el('strong', '', a.titulo)); tx.appendChild(el('small', '', a.subtitulo + ' · nota de 0 a 100')); top.appendChild(tx); card.appendChild(top);
    const ul = el('ul', 'ph-ana-mot'); a.motivos.forEach((m) => { const li = el('li', '', m.texto); li.dataset.tom = m.tom; ul.appendChild(li); }); card.appendChild(ul);
    const grade = el('div', 'ph-ana-ivs');
    a.ivs.forEach((x) => { const c = el('div', 'ph-ana-iv'); c.dataset.tom = x.tom; if (x.chave) c.dataset.chave = ''; c.title = x.rotulo + (x.chave ? ' (pesa para caçar)' : '') + ': IV ' + (x.iv == null ? '?' : x.iv) + '/32'; c.appendChild(el('span', '', x.rotulo)); const bar = el('i'); const fill = el('b'); fill.style.width = (x.iv == null ? 0 : Math.round(x.iv / 32 * 100)) + '%'; bar.appendChild(fill); c.appendChild(bar); c.appendChild(el('span', '', x.iv == null ? '—' : String(x.iv))); grade.appendChild(c); });
    card.appendChild(grade);
    const ref = el('p', 'ph-ana-ref'); ref.appendChild(el('b', '', a.refino.texto)); if (a.refino.aviso) ref.appendChild(el('span', 'ph-ana-ref-aviso', ' ' + a.refino.aviso)); card.appendChild(ref);
    if (atual) atual.remove();
    ancora.after(card);
  };
  const agendar = () => { clearTimeout(st.t); st.t = setTimeout(desenhar, 80); };
  const ficha = document.querySelector('#ficha');
  if (ficha && (st.alvo !== ficha || trocou)) {
    if (st.obs) st.obs.disconnect();
    st.alvo = ficha;
    const nosso = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return Boolean(e && (e.classList.contains('ph-ana') || (e.closest && e.closest('.ph-ana')))); };
    st.obs = new MutationObserver((ms) => { if (ms.every((m) => nosso(m.target) || (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(nosso)))) return; agendar(); });
    st.obs.observe(ficha, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class', 'hidden', 'data-nota']});
  }
  desenhar();
  return ficha ? 'on' : 'sem-ficha';
})()`;
}
