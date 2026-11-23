# Desempenho e consumo — análise de 2026-11-23

Quem mais consome são os 4 renderers do jogo: um por partição, sem compartilhamento possível. Pelo incidente registrado em `RETOMADA.md`, cada página deve ficar entre 1 e 2 GB (estimativa). Na grade, as 4 cenas renderizam na taxa do monitor. O hub em si é leve, mas tem desperdícios no código, e ainda não existe nenhum ajuste de economia.

## Já está bom
- Views ocultas (foco, Gerenciar, arrasto) usam `setVisible(false)`.
- A lateral só consulta com a aba visível e para com `document.hidden`.
- O processo principal não tem timers frequentes.
- Os caches são limitados.
- As extensões rodam sem `background`, então não criam processo extra.
- O build do Vite minifica e o empacotamento usa asar.

## Plano priorizado

| # | Mudança | Impacto | Risco |
|---|---|---|---|
| P0-1 | Medir se as views ocultas ficam com `visibilityState=hidden`. Se não ficarem, renderizam a 60 fps à toa. | Define o ganho do modo foco | Nenhum (só medir) |
| P0-2 | Testar se o jogo continua progredindo com a view oculta (`backgroundThrottling` padrão). Se não progredir, criar a opção por conta "Manter ativa" (`setBackgroundThrottling(false)`). | Economia segura no foco e com a janela minimizada | **Alto se errar** (a conta para de ganhar XP) |
| P0-3 | Cache e execução assíncrona da auditoria de extensões. Hoje ela lê até 8 MB de forma síncrona a cada `extensions:list` e trava a entrada de todas as views. | Remove travadas | Baixo |
| P0-4 | Só enviar `session:status` quando o estado mudar. Ignorar loading de subframe. Derivar o `pool` da lateral só de mudanças reais. | Menos IPC e re-renders | Baixo |
| P0-5 | Acabar com as animações infinitas (`pulse` e `shimmer`). Desligá-las no Modo leve. | O hub para de gerar quadros contínuos | Nenhum |
| P1-1 | Início escalonado: interface primeiro, depois a conta visível, depois as outras a cada 2–3 s. | Pico menor ao abrir | Baixo |
| P1-2 | `spellcheck:false` nas views e `devTools` só em dev. | Algumas dezenas de MB e uma requisição a menos por conta | Nenhum |
| P1-3 | Lateral: conta selecionada a cada 10 s, pré-aquecimento das outras a cada 5 min, cache do cálculo de 3–5 min. Sem `setState` quando nada mudou, na lateral e no Mercado. | 3–5× menos cálculo dentro das páginas do jogo | Baixo |
| P1-4 | Mutar o áudio das contas fora de foco (opcional). | Menos mixagem de áudio | Baixo |
| P1-5 | **Suspender/Retomar conta:** fecha a view sem apagar a partição. | Libera um renderer inteiro | Médio (a conta para enquanto estiver suspensa) |
| P1-6 | **Monitor por conta** no Diagnóstico: CPU e memória privada por conta, hub e GPU, só com a seção aberta. | Mostra qual conta pesa | Baixo |
| P1-7 | Sugerir o "Modo economia" do próprio jogo nas contas que você não está olhando (só dica, sem clicar). | Provavelmente o maior ganho na grade | Nenhum |
| P2-1 | `disable-features=SpareRendererForSitePerProcess` | Um processo ocioso a menos | Baixo |
| P2-2 | `--enable-low-end-device-mode` como opção experimental | Menos memória | Médio-alto |
| P2-4 | Aviso quando uma conta passar de X GB, com opção de recarregar | Evita a piora lenta de memória em 24 h | Baixo |
| P2-5/6 | Cache de `store.list()` e debounce de `arrange()`. Dependências do `useLayoutEffect`. | Menos trabalho no resize | Nenhum |
| P2-7 | Extensões por conta | Menos scripts nas contas que não precisam | Médio |

**Não fazer:**
- `disableHardwareAcceleration`
- `--disable-renderer-backgrounding` e `--disable-background-timer-throttling`
- `--renderer-process-limit`
- `--disable-site-isolation-trials`
- limite de heap V8

## Padrão × Modo leve
- **Sempre ligado:** P0-3, P0-4, P0-5, P1-1, P1-2, P1-3, P2-1, P2-5 e P2-6.
- **Modo leve** (Gerenciar → Layout):
  - sem animações;
  - som só na conta em foco;
  - lateral mais lenta e sem pré-aquecimento;
  - iniciar em Foco;
  - dica do Modo economia do jogo;
  - low-end mode experimental, que exige reiniciar.
