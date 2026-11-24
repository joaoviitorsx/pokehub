# PokéHub

Workspace desktop (Electron 44 + React 19 + TypeScript) para até quatro contas próprias do [PokéIdle](https://pokeidle.io), lado a lado, cada uma com login e armazenamento separados. Não é afiliado ao jogo. Antes de usar, confira as regras vigentes do jogo e respeite o limite de contas.

Segurança, privacidade, o que o app guarda, envia e clica no jogo: leia o **[SECURITY.md](SECURITY.md)**.

## Recursos

- **Colunas**: cada conta é uma coluna com cabeçalho (cor, nome, estado, focar, expandir, recarregar, reabrir e suspender). Modos Grade e Foco, com atalhos (Ctrl+0 grade, Ctrl+1 a Ctrl+4 foco, Ctrl+H lateral, Ctrl+Shift+Enter expandir).
- **Assistente (lateral)**, com cinco abas:
  - **Caçar**: ranking de hunts lido da extensão `/hunt` (XP/h, ouro/h, Shiny/h), com retratos.
  - **Mercado**: leitura e pontuação (custo-benefício) da vitrine do Mercado da Comunidade; leitura assistida de várias páginas, a pedido. Também põe um **selo de custo-benefício em cada card do RMT** (nota 0–100, "Melhor" no topo da busca; compacto se a Smart Market estiver ativa; desligável).
  - **Loja**: compra de Pokébolas, Poções e Revives no Market NPC, sempre depois de uma janela de confirmação.
  - **Capturas**: feed e alertas das capturas, com histórico de 7 dias.
  - **Twitch**: vincule **uma conta da Twitch por conta do jogo** e o PokéHub assiste ao canal escolhido em segundo plano (janela oculta, muda, 160p) para acumular os pontos do canal; mostra o saldo, os pontos ganhos na sessão e se a live está no ar. Coleta do baú opcional por conta; o resgate dos boosters é sempre seu, em **Recompensas**. Funciona com o PokéHub aberto ou na bandeja.
- **Acesso remoto (opcional, desligado por padrão)**: veja as contas, capturas e alertas pelo celular na rede de casa (HTTPS próprio, pareamento por código + confirmação no PC) e, com “Pode agir” e PIN, compre na Loja (só ouro, com teto diário), recarregue/suspenda contas e ligue o Modo leve. No celular (PWA): alertas e notificações push (R3), ações com PIN (R4) e **tela ao vivo** da conta (R5). Ver a tela é uma coisa; **controlar** a conta exige a permissão separada “Pode controlar a tela”, com PIN, 10 min e faixa visível no PC. Detalhes em `docs/ACESSO-REMOTO.md` e `SECURITY.md`.
- **Extensões** de navegador (Manifest V3) carregadas nas sessões, com **auditor** estático (Só leitura / Interage com a página / Acessa outros sites / Bloqueada) e aprovação dos hosts externos. A `/hunt` vem catalogada.
- **Atualizações** automáticas pelo GitHub Releases (verificação a cada 6 h, desligável).
- **Bandeja** do sistema, **Modo leve** (menos CPU/memória), **suspender** contas e **diagnóstico** local de memória e CPU.
- Perfis em SQLite local; **nenhuma senha é guardada** e não há telemetria.

## Executar

Requisitos: [Bun](https://bun.sh) 1.4.4 e Node.js 22.12 ou superior.

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

No Linux é preciso ambiente gráfico e suporte ao sandbox do Chromium; execute como usuário comum. Crie um perfil (nome e e-mail só como identificação) e entre manualmente no jogo. `bun run dev` sobe só o Vite (para a interface); o app completo usa o build e `bun run start`.

## Verificação

```sh
bun run typecheck
npx vitest run && bun run test   # testes (Vitest + Node)
bun run lint
bun run build
bun run test:electron            # smoke gráfico (no Linux sem tela: xvfb-run -a ...)
```

Os testes não substituem a [verificação manual](docs/benchmarks/protocolo-etapa-0.md) com sessões reais. A decisão de usar Bun está em [ADR-003](docs/adr/ADR-003-bun-desenvolvimento.md); o `bun.lock` é o lockfile (o `pnpm-lock.yaml` é só histórico). Para retomar o desenvolvimento: [docs/RETOMADA.md](docs/RETOMADA.md). Fontes de dados e o que o app clica: [docs/data-sources.md](docs/data-sources.md).

## Empacotamento e releases

`bun run dist:win` (instalador NSIS) e `bun run dist:linux` (AppImage) geram os instaladores em `release/`; o CI faz isso nas duas plataformas. **Os instaladores ainda não são assinados**: o Windows mostra o SmartScreen na primeira instalação ("Mais informações" → "Executar assim mesmo"). No Linux a atualização automática só funciona como AppImage. Não altere `productName` no `package.json`: mudaria a pasta de dados.

Node: o CI usa **24.16.0** (igual ao desenvolvimento local; precisa existir em nodejs.org/dist). O `node:sqlite` vem embutido no Node do Electron, então não há módulo nativo para recompilar (`npmRebuild: false`).

**Smoke do app empacotado** (`bun run test:packaged`, também no CI em Windows e Linux): abre `release/*-unpacked/PokeHub[.exe]` com uma pasta de dados temporária, sem perfis, e espera ele encerrar sozinho; confere em `smoke-result.json` (`ok`, `version`, `uiLoaded`, `dbVersion`, `errors`). O app só aceita isso com `POKEHUB_SMOKE=1` **e** `POKEHUB_SMOKE_DIR` apontando para uma pasta já existente DENTRO da pasta temporária do sistema (`POKEHUB_SMOKE_EXIT_MS` define o prazo; sem as duas variáveis tudo é ignorado e os dados reais são usados). Nenhuma chave de linha de comando é aceita. No Linux o sandbox do Chromium fica ligado; o CI só dá `chrome-sandbox` root:4755 ao app descompactado.

O desinstalador do Windows mantém `%APPDATA%PokeHub` (seus dados); a instalação é por usuário, com escolha de pasta e atalhos na área de trabalho e no menu Iniciar.

Para publicar uma versão:

1. Suba `version` no `package.json` e faça o commit.
2. Crie e envie a tag igual: `git tag v0.1.1 && git push origin v0.1.1`.
3. O workflow `.github/workflows/release.yml` compila, testa e confere os Fuses (job `build`, só leitura) e o job `publish` cria um **rascunho** de release com os instaladores, `latest*.yml`, blockmaps e `SHA256SUMS`, mais atestado de procedência.
4. Revise o rascunho e publique-o manualmente. Como conferir os hashes: [SECURITY.md](SECURITY.md#modelo-de-ameaça-e-limites).

## Notas de versão (segurança)

- **Cookies criptografados em disco** (Electron Fuse `EnableCookieEncryption`): é um caminho sem volta e pode exigir entrar de novo nas contas uma vez após a atualização. Também desligados: `runAsNode`, `NODE_OPTIONS` e `--inspect`; o app instalado recusa depuração remota.
- Releases passam a ser publicados como rascunho e revisados à mão (sem assinatura de código ainda). Detalhes e risco residual em [SECURITY.md](SECURITY.md).
