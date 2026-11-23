# Extensão "/hunt for PokeIdle" nas sessões do PokéHub

> **Atualização (v0.1):** o PokéHub agora carrega várias extensões (tabela `extensions`, banco v7), com validador por política e auditor estático (Só leitura / Interage com a página / Bloqueada), geridas em Configurações → Extensões (`extensions:*`). Os canais `extension:*` e a preferência `hunt_extension_path` descritos abaixo foram substituídos; a coluna antiga fica no banco sem uso. Veja `docs/PLANO-MELHORIAS.md`, seção 4.3.

A extensão é de terceiros (Liang), id `mhnplloljgchpfpcpbhmcokmnefodjnh`. O PokéHub **não copia, não modifica e não distribui** o código dela: apenas carrega, em cada sessão do jogo, a pasta onde o usuário já a instalou pelo navegador.

## Como funciona

- Preferência `hunt_extension_path` em `workspace_settings` (banco v4). `NULL` = desativada.
- `spike/electron/extension-check.ts` (sem Electron) valida a pasta antes de qualquer carga:
  - caminho absoluto, existente, diretório; `manifest.json` de até 64 KB;
  - `manifest_version: 3`, nome e versão numérica;
  - recusa `background`, `permissions`, `host_permissions`, `optional_permissions`, `optional_host_permissions`, `externally_connectable` (lista vazia é aceita);
  - todo `content_scripts[].matches` e `web_accessible_resources[].matches` precisa começar com `https://pokeidle.io/`.
- "Detectar no navegador" procura a maior versão em `<perfil>/Extensions/<id>/<versão>_N`, perfis `Default` e `Profile *`:
  - Linux: `~/.config/google-chrome`, `~/.config/chromium`, `~/.var/app/com.google.Chrome/config/google-chrome` (Flatpak), `~/.config/BraveSoftware/Brave-Browser`, `~/.config/microsoft-edge`;
  - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`, `...\Microsoft\Edge\User Data`, `...\BraveSoftware\Brave-Browser\User Data`.
- Ao iniciar, se a pasta da versão salva sumiu (o Chrome atualizou a extensão), o PokéHub usa a maior versão irmã válida na mesma pasta do id e atualiza a preferência.
- No processo principal, cada sessão (`persist:pokehub-<uuid>`) recebe `session.extensions.loadExtension(pasta, {allowFileAccess:false})` **antes** do `loadURL`, porque há scripts em `document_start`. Se a carga falhar, a sessão abre normalmente sem a extensão e o erro aparece em Configurações.
- Desativar ou trocar a pasta remove a extensão das sessões; as páginas já abertas só mudam depois de "Recarregar sessões para aplicar".
- O renderer nunca envia caminho: `extension:choose` abre o seletor de pastas no processo principal e `extension:detect` / `extension:set` só usam os candidatos acima. Todos os canais exigem a mesma origem confiável dos demais IPCs.
- Pop-ups, permissões e navegação fora do jogo seguem bloqueados pela política existente.

## Lateral "Onde caçar?" (leitura do ranking da extensão)

A lateral do PokéHub (botão de alvo na barra ou `Ctrl+H`, **só no modo Grade** e com a janela a partir de 1060 px de largura) mostra o ranking que a própria extensão calcula, sem abrir o painel dentro de cada jogo. No Foco a lateral some, as sessões usam a largura inteira e o painel `/hunt` do jogo segue sendo o caminho; ao voltar para a Grade ela reaparece como estava.

O que o PokéHub faz (`spike/electron/hunt-snapshot.ts`, canal `hunt:snapshot(profileId)`):

- Só aceita id de perfil existente, com sessão aberta, carregada (`ready`), com a extensão carregada e com a página em `https://pokeidle.io`. Fora disso nada é executado na página.
- Executa na página **scripts fixos** (nenhum dado do renderer é interpolado): a sondagem e o cálculo, este em duas variantes constantes (`soLiberadas:true` e `soLiberadas:false`). O renderer só envia um booleano, validado no processo principal, que escolhe a variante:
  1. sondagem barata: lê os últimos eventos retidos do barramento da extensão, `__pokeidleHunt.on('welcome')` e `__pokeidleHunt.on('estado')` (assina e desassina na hora), e devolve uma assinatura do Pokémon em campo (id, nível, stats, tipo do dia, nível do treinador);
  2. só quando a assinatura muda (ou a cada 60 s): chama `__pokeidleHunt.carregarJogo()` e o cálculo da extensão, `__pokeidleHunt.engine.analisar(pokemon, contexto, {ordem:'xp', soLiberadas, tipoDoDia})`, com o mesmo contexto que o painel dela monta (`ritmo`, `geo.mapaDa`, `geo.ritmoMedido`, constantes do `welcome`).
