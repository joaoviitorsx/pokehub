# Etapa 0 — descoberta e viabilidade

Data: 2026-11-10. Resultado do gate: **pendente / não autorizado avançar**, por ausência de evidência, não por constatação de incompatibilidade.

Ambiente disponível: Fedora 44 x86_64, kernel 7.2.15-200.fc44, Node 22.23.1, pnpm 10.34.5, Electron 44.5.1. Ambiente de execução limitado por sandbox. Windows indisponível.

| Verificação | Resultado |
|---|---|
| Build e TypeScript | `pnpm build`: aprovado |
| Layout | `pnpm test`: quatro testes passaram; isso não testa o Electron |
| Inicialização gráfica Linux | falhou antes da janela: `sandbox_host_linux.cc ... Operation not permitted` |
| Login, SSO e quatro contas | não executados |
| Isolamento e persistência reais | não executados |
| Foco, resize, minimização, DPI | não executados em janela real |
| Windows | não executado |
| Screenshots | indisponíveis: janela não abriu |
| CPU, RSS, GPU, rede, inicialização, foco e minimização para 1/2/4 | não medidos |
| Regras atuais | página consultada sem conteúdo de regras acessível à ferramenta; pendente leitura visual integral |

## Riscos e próximos testes

1. Login pode exigir redirecionamento ou popup bloqueado pela política conservadora do spike. Identificar provedores legítimos e avaliar fluxo permitido sem contornar restrições.
2. Executar em máquinas Linux e Windows reais com sandbox habilitado. Verificar sessão A independente de B, persistência após reiniciar, 1/2/4 contas próprias dentro dos limites atuais, foco sem reload, falha isolada, resize, DPI e funcionamento minimizado.
3. Medir com instalação limpa, sem DevTools, mesmo hardware e período fixo: baseline sem jogos e 1/2/4 sessões, CPU média/p95, RSS por processo e total, GPU e rede quando disponíveis, cold start, foco e recuperação de minimização. Registrar hardware, resolução, duração e capturas sem dados sensíveis.
4. O spike não é produto: faltam estados de erro individuais, testes de integração/segurança e revisão visual. `undici` foi fixado em 7.29.0 por disponibilidade offline; revisar dependências e remover override quando houver acesso ao registro.

## Ferramentas de desenvolvimento

Graphify CLI 0.9.30 instalado; skill não registrada no catálogo desta sessão, mas instruções encontradas no pacote instalado. Executado `GRAPHIFY_BACKEND=none graphify extract . --code-only --no-cluster` e consulta local: 81 nós e 89 relações; não é auditoria completa nem garantia de ausência de violações. Saída local em `graphify-out/`, ignorada pelo Git.

Ponytail não consta no catálogo nem como executável local. Suas instruções oficiais foram consultadas e aplicadas manualmente; comandos de revisão/auditoria não foram executados. Instalação de skill no diretório de usuário não é possível no sandbox atual.

O [protocolo de teste](protocolo-etapa-0.md) detalha as evidências necessárias para concluir o gate.

## Incremento do protótipo — 2026-11-10

A pedido do usuário, o desenvolvimento do hub continuou antes da conclusão do gate. O protótipo inclui perfis persistentes em SQLite, até quatro partições por UUID, grade/foco e recarga por perfil. Esta implementação não altera o estado do gate: autenticação real, isolamento, interface e desempenho ainda exigem evidências. A navegação externa e popups são bloqueados; isso pode impedir login.

Verificações adicionais: dez testes automatizados passaram; o runtime Node do Electron 44.5.1 abriu SQLite e criou/leu um perfil; `pnpm build` passou. Uma nova tentativa de abrir a janela com `pnpm start` falhou com `sandbox_host_linux.cc ... Operation not permitted`. Sem screenshots ou benchmark desktop. Nenhum teste no Windows. A exclusão de perfil não remove dados da partição, que permanecem órfãos até limpeza fora do aplicativo.

## Limpeza de sessão — 2026-11-10

O editor de um perfil ativo oferece limpeza explícita da sessão com confirmação. O processo principal fecha a view, solicita limpeza do armazenamento e cache da partição correspondente e reabre a view. Em falha, avisa que a limpeza pode ter sido parcial. A remoção do perfil continua separada e não limpa sua partição; partições de perfis já removidos não são acessíveis pela interface. A sequência foi testada com operações simuladas; a limpeza efetiva do Chromium e a interface ainda precisam de teste gráfico real.

## Recuperação e interface — 2026-11-10

Foi adicionada a reabertura individual da view mantendo a partição, e falhas na abertura são sinalizadas no perfil para permitir recuperação. Foram ajustados estados de carregamento e falha ao ler perfis, foco e feedback visual dos controles. A skill Impeccable não está instalada; suas instruções públicas de refinamento de interfaces operacionais foram consultadas, mas seu launcher/detector e a revisão visual em janela não puderam ser executados. Testes automatizados cobrem regras de recuperação com operações simuladas, não o ciclo real de `WebContentsView`.