- **Por conta:** Suspender/Retomar e, se o P0-2 mostrar necessidade, "Manter ativa".

## Medição na máquina (Windows, app empacotado)
1. No Gerenciador de Tarefas, aba Detalhes, adicionar as colunas CPU, Conjunto de trabalho privado, GPU e Linha de comando (`--type=`).
2. Cenários de 10 min cada, descartando os 3 primeiros:
   - S0: sem contas.
   - S1: 4 contas na grade.
   - S2: foco em 1 conta.
   - S3: janela minimizada.
   - S4: Modo economia do jogo em 3 contas.
   - S5: lateral em Caçar.
   - S6: lateral em Mercado.
3. Em cada cenário, anotar:
   - CPU e memória por conta;
   - GPU;
   - rede;
   - número de processos.
4. **Progresso oculto:** duas contas na mesma hunt, uma visível e outra oculta, por 30–60 min. Comparar o XP e o ouro ganhos.
5. **24 h:** anotar a memória por conta em 0 h, 1 h, 6 h e 24 h.
6. Registrar os resultados em `docs/benchmarks/`. **Nunca** rodar `bun run benchmark` com o jogo aberto.

## Implementado (branch `perf`)
Entregue, com testes automatizados:
- **P0-3** auditoria de extensões assíncrona (`fs.promises`) e em cache por pasta, versão do manifest e lista de `.js` com tamanho e mtime. `extensions:list` só faz `stat` (nada é relido se nada mudou); Detectar e Adicionar forçam a releitura; toggle e remover usam o cache sem tocar no disco. A janela abre antes: a primeira conta espera a auditoria inicial em segundo plano.
- **P0-4** `session:status` só sai quando o estado muda; `did-start-loading` de subframe é ignorado (o `did-stop-loading` continua destravando o estado). A lateral deriva o `pool` de uma chave em texto, guardada em ref: o ciclo não reinicia por eventos de status.
- **P0-5** `pulse` e `shimmer` finitos; `:root[data-lite]` desliga animações e transições.
- **P1-1** início escalonado: interface, depois a conta em foco (ou a primeira), depois as outras a cada 2,5 s.
- **P1-2** `spellcheck:false` e `devTools: !app.isPackaged` (janela e views).
- **P1-3** lateral: conta selecionada a cada 10 s, pré-aquecimento a cada 5 min, cache do cálculo completo de 3 min (mesma assinatura); sem `setState` quando o retrato não mudou (Caçar e Mercado; no Mercado o acúmulo é renovado a cada 60 s para os anúncios não expirarem).
- **P1-4 e P1-7 / Modo leve** (migração v9: colunas `lite_mode` e `mute_unfocused`, padrão 0): em Gerenciar → Layout. Liga: sem animações, lateral a cada 20 s e sem pré-aquecimento, início em Foco, áudio mutado fora de foco, dica do Modo economia do jogo. "Som só na conta em foco" é independente. Na grade todas as colunas visíveis seguem com som.
- **P1-5** Suspender/Retomar (`session:suspend`/`session:resume`): fecha só a view pelo caminho aguardado, sem tocar na partição. O estado `suspended` é **só em memória**: ao reiniciar o app todas as contas abrem. A coluna fica com o marcador "Conta suspensa" (`.col-suspended`, botão `.col-head .suspend`).
- **P1-6 e P2-4** monitor por conta em Diagnóstico (`diagnostics:processes`, a cada 4 s só com a seção aberta): CPU, memória privada e conjunto de trabalho por conta, hub, GPU e outros. Aviso e botão Recarregar (manual) acima de 2 GB por conta, limite configurável.
- **P2-1** `disable-features=SpareRendererForSitePerProcess` (junta com o que já existir).
- **P2-5/6** cache de `store.list()` (invalidado nas escritas e, via `PRAGMA data_version`, por outra conexão); `arrange()` no resize no máximo a cada ~33 ms, sempre com uma última chamada ao parar; `useLayoutEffect` do indicador com dependências e o listener de resize registrado uma vez.
- Barra de título nativa escondida (overlay nas cores do app) e `AppUserModelId` no Windows.

**Falta medir na máquina real (Windows, app empacotado):**
- **P0-1** se as views ocultas ficam com `visibilityState=hidden`.
- **P0-2** se o jogo progride com a view oculta (`backgroundThrottling`); só então decidir a opção por conta "Manter ativa".
- Os ganhos reais de CPU, GPU e memória de cada item acima (cenários S0–S6 deste documento).
- Não implementados: P2-2 (`--enable-low-end-device-mode`) e P2-7 (extensões por conta).