- Do resultado sai um JSON pequeno: Pokémon em campo (nome, nível), bônus de XP, e até 60 hunts viáveis (as 20 melhores por XP/h, por ouro/h e por Shiny/h) com nome, região, nível, XP/h, abates/h, "mata em", ouro/h, Shiny/h, risco, se está liberada e o `looktype` da espécie (o mesmo `jogo.especies.get(pokeId).looktype` que o painel da extensão usa para a arte).
- O processo principal **revalida tudo** antes de entregar à interface: tipos, números finitos e não negativos com teto, textos de até 80 caracteres sem caracteres de controle, no máximo 60 linhas; campos extras são descartados. Erro, formato inesperado ou demora (8 s) viram "Dados do /hunt indisponíveis nesta conta".
- A interface consulta a cada ~10 s **apenas** com a lateral visível e **apenas** a conta selecionada nela. Lateral fechada ou modo Foco: nenhuma consulta.

O que **não** é feito: nenhum cálculo, fórmula ou catálogo da extensão é copiado para o PokéHub; nada é escrito na página, no DOM ou no estado do jogo; cookies, `localStorage` e credenciais não são lidos. Por isso as preferências do painel da extensão (ordem, "só hunts liberadas", região) não são conhecidas: a lateral tem o próprio "Só liberadas" (padrão ligado) e ordena XP/h, Ouro/h ou Shiny/h localmente sobre as linhas recebidas, sem mudar o filtro dentro da extensão.

### Retratos (sprites) dos Pokémon

- Origem: o mesmo endereço público do jogo que a extensão consulta em `pintarArtes()` (`ui.js`): `https://pokeidle.io/tracker/api/sprites?lt=<looktypes>`, que responde `{retratos:{<looktype>:{img,x,y,w,h}}}` (um atlas `.webp` em `/assets/...` e a janela do retrato nele). Nenhuma imagem é baixada para o projeto nem empacotada.
- Quem pede é o **processo principal** (`net.fetch` com `credentials:'omit'`, sem seguir redirecionamento, 4 s de prazo), nunca a página do jogo: os scripts da página continuam sem rede. A URL só leva números de looktype já validados (inteiros de 1 a 10⁷). O resultado fica em cache em memória por looktype.
- `sanitizeSprite` só aceita `https:` com origem exatamente `https://pokeidle.io`, sem usuário/senha, sem `..`, `%2e`, barra invertida, espaço ou caractere de controle, até 300 caracteres, e janela inteira (x,y de 0 a 16384; w,h de 1 a 256). `data:`, `http:`, `javascript:`, `blob:`, `file:` e outras origens são descartados; sem retrato a lateral mostra a inicial do nome.
- O renderer mostra `<img>` do atlas recortado por CSS (`object-fit:none` + `object-position`), com `loading="lazy"`, `decoding="async"`, `referrerPolicy="no-referrer"` e tamanho fixo. A extensão recorta pelo contorno num canvas; a lateral não copia isso, então o Pokémon aparece como está na janela do atlas (pode ficar um pouco descentralizado).
- CSP do renderer (`index.html`): `default-src 'self'; style-src 'self'; script-src 'self'; img-src https://pokeidle.io`. Nenhuma outra origem de imagem, nem `data:`.
- Cookies: o renderer e o `net.fetch` usam a sessão padrão do Electron; as contas do jogo vivem em partições separadas (`persist:pokehub-<uuid>`), então nenhum cookie de login acompanha esses pedidos. O pedido da lista de retratos vai sem cookies e ignora `Set-Cookie`.