## Ciclo de vida e limite — 2026-11-10

A criação de views libera os recursos quando a configuração ou anexação falha; falhas adicionais de limpeza são reportadas sem interromper a abertura das demais sessões. O encerramento tenta fechar cada view separadamente. Testes com operações simuladas exercitam esses ramos e um teste SQLite usa duas conexões ao mesmo arquivo para verificar o limite de quatro perfis em operações sequenciais. Concorrência real e ciclo de vida do Electron em janela permanecem pendentes. Nesta execução, `bun run test` passou com 20 testes, `bun run typecheck` e `bun run build` passaram com dependências previamente instaladas; não houve nova medição de desempenho nem validação de instalação Bun limpa.

## Estados de carregamento — 2026-11-10

Erros `ERR_INTERNET_DISCONNECTED` são apresentados como ausência de conexão; cancelamentos `ERR_ABORTED` não são tratados como falhas. Outros erros permanecem genéricos, incluindo falha de resolução DNS, sem presumir a causa. A classificação foi testada isoladamente, sem registrar URL ou dados de autenticação. Os eventos reais de carregamento, queda de rede e retomada ainda exigem verificação gráfica. Referências: https://www.electronjs.org/docs/latest/api/web-contents e https://chromium.googlesource.com/chromium/+/refs/heads/trunk/net/base/net_error_list.h .

## Atalhos de foco — 2026-11-10

Ctrl+0 seleciona a grade e Ctrl+1 a Ctrl+4 selecionam os perfis existentes, respeitando a ordem exibida. A lógica ignora outras combinações e repetição, e os atalhos ficam desativados durante edição ou limpeza de sessão. Os listeners foram registrados no renderer local e nas views remotas, mas a captura de teclado, os conflitos com o jogo e a acessibilidade ainda exigem testes em janela real no Linux e Windows. O teste automatizado cobre a seleção e rejeição de combinações, não a entrega de eventos pelo Electron. Não houve benchmark de interação.

## Integração e empacotamento — 2026-11-10

Adicionados foco automático em janela pequena, remoção explícita de perfil e dados após confirmação e bloqueio de segunda instância. Testes de integração do processo principal usam SQLite real, mas simulam Electron: quatro perfis, quinta criação rejeitada, partições distintas, IPC de conteúdo remoto rejeitado, foco sem recriar views e bloqueio de limpeza concorrente com remoção. Não demonstram isolamento do Chromium, concorrência entre processos ou funcionamento real da janela.

Um AppImage Linux x64 de 121 MiB foi construído via `bun run dist:linux` com Electron 44.5.1 local, configuração do projeto e electron-builder 26.15.3 de uma instalação temporária baseada em cache. O runtime da distribuição descompactada foi executado em modo Node e abriu SQLite; a janela e o jogo não foram executados. O AppImage usa ícone padrão e não é assinado. O binário temporário do builder utilizou dependências antigas disponíveis em cache para essa única construção; o lockfile do projeto referencia versões corrigidas. Até uma reconstrução limpa em rede, este artefato é somente experimental e não deve ser tratado como release. Nenhum instalador Windows foi criado ou testado; `dist:win` é configuração não validada. Não houve medição de CPU, memória ou latência das sessões.

## Configurações, diagnóstico e testes — 2026-11-10

A versão 2 do banco acrescenta uma preferência de abertura em grade ou foco, em migração transacional não destrutiva; testes cobrem migração da versão 1, preservação de perfis e rollback em falha. Diagnóstico local sob demanda usa métricas dos processos do Electron, incluindo páginas do jogo; a primeira leitura de CPU não é apresentada como valor medido, e não se trata de benchmark. Alterações não salvas recebem confirmação antes de mudar de tela ou fechar a janela.

Foram preparados smoke tests Electron com quatro views e cookies sintéticos em diretório temporário e workflow Linux/Windows. A tentativa local foi bloqueada pelo sandbox gráfico antes da janela; não há resultado de CI nem validação real dos fluxos. Um teste de DOM simulado passou para foco, diagnóstico, configurações, proteção contra descarte e remoção; não é screenshot nem validação visual. Foi executado ESLint 10 externamente com um conjunto limitado de regras, sem erros; o projeto ainda não possui lint instalado/configurado. A tentativa de revisão visual com Chromium de teste também foi bloqueada pelo sandbox.

AppImage experimental atualizado com a implementação atual; foi gerado com builder em cache, incluindo dependências temporárias antigas descritas no ADR de Bun, sem assinatura nem verificação gráfica. A instalação independente do grafo Bun atual e os builds Windows continuam pendentes.
