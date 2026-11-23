# Segurança e privacidade do PokéHub

Este documento diz o que o PokéHub guarda, o que sai do seu computador, o que ele clica no jogo, quais são os limites e como reportar uma falha. Se algo aqui não bater com o que o app faz, é um bug: avise.

## Versões suportadas

Só a **última versão publicada** no [GitHub Releases](https://github.com/joaoviitorsx/pokehub/releases) recebe correções de segurança. O app instalado avisa quando há versão nova (Configurações → Atualizações).

## O que fica guardado no seu computador

Pasta de dados do app: `%APPDATA%\PokeHub` (Windows) ou `~/.config/PokeHub` (Linux; ajustada para permissão `0700`, só o seu usuário).

- **`pokehub.sqlite`**
  - `profiles`: `label` e `emailLabel` (só como identificação, nunca usado para entrar), `characterName`, `colorToken` e datas.
  - `workspace_settings`: modo de início, verificação de atualização, Modo leve, silenciar e preferências da bandeja.
  - `extensions`: pasta da extensão, se está habilitada e os hosts aprovados.
  - `grindolino_*`: tabelas legadas, sem uso (o Professor Grindolino foi removido na v0.1).
  - **Não há senhas.** O PokéHub não pede nem guarda senha de conta nenhuma.
- **`Partitions/pokehub-<uuid>/`**: uma pasta por conta, com os cookies de login, `localStorage`/IndexedDB do jogo, cache e o armazenamento das extensões daquela conta. Quem tem esta pasta tem a sessão da conta. Com os Electron Fuses (a partir da versão que os inclui) os cookies passam a ser **criptografados em disco** com a chave do seu usuário do sistema.
- **`localStorage` da interface** (preferências desta máquina, nada sensível): `pokehub.kits`, `pokehub.side`, `pokehub.captures`, `pokehub.memLimitGb`.
- **`captures.json`**: histórico de capturas lidas do jogo, últimos 7 dias, no máximo 5.000 entradas.

## O que sai do seu computador

- **O jogo** (`pokeidle.io`) com a sua sessão, como em qualquer navegador; e o pedido público de retratos `https://pokeidle.io/tracker/api/sprites?lt=...`, feito pelo app **sem cookies**.
- **`accounts.google.com` / `discord.com`**, só quando você escolhe entrar com essas contas.
- **GitHub Releases** (verificação de atualização): 10 segundos depois de abrir e a cada 6 horas, se a verificação automática estiver ligada. Dá para desligar em Configurações.
- **Chrome Web Store**: a página abre no **seu navegador**, quando você pede para instalar uma extensão.
- **Tráfego das extensões**: a `/hunt` fala com `pokeidleguide.io` e `pokeidle-gg.pages.dev`; qualquer outra extensão só carrega depois que você aprova os hosts que ela acessa.
- **Notificações push do acesso remoto** (só se você ligar o acesso remoto **e** ativar as notificações num celular pareado): o PC faz um `POST` **de saída** ao serviço de push do navegador desse celular (`fcm.googleapis.com` no Chrome/Android, `*.push.apple.com` no Safari/iPhone, `*.push.services.mozilla.com` no Firefox, `*.notify.windows.com` no Edge). O conteúdo vai **cifrado de ponta a ponta** (RFC 8291; o serviço só vê o tamanho e o destino) e é só: tipo do alerta, nome da conta, texto curto (ex.: “Shiny: Pikachu Nv 20 P5”), horário e um atalho dentro do app. Nunca vai e-mail, token, PIN, senha nem dados de pagamento. O endereço de envio é conferido numa lista fixa de hosts (https, porta 443, sem IP, sem redirecionamento, 5 s). A chave privada VAPID (identifica o seu PC perante esses serviços) fica cifrada com o `safeStorage` e nunca sai do PC. Detalhes em `docs/ACESSO-REMOTO.md`.
- **Telemetria e relatório de falhas: nenhum.** O PokéHub não envia métricas, nem de uso, nem de erro.
- A interface do app tem CSP com `connect-src 'none'`: ela mesma não faz `fetch`/XHR/WebSocket.

## O que o PokéHub clica no jogo

Tudo abaixo é a **seu pedido**; nada roda sozinho nem agendado. Regras exatas em `docs/data-sources.md`.

- **Mercado**: o botão "›" da paginação, ao pedir "Ler todas as páginas desta busca": no máximo 30 páginas, só com busca preenchida, no ritmo de uma pessoa, interrompível.
- **Loja (NPC)**, só depois de "Confirmar compra" na janela do app: aba Market, aba Comprar, categoria, botão de compra do item e × (ou Esc) para fechar. Só ouro (Coins); Pokébolas, Poções e Revives.
- **Nunca**: compras com dinheiro real (RMT), gemas, "Vender", Ovos, nem qualquer ação que gaste dinheiro de verdade.
- **Leituras** (sem clique e sem escrever na página): vitrine do Mercado da Comunidade quando a aba está aberta, saldo e itens da Loja, painel de capturas, ranking da extensão `/hunt` e estado de carregamento das contas. Os scripts são constantes; nenhum dado da interface é interpolado neles.

Automação em jogo pode ser vista como violação dos termos: o risco da conta é seu. Leia `docs/data-sources.md`.

## Acesso remoto pela rede de casa

Desligado por padrão; ver `docs/ACESSO-REMOTO.md`. Com ele ligado, o PC escuta só na rede doméstica; as únicas conexões de saída que ele cria são as notificações push descritas em “O que sai do seu computador”, e só para celulares que você pareou e que ativaram as notificações. O histórico de alertas (7 dias, até 1.000) e as assinaturas de push ficam no `pokehub.sqlite`; revogar ou expirar o aparelho apaga as assinaturas e as preferências dele.

### O que o celular pode fazer (R4)

Só aparelhos com **“Pode agir”** (ligado por você no PC, com confirmação do sistema) e só com o **PIN** de 6 dígitos que você definiu no PC (verificado no PC, com bloqueios 15 min → 1 h → 24 h, revogação e desligamento das ações após 10 erros no dia). O celular pode: comprar **pokébolas, poções e revives no Market do jogo, só com ouro**, do catálogo da Loja; recarregar, suspender e retomar contas; ligar/desligar o Modo leve. A Loja automática (R4) **nunca** toca no Mercado da Comunidade nem em gemas/dinheiro real (não existe rota nem seletor para isso). A permissão separada **“Pode controlar a tela”** (R5, descrita abaixo) dá controle total da conta e é outra coisa. O celular também não digita senha nem vê e-mail. Cada compra vale por uma confirmação **emitida pelo PC** (uso único, 60 s, ligada ao hash do plano), o preço é lido de novo no jogo antes de comprar, existe um **teto diário por conta** (padrão 200.000 de ouro, só editável no PC; aumentar pede confirmação do sistema) e toda ação gera aviso no PC, registro de auditoria e, nas compras, notificação push e linha no histórico (`remote_purchases`, sem poda, no `pokehub.sqlite`). “Lembrar o PIN por 10 min” fica só na memória do PC e cai ao revogar, trocar o PIN, bloquear, desligar o acesso ou mudar de rede; compras acima de 50% do teto diário (ou que, somadas às feitas na mesma elevação, passem disso) pedem o PIN sempre. A elevação é por aparelho. O teto conta preço × quantidade comprada (compra não confirmada mantém a reserva).
### Tela remota e controle (acesso remoto, R5)

Com o acesso remoto ligado e um celular pareado, o hub pode **transmitir a imagem de uma conta** por WebSocket na rede de casa e, com **PIN**, deixar o celular **controlar** essa conta. Garantias, todas testadas:

- **Só a view da conta, só o jogo.** A imagem vem de `webContents.capturePage()` da conta (nunca `desktopCapturer`, nunca a janela do hub, nunca outra janela) e só enquanto a URL é exatamente `https://pokeidle.io`; em login do Google/Discord ou qualquer outra origem nada é transmitido. **Campo de senha com foco pausa a imagem** e bloqueia teclas e texto do controle: a senha do jogo nunca passa pelo acesso remoto.
- **WebSocket fechado:** o upgrade confere IP/sub-rede, `Host`, **`Origin` idêntico** (sem ele, recusa), cookie de aparelho válido, subprotocolo `ph.v1`, conta existente e não suspensa, 1 espectador por conta e 2 no total, payload ≤ 64 KB. Revogar, expirar, sair, desligar o acesso remoto, trocar de rede ou sair do app fecham as conexões na hora. Sem dependência nova: o WebSocket é um RFC 6455 mínimo do próprio projeto.
- **Controlar é separado e curto:** exige “pode agir”, PIN verificado no servidor (mesmos bloqueios do PIN) e vale **10 min**, sem renovar sem o PIN, com 2 min de ociosidade e um controlador por conta. A entrada vem de uma lista fechada (clique esquerdo, rolagem, Enter/Backspace/Esc/setas/Tab/Delete, letras e texto), com coordenadas presas à view e 30 eventos/s e 500 caracteres/min; F1–F24, Ctrl/Alt/Meta, DevTools, fechar janela, recarregar, imprimir e navegação ficam **bloqueados**, e a conta só navega em `pokeidle.io` durante o controle.
- **Você vê e corta.** Enquanto alguém vê ou controla, o hub mostra uma faixa (“Celular X está vendo/controlando Y”) e o tooltip da bandeja muda; **Ctrl+Shift+F12** (global, só enquanto há controle) ou o botão **Encerrar controle** cortam na hora. Início e fim (com duração) vão para a auditoria.
- **Limites:** a imagem é uma foto da conta a 1–2 quadros/s; quem roubar a sessão do celular **e** souber o PIN controla a conta por 10 min. Com a janela na bandeja, o hub a mostra invisível (opacidade 0) enquanto alguém assiste, para o Chromium continuar gerando quadros. Detalhes em `docs/ACESSO-REMOTO.md`.

## Como apagar seus dados

- **Uma conta**: Gerenciar → Contas → editar o perfil → apagar o perfil e os dados da sessão (irreversível; pode exigir novo login).
- **Tudo**: feche o PokéHub pela bandeja (Sair), apague a pasta `%APPDATA%\PokeHub` (ou `~/.config/PokeHub`) e desinstale. **O desinstalador mantém a pasta** de propósito (`deleteAppDataOnUninstall: false`), para não apagar seus dados sem aviso; apague-a você mesmo. Isso também remove as preferências da interface (`localStorage`).

## Modelo de ameaça e limites

- **Quem usa o seu usuário do sistema operacional tem as suas sessões.** O PokéHub não protege contra isso (os cookies criptografados dependem da conta do sistema). Use bloqueio de tela e não rode o app em máquina compartilhada.
- **Extensões de terceiros rodam dentro do jogo**, com a sua sessão. A auditoria estática do app (Só leitura / Interage / Acessa outros sites / Bloqueada) é **heurística**: pode errar. Instale só extensões em que confia.
- **Os instaladores ainda não são assinados** (não há certificado de assinatura de código). O Windows mostra o SmartScreen na primeira instalação, e o atualizador não consegue validar o editor. Por isso:
  - os releases são publicados como **rascunho** e revisados à mão antes de ficarem públicos;
  - cada release traz `SHA256SUMS` e atestado de procedência (`actions/attest-build-provenance`).
  - **Risco residual:** quem controlar a conta do GitHub do projeto ou o release publicado pode distribuir um instalador malicioso, e o atualizador o aceitaria. Confira os hashes e o atestado em instalações importantes.
- **Verificação manual:** baixe o instalador e o `SHA256SUMS` do release e compare.
  - Windows (PowerShell): `Get-FileHash .\<instalador>.exe -Algorithm SHA256` e compare com a linha do arquivo em `SHA256SUMS`.
  - Linux: `sha256sum -c --ignore-missing SHA256SUMS`.
  - Procedência: `gh attestation verify <arquivo> --repo joaoviitorsx/pokehub`.

### Assinatura de código (futuro)

Quando houver certificado (por exemplo [SignPath Foundation](https://signpath.org/foundation), gratuito para projetos open source, ou Azure Trusted Signing), configure no `package.json`, dentro de `build.win`, `signtoolOptions.publisherName` (o nome exato do certificado) e a assinatura (`azureSignOptions` ou a integração do SignPath no workflow `release.yml`). Com `publisherName`, o `electron-updater` passa a verificar a assinatura Windows antes de instalar. Só então troque `releaseType` de `draft` para `release`: o teste `spike/tests/supply-chain.test.ts` falha se `releaseType` for `release` sem `publisherName`.

### Electron Fuses

O build desliga `runAsNode`, `NODE_OPTIONS` e `--inspect*`, e liga a criptografia de cookies, a validação de integridade do `app.asar` e `onlyLoadAppFromAsar`. `grantFileProtocolExtraPrivileges` **continua ligado** porque a interface é carregada por `file://` (migrar para um protocolo próprio é trabalho futuro). No build instalado, o app também se encerra se iniciado com `--remote-debugging-port`, `--remote-debugging-pipe` ou `--inspect*`. Confira com `node scripts/check-fuses.cjs` (ou `npx @electron/fuses read --app <executável>`).

**Atenção: a criptografia de cookies é um caminho sem volta.** Ao atualizar para a primeira versão com ela, os cookies existentes são regravados criptografados e talvez seja preciso **entrar de novo** em alguma conta uma vez. Voltar a uma versão sem a criptografia deixa o armazenamento de cookies inutilizável (novo login).

## Como reportar uma vulnerabilidade

Use **GitHub → aba Security → "Report a vulnerability"** em [joaoviitorsx/pokehub](https://github.com/joaoviitorsx/pokehub/security/advisories/new). O relato é privado. Meta de resposta: **7 dias**. Não abra issue pública com detalhes antes da correção.

## Garantias do build

- Dependências instaladas com `bun install --frozen-lockfile` (Bun 1.4.4, Node 22.20.1 fixos).
- Todas as GitHub Actions fixadas por SHA de commit (teste automático e Dependabot semanal).
- O job de build roda só com `contents: read` e sem credencial persistida; o job que publica é separado, com `contents: write`, e cria apenas **rascunho**.
- Typecheck, testes e verificação dos Fuses antes de cada release; `SHA256SUMS` e atestado de procedência anexados.
- Renderer com CSP restritiva (`object-src`, `base-uri`, `form-action`, `frame-src` e `connect-src` bloqueados).