### Ajustes da lateral

- Largura de 280 a 520 px: arraste a borda esquerda, use as setas com o foco nela (`Home`/`End` vão aos extremos) ou dê duplo clique para voltar a 340. A largura vai pelo canal existente `session:layout` (4º argumento), que recusa valor fora da faixa ou não inteiro; `sideWidth()` em `layout.ts` ainda reserva 720 px para a grade.
- Arrasto da borda: as sessões são `WebContentsView` nativas por cima do renderer e engoliam o ponteiro. Ao iniciar o arrasto o renderer chama `session:drag(true)` (booleano validado, só a interface) e o processo principal esconde as sessões; `session:drag(false)` ao soltar as devolve. Se o aviso de fim não chegar em 10 s, elas voltam sozinhas (o renderer renova o prazo a cada 5 s em arrasto longo). A largura só vai por `session:layout` ao soltar.
- Leitura: a conta selecionada é relida a cada 5 s (sondagem barata; o cálculo só refaz se a assinatura mudar ou a cada 60 s). Ao abrir, as outras contas utilizáveis são lidas uma por vez e depois no máximo a cada 60 s, para a troca de conta abrir com o último retrato. Cada pedido tem prazo de 8 s na lateral. Sessão "carregando" sem carga do frame principal em curso já pode ser lida (`canReadHunt`), e `did-stop-loading` também promove o estado a pronto.
- "Registrar previsão" (ícone em cada hunt): grava XP/h e ouro/h arredondados como previsão da conta selecionada no Professor Grindolino, criando a hunt se não houver outra com o mesmo nome (sem diferenciar maiúsculas). Usa só `listHunts`/`createHunt`/`addForecast`.
- "Só liberadas", quantidade de hunts (5/10/20) e modo compacto ficam, com a largura, no `localStorage` do renderer (`pokehub.side`): são preferências de aparência desta máquina e são revalidadas ao ler.

Risco de quebra: essa leitura depende de nomes **internos** da versão 1.0.17 (`on`, `carregarJogo`, `engine.analisar`, `geo`, `ritmo`, e os campos `linhas[].xpPokemonH/ouroH/shinyH/kph/ttk/hitPct/mortesH/umHit`, `bonusXp`, `pokemon`, `especie.looktype`, `linhas[].pokeId/liberada`; na visão Equipe também `estado.pokemons[].nome/potencia/tipos/ivs/stats/speciesId`) e do formato de `/tracker/api/sprites`. Não é uma API pública: uma atualização da extensão pode renomear qualquer um deles. Nesse caso a lateral mostra "Dados indisponíveis" (ou "Extensão /hunt inativa" se o objeto sumir) e o painel `/hunt` dentro do jogo continua funcionando normalmente. O cálculo completo leva algumas centenas de ms na página do jogo; a assinatura evita repeti-lo enquanto nada muda.

## Equipe: "Esse Pokémon é bom?" (Professor Grindolino)

A visão "Equipe" do Professor usa o canal `hunt:team(profileId)` (`spike/electron/hunt-team.ts`), com as mesmas travas de `hunt:snapshot` (perfil existente, sessão legível, extensão carregada, página em `https://pokeidle.io`, origem confiável do IPC) e dois **scripts fixos** (sondagem e cálculo; o renderer só envia o id do perfil, que não entra no script).

