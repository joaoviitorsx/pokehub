# Professor Grindolino — Etapa A: pesquisa e fixtures

Professor Grindolino é o nome de produto do analisador de hunts do PokéHub (antigo "Hunt Analyzer" da especificação, seção 9). Id técnico sugerido para código, pastas e tabelas: `grindolino` (ex.: `domain/grindolino/`, `catalogs/grindolino/`).

Data de acesso de todas as fontes: **2026-11-10**. Versão dos assets do site no momento: `1.416.0`. Termos: versão `2026-10-12`, com revisões citadas de 13, 14 e 16/10/2026.

Este documento é só pesquisa. Nada aqui foi implementado.

## 1. Método e limites

- Cerca de 15 requisições GET sem login a páginas públicas de `pokeidle.io`, espaçadas em 1 s. Nenhum endpoint de API, nenhum login, nenhum navegador headless.
- O código da extensão `/hunt` não foi aberto. O bundle do jogo (`app.js`) não foi baixado nem lido.
- Lido além do HTML: apenas `terms.mjs`, que é o módulo que contém o texto jurídico exibido em `/terms` (a página HTML vem vazia e o texto é injetado por ele).
- `robots.txt` declara `Content-Signal: search=yes, ai-train=no, use=reference` e `Allow: /` para agentes genéricos. Uso aqui: referência, com fatos resumidos e sem cópia extensa.
- Status usados (seção 9.3 da especificação):
  - **confirmado**: afirmado em página pública oficial, com URL.
  - **inferido**: deduzido de um título ou rótulo público, sem o texto explicativo.
  - **estimado**: valor numérico sem fonte. Nenhum neste documento.
  - **ausente**: não há fonte pública.

## 2. Fontes consultadas

| # | URL | O que é | Resultado |
|---|---|---|---|
| F1 | https://pokeidle.io/ | Landing oficial | Texto estático com números e mecânicas gerais. Fonte mais rica. |
| F2 | https://pokeidle.io/app | Página do jogo, HTML antes do login | Só títulos e destaques das "Novidades" (patch notes). O corpo dos textos é carregado por JS e não foi lido. |
| F3 | https://pokeidle.io/terms (texto em `/terms.mjs`) | Termos, privacidade e regras | Lido na seção 5 (regras do jogo) e seção 2 (direitos). |
| F4 | https://pokeidle.io/robots.txt, `/sitemap.xml` | Política de crawl e mapa do site | Sitemap lista só `/`, `/app`, `/tracker`, `/tracker/meta`, `/tracker/ladder`, `/terms`. |
| F5 | https://pokeidle.io/tracker | Tracker oficial | Só estatísticas de PvP, meta e ranking. Exige JS. Irrelevante para hunts; não explorado. |
| — | `/wiki`, `/wiki.html`, `/guia`, `/guide`, `/changelog`, `/novidades` | Tentativas de achar a Wiki | Todas 404. |
| — | Busca web | Wiki ou guia de comunidade | Nada sobre pokeidle.io. Os resultados são de outros jogos (Poke Idle World, Tibia). |

**Wiki:** o botão "Wiki" existe no HTML de `/app`, mas não há URL pública. O conteúdo fica dentro do cliente, depois do login. Não foi lido. Só pode ser consultado manualmente pelo usuário na própria conta.

