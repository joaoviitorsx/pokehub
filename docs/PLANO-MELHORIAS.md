# Plano de melhorias — PokéHub v0.1 (análise de 2026-11-23)

Base analisada: commit `53dbaa6` (Electron 44 + React 19 + SQLite nativo do Node). Baseline: typecheck ok, 187 testes Vitest + 1 Node passando.

## 1. Diagnóstico

| Área | Situação atual | Problema |
|---|---|---|
| Distribuição | `.exe`/AppImage gerados à mão, versão `0.0.0`, sem `publish` | Cada versão exige baixar outro instalador/.zip manualmente |
| Layout | `layout()` fixo em 2×2 (máx. 4) | Grade “quadrada” fica feia; cada jogo é mais legível em retrato; não escala por quantidade |
| Extensões | Só uma (`/hunt`), coluna `hunt_extension_path`, validador recusa qualquer `permissions` | Impossível usar Smart Market (pede `storage`) ou qualquer outra |
| Professor Grindolino | Botão de frasco, telas Professor/Equipe/Histórico, medição ao vivo, ~2.000 linhas + IPCs | Usuário decidiu remover tudo |
| Mercado | Inexistente | Usuário quer ajuda para achar o Pokémon de melhor custo-benefício |
| `/hunt` | Código verificado contra 1.0.17; instalada agora é **1.0.23** | Nomes internos podem ter mudado — validar a lateral |
| Lockfile | `bun install --frozen-lockfile` falha com Bun 1.4.4 | `bun.lock` atualizado nesta branch |

## 2. Extensões do ecossistema PokeIdle — avaliação de segurança

Critério do hub: **só leitura/exibição**; nada que compre, venda, clique sozinho, gaste moeda ou fale com servidores fora de `pokeidle.io`.