- Viabilidade confirmada lendo a extensão 1.0.17: `engine.analisar(pk, ctx, opções)` aceita qualquer item de `estado.pokemons` (o comentário do próprio `engine.js` diz isso), não só o Pokémon em campo. Nenhum dado interno do jogo fora do que a extensão expõe é lido.
- O que é lido do último `estado` retido no barramento, por Pokémon: `id`, `nome`, `level`, `potencia`, `tipos`, `ivs` e `stats` (chaves `hp/atk/def/spAtk/spDef/speed`), `speciesId` (só para achar o `looktype` do retrato em `jogo.especies`). Do resultado de `analisar`: `linhas[]` viáveis (`nome`, `regiao`, `xpPokemonH`, `ouroH`, `kph`, `ritmo`/`aoe.estimado`), sempre com `soLiberadas:true`.
- `estado.pokemons` pode trazer mais que a equipe (a extensão não distingue). O script calcula no máximo **6**: o que está em campo e depois os de maior nível; a tela avisa "Mostrando 6 de N" e as comparações valem só entre os listados.
- Custo: `analisar` roda uma vez por Pokémon (algumas centenas de ms cada), com uma pausa (`setTimeout 0`) entre eles para não travar a página de uma vez. Só roda **sob demanda** (abrir a visão, trocar de conta ou "Ler equipe"), nunca em intervalo. O processo principal garante no máximo **um cálculo por conta a cada 60 s**: dentro do minuto devolve a última leitura sem executar nada na página (ou "lida há menos de um minuto" se não houver leitura válida); depois disso faz a sondagem barata e só recalcula se a assinatura da equipe (ids, níveis, stats, tipo do dia, nível do treinador, Pokémon em campo) mudou ou se a leitura tem mais de 10 min. Prazo de 20 s por script.
- Sanitização no processo principal (`sanitizeHuntTeam`): até 6 Pokémon sem repetição, até 120 hunts cada, textos sem caracteres de controle (nome 60, tipo 16, até 3 tipos), números finitos não negativos com teto, potência só inteiro de 1 a 5 (senão `null`), IVs e stats só inteiros não negativos (**sem teto de IV presumido**; valor estranho vira `null`), campos extras descartados. Retratos pela mesma rota e validação da lateral.
- Veredito (`spike/domain/pokemon-assessment.ts`, funções puras `pokemonPerformance` e `assessTeam`): posição entre os listados pela melhor hunt prevista (XP/h e ouro/h), real × previsto na mesma hunt (pelo nome, a com mais minutos medidos; até 5% conta como "dentro do previsto"), aviso de amostra pequena (< 30 min) e IV acima/abaixo da média dos listados. Não há nota. O "real" vem das medições ao vivo já gravadas com `pokemonKey` (o mesmo `id` da instância), agregadas por conta.
- Limites conhecidos: o contexto (`eu`) é o da conta agora, então bônus ligados ao Pokémon em campo, se existirem, valem para todos; `potencia`, `ivs` e `tipos` são nomes internos vistos em `ui.js`/`engine.js` e **não foram confirmados no jogo real**; com as sessões ocultas (telas de painel) o Chromium pode atrasar a pausa entre cálculos para ~1 s cada.

## Medição ao vivo (Professor Grindolino)

A medição ao vivo (`spike/electron/live-measure.ts`) lê o log de mensagens do jogo, não a extensão; funciona sem ela. Com a extensão carregada, usa o barramento só para duas coisas, em leitura: o `slug` de `campo.init` (troca de hunt) e o Pokémon em campo do último `estado` (`id`, `nome`, `level`). Nada é copiado da extensão. Fonte, campos e riscos em `docs/data-sources.md`, "Medição ao vivo".

## Riscos e limites

- **Compatibilidade depende das versões futuras da extensão.** Se uma atualização passar a declarar `background`, permissões ou sites fora do pokeidle.io, a validação recusa a nova versão e as sessões abrem sem ela.
- **O Electron não implementa todas as APIs `chrome.*` do MV3.** Hoje a extensão só usa content scripts; qualquer uso futuro de service worker, `chrome.storage`, `chrome.action` etc. pode simplesmente não funcionar.
- O código da extensão roda dentro das páginas do jogo com a sessão logada do usuário (um dos scripts roda em `world: "MAIN"`). O PokéHub valida o manifesto, não audita o JavaScript: a confiança é a mesma de usá-la no Chrome.
- A pasta escolhida manualmente pode ser de outra extensão, desde que passe na mesma validação (só content scripts do pokeidle.io).
- Trocas de versão feitas pelo Chrome com o PokéHub aberto só valem na próxima abertura do PokéHub.
- Verificado em Electron 44.10.2 com a versão 1.0.17 da extensão (Chrome Flatpak, Linux). Windows está coberto apenas por testes com sistema de arquivos falso.
