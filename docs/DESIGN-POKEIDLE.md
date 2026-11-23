# Tema visual “madeira” — alinhado ao PokeIdle

Objetivo: o PokéHub deixa de parecer um app genérico (cinza-azulado, pílulas, sombras suaves) e passa a parecer uma peça do próprio jogo. Linguagem levantada da tela pública `https://pokeidle.io/app` em 2026-11-23 (estilos computados, só valores de cor/forma). **Não** copiamos arte, sprites, logo ou arquivos do jogo; só a linguagem (paleta, chanfros, tipografia de sistema).

## Tokens (mesmos nomes do jogo, prefixo `--pi-` para não colidir)

| Token | Valor | Uso |
|---|---|---|
| `--pi-mad` | `#bd6951` | Corpo da “madeira” (painéis, barra superior) |
| `--pi-mad-esc` | `#914850` | Faixa superior do painel (8–12 px) |
| `--pi-mad-quente` | `#df824c` | Faixa inferior do painel |
| `--pi-mad-base` | `#722c3f` | Degrau/sombra sólida abaixo de painéis e botões |
| `--pi-mad-linha` | `#480e1e` | Contorno de tudo (2 px inset) |
| `--pi-mad-luz` | `#f1d3b7` | Filete claro interno do painel (anel 4 px) |
| `--pi-mad-luz2` | `#e7a86d` | Brilho de 1 px sob cavidades |
| `--pi-vao` / `--pi-vao2` / `--pi-vao-luz` | `#33202b` / `#462b39` / `#5c3948` | “Vão”: campos, listas, áreas rebaixadas, hover |
| `--pi-sobre` / `--pi-sobre-dim` | `#fff6ef` / `#f5cdb9` | Texto sobre madeira / secundário |
| `--pi-vao-dim` | `#c9a9b4` | Texto secundário sobre vão |
| `--pi-ouro-luz` / `--pi-ouro` / `--pi-ouro-forte` / `--pi-ouro-esc` | `#ffe07a` / `#fccb0f` / `#e8a800` / `#4a3608` | Botão principal (texto `--pi-ouro-esc`) |
| `--pi-rx` / `--pi-rx-esc` / `--pi-rx-clr` / `--pi-rx-luz` | `#ba5ad1` / `#8d49b8` / `#e77ad2` / `#ffdef0` | Botão secundário de destaque, seleção, foco |
| `--pi-verde` / `--pi-vermelho` / `--pi-laranja` | `#6fd08a` / `#d8574a` / `#f0a03c` | Estados ok / erro / aviso |
| `--pi-xadrez-clr` / `--pi-xadrez-esc` | `#587aff` / `#3357e3` | Fundo xadrez da janela |

## Receitas

- **Fundo da janela:** xadrez `conic-gradient(var(--pi-xadrez-clr) 0 25%, var(--pi-xadrez-esc) 0 50%, var(--pi-xadrez-clr) 0 75%, var(--pi-xadrez-esc) 0) 0 0 / 32px 32px`.
- **Painel de madeira:** `background: linear-gradient(var(--pi-mad-esc) 0 10px, var(--pi-mad) 10px calc(100% - 12px), var(--pi-mad-quente) calc(100% - 12px))`; `border-radius: 9px`; `box-shadow: inset 0 0 0 2px var(--pi-mad-linha), inset 0 0 0 4px var(--pi-mad-luz), inset 0 0 0 6px var(--pi-mad), 0 5px 0 var(--pi-mad-base), 0 7px 0 var(--pi-mad-linha), 0 14px 30px #0008`.
- **Vão (campo, lista, área rebaixada):** `background: var(--pi-vao)`; `border-radius: 6px`; `box-shadow: inset 0 0 0 2px var(--pi-mad-linha), 0 1px 0 var(--pi-mad-luz2)`.
- **Botão principal (ouro):** `background: linear-gradient(var(--pi-ouro-luz) 0 6px, var(--pi-ouro) 6px 62%, var(--pi-ouro-forte) 62%)`; `color: var(--pi-ouro-esc)`; `box-shadow: inset 0 0 0 2px var(--pi-mad-linha), inset 0 -3px 0 #0002, 0 3px 0 var(--pi-mad-base)`; `border-radius: 7px`; Tahoma 700, MAIÚSCULAS, `letter-spacing: 1px`, `text-shadow: 0 1px 0 #fff8`. `:active` → `translateY(2px)` e degrau `0 1px 0`.
- **Botão comum (madeira):** mesma forma, gradiente `var(--pi-mad-quente)`→`var(--pi-mad)`, texto `--pi-sobre`, `text-shadow: 0 1px 0 var(--pi-mad-linha)`.
- **Botão roxo (alternância ligada, aba ativa secundária):** gradiente `var(--pi-rx-clr)`→`var(--pi-rx)`→`var(--pi-rx-esc)`, texto branco.
- **Perigo:** gradiente `#ef7b62`→`#d8574a`→`#9c3229`, texto branco.
- **Ícone-botão:** quadrado 32 px, vão com contorno; hover → `--pi-vao2`; pressionado → roxo.
- **Abas segmentadas (Grade/Foco, Caçar/Mercado, nav do Gerenciar):** trilho = vão; aba ativa = botão ouro pequeno (12 px, MAIÚSCULAS).
- **Rótulos de formulário:** 11 px, 700, MAIÚSCULAS, `letter-spacing: .5px`, cor `--pi-sobre-dim`.
- **Selos/pílulas:** fundo vão, contorno 1 px `--pi-mad-linha`, sombra `0 2px 0 var(--pi-mad-linha)`, texto 10–11 px 700 Tahoma.
- **Tipografia:** corpo `"Segoe UI", system-ui, sans-serif` 13 px; títulos/botões `Tahoma, Verdana, "Segoe UI", sans-serif` 700. Sem fontes externas.
- **Movimento:** curto e “físico” (afundar 2 px ao clicar); sem fades longos, sem brilhos difusos, sem gradientes coloridos decorativos.

## Aplicação no PokéHub

- **Barra superior** = prancha de madeira de ponta a ponta (sem raio nas laterais), logo da pokébola + “PokéHub” em Tahoma 700 com sombra vinho.
- **Cabeçalho de cada coluna** = régua de madeira fina (30 px) com contorno; a cor da conta vira um “prego”/gema à esquerda e um filete de 3 px no topo.
- **Lateral (Assistente)** = painel de madeira; listas em vão; o número grande em ouro com contorno vinho.
- **Gerenciar / formulários / tela vazia** = painel de madeira centralizado sobre o xadrez; navegação lateral como botões de madeira, ativa em ouro.
- **Estados:** carregando = laranja, pronto = verde, erro = vermelho, login = roxo; sempre com contorno vinho.
- Acessibilidade: manter foco visível (anel 2 px `--pi-rx-clr` + 2 px vinho), contraste mínimo AA para texto em vão e em madeira.
