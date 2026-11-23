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