| Extensão | Fonte | O que faz | Veredito |
|---|---|---|---|
| **/hunt for PokeIdle** (`mhnplloljgchpfpcpbhmcokmnefodjnh`) | Chrome Web Store | Ranking de hunts | ✅ Já suportada (só content scripts) |
| **Smart Market** (`lhfeijlnlbglakplddjgbaopgcdfkcmm`) | [github.com/danielbonfante/pokeidle-smartmarket](https://github.com/danielbonfante/pokeidle-smartmarket) | Preço de mercado na ficha, selo de desconto em cada anúncio, ajuda a precificar | ✅ **Recomendada.** Manifesto: só `storage` + content scripts em `https://pokeidle.io/*`. Sem servidor próprio; consultas `market.historicoGlobal`/`market.listar` pelo socket do jogo com limite (≤12/min). Nunca toca em publicar/comprar. Licença “todos os direitos reservados”: o hub só **carrega a cópia instalada pelo usuário**, nunca copia código |
| Hunt+ para PokeIdle (`cafnlpjdmnogiailekhppgblddmdfmkj`) | Chrome Web Store | Ranking de hunts | 🟡 Diz ser só leitura; auditar o manifesto ao instalar |
| PokeIdle Market+ (`ppfciiepdkhjknjchecjpfkoiokdgbof`) | Chrome Web Store | Filtros/alertas de mercado | 🟡 Diz não comprar sozinha, mas declara coleta de histórico/conteúdo/dados pessoais — não recomendada sem auditoria |
| Community Dex (mrooger) | GitHub (MIT) | Dex, IVs, log de capturas | 🟡 Só leitura, mas `background.js` faz consultas externas → seria recusada pelo validador |
| **Rotom Sniper** (`olccbpdjdkbfgondiiaicmlifhbcggmk`) — o “Poke Sniper” | Chrome Web Store, sem código público | Radar de shiny/P5 no mercado + **auto-retorno ao Centro** | 🔴 Age no jogo (automação), código fechado. Não recomendada |
| Pokeidle Helper (ThiagoJurge) | GitHub | Cura/volta à hunt sozinho, clica na calculadora, tranca cadeados | 🔴 Automação + `scripting`/`tabs`/`background` |
| PokeIdle Piloto (DredsGG) | GitHub | Autopiloto: compra/revende no mercado, troca hunt, reabastece | 🔴 Gasta ouro sozinho, service worker, `power`, `notifications` |
| Auto Hunt for PokeIdle | Chrome Web Store | Troca hunt e compra itens sozinha | 🔴 Automação |

O hub passa a mostrar esse veredito **automaticamente** para qualquer pasta escolhida (seção 4.3), em vez de depender desta tabela.

## 3. Arquitetura-alvo

```
Barra superior (marca · Grade/Foco · abas de conta · ferramentas · atualização)
┌──────────┬──────────┬──────────┬──────────┬──────────────┐
│ cabeçalho│ cabeçalho│ cabeçalho│ cabeçalho│ Lateral       │
│ conta 1  │ conta 2  │ conta 3  │ conta 4  │ [Caçar|Mercado]│
│ (jogo)   │ (jogo)   │ (jogo)   │ (jogo)   │               │
└──────────┴──────────┴──────────┴──────────┴──────────────┘
```

## 4. Fases de implementação

### 4.1 Remover o Professor Grindolino (tudo)
- Renderer: apagar `pokemon-professor.tsx`, `pokemon-team.tsx`, `grindolino.tsx`, `grindolino-form.ts`, `analytics.tsx`, `analytics-chart.ts`, `live.tsx`, ícone/mascote `Professor`, botão de frasco, “Registrar previsão” e medição ao vivo da lateral.
- Main/preload: remover `grindolino-store.ts`, `live-measure.ts`, `hunt-team.ts` e IPCs `grindolino:*`, `analytics:*`, `live:*`, `hunt:team`.
- Domínio/contratos: remover `grindolino`, `analytics`, `live`, `pokemon-assessment`. Testes correspondentes saem.
- **Banco:** nenhuma migração destrutiva. As tabelas `grindolino_*` ficam como estão (dados do usuário preservados), só sem uso.

### 4.2 Layout em colunas, responsivo para N contas
- `layout(width,height,count,focus,side)` genérico: colunas lado a lado; se a coluna ficar abaixo de `COL_MIN` (≈340 px), quebra em linhas (`cols = max que cabe`, `rows = ceil(n/cols)`), última linha distribui a largura.
- Cada coluna ganha um **cabeçalho de 30 px** desenhado pelo renderer (cor, nome, estado, focar, recarregar, reabrir); a `WebContentsView` começa abaixo dele. O renderer importa a mesma função pura de `layout.ts` para alinhar.
- `effectiveFocus` passa a usar `COL_MIN`/altura mínima em vez de 2×2. Limite de cadastro continua 4 (termos do jogo), centralizado em `MAX_PROFILES`.
- Visual: barra mais limpa, botões agrupados, estados com cor, tela vazia nova (sem mascote do Grindolino).

### 4.3 Múltiplas extensões + auditor de segurança
- Banco v7: tabela `extensions(id, path, enabled, added_at)`; migra `hunt_extension_path` existente. Sem apagar coluna antiga.
- Catálogo de extensões conhecidas (`/hunt`, Smart Market) para **Detectar no navegador**; qualquer outra por **Adicionar pasta…**.
- Validador por política:
  - permitido: content scripts só em `https://pokeidle.io/*`, `permissions` ⊆ {`storage`, `unlimitedStorage`}, `action`/`icons`/`css`;
  - recusado: `background`, `host_permissions` fora do jogo, `scripting`, `tabs`, `cookies`, `webRequest`, `debugger`, `externally_connectable`, etc.
- Auditor estático (sem executar): procura URLs/WebSockets para outros hosts, `fetch`/`XMLHttpRequest` externos, `.click()`, `dispatchEvent`, `.send(` em socket. Resultado: **Só leitura / Interage com a página / Bloqueada**, com a lista de achados, mostrada em Configurações → Extensões.
- Todas as extensões habilitadas são carregadas em cada partição antes do `loadURL`; a lateral “Caçar” continua exigindo a `/hunt`.

### 4.4 Atualização automática pelo hub
- `electron-updater` + provedor GitHub Releases (`joaoviitorsx/pokehub`). `build.publish` no `package.json`, versão `0.1.0`.
- Workflow `release.yml`: em tag `v*`, gera NSIS (Windows) e AppImage (Linux) e publica com `latest.yml`/`latest-linux.yml`.
- UI: verificação ao abrir e a cada 6 h; selo “Atualização disponível” na barra → baixar com progresso → “Reiniciar e instalar”. Opção em Configurações. Desativado fora do app empacotado.
- Sem assinatura de código, o Windows mostra SmartScreen só na primeira instalação; as atualizações seguintes funcionam.
- Não alterar `productName` raiz (mudaria a pasta de dados).

### 4.5 Assistente de Mercado (custo-benefício)
- Lateral ganha aba **Mercado** (a aba atual vira **Caçar**).
- Leitura **somente** do que está na tela do Mercado da conta escolhida (`#cm-lista > .cm-card`), por script constante, igual à política de `docs/data-sources.md`: nome, nível, potência (`.cm-pot`), nota (`.pk-selo-n`), shiny, preço (`.cm-preco`) e moeda; e, se a Smart Market estiver carregada, o selo de desconto dela. Nenhum clique, compra ou mensagem ao servidor.
- Domínio puro `rankDeals`: pontuação de qualidade (nota 0–10, potência P1–P5, nível, shiny) ÷ preço normalizado na mesma moeda, bônus pelo desconto em relação ao preço de mercado; explica o porquê de cada posição. Pesos ajustáveis (foco em PvP/hunt/revenda).
- **Validar no jogo real:** seletores dos cards da vitrine vieram da documentação da Smart Market; precisam ser confirmados com o Mercado aberto.

## 5. Riscos e validação manual
- Testar `/hunt` 1.0.23 na lateral “Caçar”.
- Testar Smart Market dentro do Electron (`chrome.storage.local` é suportado; o popup da extensão não aparece no Electron).
- Primeira release: criar tag `v0.1.0`, conferir o workflow e instalar; depois publicar `v0.1.1` para provar a atualização.