**Discord** (https://discord.gg/pokeidle): citado pelos termos como canal oficial (`#how-to-play`, onde fica a extensão de automação). Exige conta; não acessado.

## 3. Termos: automação e ferramentas (F3, seção 5)

Resumo dos fatos, não transcrição:

- Automações são permitidas no jogo e no Mercado, inclusive a extensão de automação oficial distribuída no Discord.
- Limites: não explorar falhas, não burlar limites do jogo (contas por pessoa e por rede, travas e retenções do Mercado), não sobrecarregar o servidor.
- Multicontas: até 4 contas por pessoa somando redes e aparelhos; até 4 criadas e 4 conectadas ao mesmo tempo por rede; a detecção usa rede e identificador do navegador; mais de 4 leva a banimento de todas as contas.
- Transações entre contas próprias só pelo Mercado da Comunidade.
- Conta pessoal e intransferível.
- Seção 2: código-fonte, arte de interface e textos do documento pertencem ao projeto.

Isso confirma de forma independente a seção 2.1 da especificação.

Consequências para o Grindolino:

- Os termos não mencionam ferramentas de análise de terceiros nem leitura de dados do cliente. "Automação permitida" não é autorização explícita para um adaptador de leitura. Tratar qualquer captura automática como decisão pendente de revisão; a entrada manual não tem esse risco.
- "Não sobrecarregar o servidor" pesa contra polling ou scraping para montar catálogo.
- Como o código e os textos são do projeto, o catálogo deve guardar fatos (nomes, níveis, números) e nunca cópias de texto da Wiki.

## 4. Achado principal: o jogo já tem um "Hunt Analyser" próprio

A landing (F1) diz que o jogo tem 752 hunts no mapa-múndi, cada uma com nível, tipos e lista de drop próprios, e que o "Hunt Analyser" do jogo mostra quanto de XP e de Coins por hora aquela área rende na conta do jogador, antes de ir.

Ou seja, o cliente oficial já exibe uma previsão de XP/h e Coins/h por hunt e por conta. Isso muda a Etapa B:

- O valor exibido pelo jogo, digitado pelo usuário, é a melhor entrada disponível. Deve ser rotulado como "previsão do jogo, informada manualmente", e não como cálculo do Grindolino nem como valor observado.
- O Grindolino agrega valor em comparar previsão do jogo com rendimento medido, guardar histórico, comparar as quatro contas e explicar. Reimplementar a fórmula do jogo não é necessário para isso.
- Não se sabe o que a previsão do jogo inclui (boosts ativos, downtime, mortes). Ver lacunas.

## 5. Dados da seção 9.3: status e fonte

| Dado (9.3) | Status | O que se sabe | Fonte | Lacuna |
|---|---|---|---|---|
| Pokémon, nível, atributos | **ausente** (fórmulas); existência **confirmada** | Equipe de 5. Cada Pokémon tem potência P1 a P5 e IV por status. Anúncios de exemplo mostram "Nv 312 P5 IV 174", logo o nível passa de 300. As Megas têm status base publicados em destaque (ex.: Mega Aggron 230 de Defense). Há nível de treinador separado do nível do Pokémon. | F1, F2 | Como nível, P e IV viram atributos; como atributos viram dano; nível máximo; papel dos 5 da equipe na hunt. |
| Golpes, cooldown e tipos | **inferido** | 18 tipagens. A recarga dos golpes passou a ser do Pokémon (título de novidade). Existem TMs Elemental e AoE, trocadas por disco de golpe permanente. | F1, F2 | Lista de golpes, valores de recarga, dano, tabela de efetividade, alcance e área do AoE. Tudo sem fonte. |
| Hunts acessíveis | **confirmado** (regra); **ausente** (lista) | 752 hunts. Cada hunt pede um nível de treinador. Regiões de Kanto a Paldea. Faixas de região na seção 6. | F1, F2 | A lista das 752 hunts com nível, tipos e drops não é pública fora do jogo. |
| Inimigos e frequência | **ausente** | Cada hunt tem tipos próprios. Existem "hunts em bandos" (título). No Safari os selvagens usam o nível do jogador. O corpo fica 30 s no chão para captura. Shiny: 1 em 24.000 por encontro. | F1, F2 | Espécies por hunt, proporção de spawn, respawn, tamanho dos bandos, vida e nível dos selvagens. |
| XP base e bônus | **confirmado** (lista de bônus); **ausente** (XP base, empilhamento) | Bônus publicados na seção 7. O jogo exibe XP/h previsto por hunt no seu Hunt Analyser. | F1, F2 | XP por abate; se os bônus somam ou multiplicam; curva de XP por nível. |
| Ouro (Coins) base e bônus | **inferido** | As Coins entram na hora do abate. Uma atualização trocou o loot por ouro e destaca "+15% de ouro por abate". Raid semanal: "+5% de farm" por 12 h. O jogo exibe Coins/h previsto. | F1, F2 | Coins por abate; o que é "farm"; o que restou de loot em item; preço de venda no NPC. |
| Custos de cura e mortes | **ausente** | Quem desmaia vai para o Centro Pokémon. Existem automações de revive, poção e venda de loot, e a opção "Voltar à hunt ao morrer/reset". | F1, F2 | Preço de poção e revive, penalidade de morte, tempo de retorno. Fica fora do modelo básico, com aviso (P2 na especificação). |
| Medições de farm | **ausente** como fonte automática | Não há exportação nem API pública documentada. O jogo roda só com a aba aberta, sem ganho offline. | F1 | Só medição manual: o usuário anota XP, Coins e horário no início e no fim. |

Fatos de apoio confirmados em F1: o Pokémon anda até o selvagem mais próximo e luta sozinho, e a bicicleta dá de +15% a +100% de velocidade na hunt. Logo o tempo de deslocamento faz parte do tempo por abate, e a fórmula de 9.4 não pode tratá-lo como zero.

## 6. Regiões e faixas de nível publicadas

Vêm de destaques das Novidades em F2 (títulos, sem o texto completo), salvo indicação. Status: **inferido**, porque não há o texto que explique se o número é o nível de entrada da região ou o nível da primeira hunt.

| Região / área | Nível de treinador publicado | Observação |
|---|---|---|
| Kanto | não publicado | Presume-se inicial; sem fonte. |
| Johto | 200 a 470 | Novidade "Johto agora abre no nível 200". |
| Outland 2 a 8 | 1.000 a 36.000 | A landing (F1) diz "Outland a partir do nível 150, em 8 degraus"; presume-se que 150 seja o degrau 1. |
| Galar | 25.000 | |
| Paldea | 40.000 | |
| Alola | 75.000 | |
| Hoenn, Sinnoh, Unova, Kalos | não publicado | Existem ("9 gerações", "de Unova em diante"); sem nível. |
| Safari | — | 1 hora desde a entrada, 695 espécies, selvagens no nível do jogador. |

Outros números: 1.277 espécies, 9 gerações, 752 hunts, 796 formas shiny, 25 bosses lendários, 18 ginásios (F1). Uma novidade cita "332 mapas novos" (F2).

Atenção: a ordem dos níveis (Alola acima de Paldea) não segue a ordem das gerações. O catálogo não deve ordenar regiões por geração.

## 7. Bônus de XP e de combate publicados

Todos **confirmados como existentes**. A forma de empilhar é **ausente**.

| Bônus | Valor publicado | Escopo | Fonte |
|---|---|---|---|
| Boost da Guild (Loja) | +10% XP do treinador e +10% XP dos Pokémon, 7 dias, guild toda | XP | F2 |
| Bônus Twitch (streamer oficial) | +15% XP | XP | F2 |
| Bônus Kick | +15% XP (300 pontos); +15% Capture Boost; +15% Secret Lure | XP, captura | F2 |
| Raid Gigantamax semanal | +20% XP e +5% de farm por 12 h | XP, farm | F2 |
| Sacrifício (Mochila) | +20% XP para treinador e Pokémon, 5 níveis, até 14 dias | XP | F2 |
| Casa com XP Share | 25% a 100% do XP da hunt para o Pokémon registrado; a Lendária registra dois | XP repartido | F1 |
| Ginásio | líder +25% de dano com Pokémon daquele tipo na hunt; pódio +25% / +10% / +5% | dano | F1, F2 |
| Dia sazonal | uma das 18 tipagens por dia fica 2× mais forte (ataque, defesa e vida), só nas hunts, selvagens inclusos | combate | F2 |
| Bicicleta | +15% a +100% de velocidade na hunt | deslocamento | F1 |
| Eventos globais | buff de XP e loot ligado pela staff, alguns semanais | XP, loot | F1 |
| VIP, boosts de 30 dias, "Boost dos Atrasados" | existem; valores não publicados fora do jogo | — | F1, F2 |

O "+50% XP de VIP" que aparece em buscas é de outro jogo (Poke Idle World). Não usar.

## 8. Lacunas sem nenhuma fonte pública

1. Catálogo das 752 hunts: nome, região, nível exigido, tipos, espécies, drops.
2. Fórmulas de dano, atributos, efetividade de tipos e recarga.
3. XP e Coins por abate, por espécie ou por hunt.
4. Proporção de spawn, respawn e tamanho dos bandos.
5. Regra de empilhamento dos bônus de XP.
6. Custos de poção e revive e efeito da morte.
7. Valores de VIP e dos boosts da loja.
8. O que a previsão do Hunt Analyser do jogo inclui ou exclui.
9. Se várias contas na mesma hunt disputam spawn (seção 9.9 da especificação).
10. Conteúdo da Wiki in-game e texto completo das Novidades.
11. Se a leitura automática de dados do cliente por um app de terceiros é aceita. Os termos são omissos. Vale perguntar à staff no Discord antes de qualquer adaptador.

Como fechar sem violar regras: o usuário consulta a Wiki e o Hunt Analyser do jogo na própria conta e digita os valores; cada registro guarda a proveniência "informado pelo usuário a partir do jogo, em tal data".

## 9. Recomendação para a Etapa B (modo básico)

**Dá para implementar agora, só com dados confirmados e entrada manual:**

- Catálogo local versionado e editável. Nasce quase vazio: regiões da seção 6 com status `inferred` e hunts cadastradas pelo usuário.
- Cadastro manual de hunt: nome, região, nível de treinador exigido, tipos.
- Elegibilidade por nível de treinador. A regra "cada hunt pede um nível de treinador" é confirmada.
- Registro da previsão do jogo (XP/h e Coins/h lidos no Hunt Analyser do jogo), por conta e por hunt, com data.
- Sessões de medição manuais: XP, Coins e abates no início e no fim, com horários. Cálculo de taxa observada por hora, que é aritmética e não fórmula do jogo.
- Ranking por objetivo usando somente valores informados ou medidos, com rótulo visual distinto para "previsão do jogo", "observado" e "sem dados".
- Comparação previsto × observado (erro absoluto e percentual) por hunt e por conta.
- Registro dos bônus ativos como anotação da sessão, para explicar diferenças, sem aplicá-los em cálculo.
- `confidence` restrito a `insufficient_data` (sem entrada) ou `verified` (medição com amostra mínima a definir). Previsão digitada do jogo fica como `estimated`.

**Bloqueado até haver fonte:**

- Qualquer simulação de combate (dano, tipos, recarga, AoE, sobrevivência): Etapa C.
- XP/h ou Coins/h calculado pelo Grindolino a partir de atributos.
- Aplicar ou empilhar bônus numericamente.
- `netGoldPerHour` e `expectedDeathsPerHour`. Mostrar só ouro bruto, com aviso.
- Catálogo completo pré-carregado das 752 hunts.
- Captura automática de snapshot ou de amostras do cliente.
- Soma entre contas na mesma hunt.

## 10. Proposta de contratos de domínio (não implementado)

Alinhado à seção 9.5; só acrescenta o mínimo para proveniência e para o modo básico.

```ts
type Confidence = 'verified' | 'estimated' | 'insufficient_data';

/** Status de pesquisa de um dado (seção 9.3). */
type DataStatus = 'confirmed' | 'inferred' | 'estimated' | 'absent';

type SourceKind = 'public_page' | 'in_game_manual' | 'user_measurement';

interface Provenance {
  status: DataStatus;
  sourceKind: SourceKind;
  /** URL pública ou descrição da tela do jogo. */
  source: string;
  /** Data ISO (YYYY-MM-DD) de acesso ou de leitura. */
  accessedAt: string;
  note?: string;
}

interface HuntCandidate {
  id: string;
  regionId: string;
  unlockRequirements: readonly string[];   // 9.5, ex.: ['trainerLevel>=200']
  displayName: string;
  requiredTrainerLevel?: number;           // inteiro; ausente = desconhecido
  types?: readonly string[];
  provenance: Provenance;
}

/** Campos mínimos validados; nada de DOM ou API. */
interface PlayerSnapshot {
  accountId: string;
  capturedAt: string;                      // ISO 8601
  sourceKind: SourceKind;                  // na Etapa B: 'in_game_manual'
  trainerLevel: number;                    // inteiro >= 1
  /** Bônus anotados para explicação; não entram em cálculo na Etapa B. */
  activeBonusNotes: readonly string[];
}

/** Previsão exibida pelo Hunt Analyser do jogo, digitada pelo usuário. */
interface GameForecast {
  huntId: string;
  accountId: string;
  readAt: string;
  xpPerHour?: string;                      // inteiro decimal em string (10.1)
  coinsPerHour?: string;
}

interface HuntEstimate {                    // igual a 9.5
  huntId: string;
  modelVersion: string;
  confidence: Confidence;
  xpPerHour?: number;
  grossGoldPerHour?: number;
  netGoldPerHour?: number;                 // não preenchido na Etapa B
  killsPerHour?: number;
  expectedDeathsPerHour?: number;          // não preenchido na Etapa B
  assumptions: readonly string[];
  warnings: readonly string[];
}

interface RankHuntsInput {                  // igual a 9.5
  player: PlayerSnapshot;
  candidateHunts: readonly HuntCandidate[];
  objective: 'xp' | 'gold' | 'balanced';
  modelVersion: string;
}
```

Pontos em aberto:

- O nível de treinador chega a 75.000 e o XP pode passar do inteiro seguro. A proposta usa string decimal para XP e Coins nas entradas (seção 10.1) e `number` só nas taxas por hora, como em 9.5. Confirmar a escala real antes de fixar.
- `objective: 'balanced'` não tem definição possível sem uma taxa de conversão entre XP e Coins. Sugestão: deixar fora da UI na Etapa B.
- `farm_samples` da seção 10 já cobre as medições manuais (`source_kind = 'user_measurement'`). `GameForecast` cabe em `hunt_estimates.payload_json` com um `model_version` como `game-forecast-manual`, sem tabela nova.

## 11. Proposta de catálogo versionado em JSON (não implementado)

Um arquivo por versão, imutável depois de publicado. As edições do usuário ficam em arquivo ou tabela separada, para não se misturarem com o que veio de fonte pública.

```json
{
  "schemaVersion": 1,
  "catalogId": "grindolino-base",
  "version": "2026.11.10-1",
  "gameAssetVersion": "1.416.0",
  "generatedAt": "2026-11-10",
  "sources": {
    "landing": { "url": "https://pokeidle.io/", "accessedAt": "2026-11-10" },
    "news": { "url": "https://pokeidle.io/app", "accessedAt": "2026-11-10", "note": "títulos das Novidades" }
  },
  "regions": [
    {
      "id": "johto",
      "displayName": "Johto",
      "trainerLevelMin": 200,
      "trainerLevelMax": 470,
      "provenance": { "status": "inferred", "sourceKind": "public_page", "source": "news", "accessedAt": "2026-11-10" }
    }
  ],
  "hunts": [
    {
      "id": "user:exemplo-1",
      "regionId": "johto",
      "displayName": "(nome digitado pelo usuário)",
      "requiredTrainerLevel": 200,
      "types": [],
      "unlockRequirements": ["trainerLevel>=200"],
      "provenance": { "status": "confirmed", "sourceKind": "in_game_manual", "source": "tela de hunts do jogo", "accessedAt": "2026-11-10" }
    }
  ]
}
```

Regras propostas:

- Todo registro tem `provenance`. Registro sem ela é rejeitado na importação.
- `source` aponta para uma chave de `sources` ou descreve a tela do jogo.
- Campo desconhecido é omitido; nunca preenchido com zero ou palpite.
- Mapeamento para a seção 10: `hunt_catalogs.source` = `catalogId`, `hunt_catalogs.version` = `version`, e o restante de cada hunt em `hunts.metadata_json`.
- O exemplo de hunt acima é ilustrativo e não é dado real. O catálogo-base inicial teria só regiões.

## 12. Fixtures sugeridas para a Etapa B

Não há exemplo numérico real público. As fixtures de teste devem ser sintéticas e marcadas como tal, cobrindo: hunt sem dados (`insufficient_data`), hunt só com previsão do jogo, hunt com previsão e medição, nível insuficiente, e sessão inválida (fim antes do início). Fixtures reais dependem de o usuário registrar leituras do jogo.
