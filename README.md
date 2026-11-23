# PokéHub — protótipo desktop

Protótipo local de workspace para até quatro contas próprias do PokéIdle. A compatibilidade do jogo e a autenticação dentro do Electron ainda precisam ser verificadas em uma sessão gráfica real, no Linux e no Windows. Leia o [relatório de viabilidade](docs/benchmarks/etapa-0.md) antes de utilizar contas.

## Executar

Instale Bun 1.3.14 e Node.js 22.12 ou superior. No diretório do projeto:

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Os mesmos comandos são usados no Linux e no Windows. A instalação precisa baixar as dependências; o Electron 44 baixa seu binário quando executado pela primeira vez. Em Linux, é necessário um ambiente gráfico e suporte ao sandbox do Chromium. Execute o aplicativo como usuário comum.

Em Configurações, escolha se o aplicativo deve iniciar em grade ou com a primeira conta em foco. O diagnóstico local apresenta memória e CPU dos processos do aplicativo e das páginas do jogo; a CPU exige duas amostras com pelo menos um segundo de intervalo.

Crie um perfil usando o nome e o e-mail apenas como identificação; o aplicativo não pede nem armazena senhas. Entre manualmente na página oficial do jogo. A barra superior permite abrir a grade, focar cada perfil, editar, recarregar e reabrir individualmente a sessão. Use Ctrl+0 para a grade e Ctrl+1 a Ctrl+4 para focar perfis existentes; os atalhos ficam desativados durante a edição de perfil. Reabrir recria a view usando a mesma partição, sem limpar o login. No editor do perfil, escolha entre remover somente o registro ou apagar o perfil e os dados locais da sessão. É possível limpar a sessão separadamente. A limpeza é irreversível e pode exigir novo login. Perfis removidos anteriormente sem limpeza deixam dados de sessão que não podem ser apagados pela interface.

Os perfis são armazenados em SQLite dentro de `app.getPath('userData')`. As sessões usam partições persistentes distintas, identificadas por UUID. Não há sincronização entre máquinas. A persistência do login depende do jogo e ainda não foi validada com contas reais.

A navegação remota é restrita à origem oficial; popups, permissões do site e outras origens são bloqueados. Isso pode impedir alguns fluxos de autenticação ou funções do jogo. Não tente contornar bloqueios: registre o problema para revisão da arquitetura. Antes de testar, confira as regras vigentes e use apenas contas próprias respeitando os limites totais do jogo.

## Verificação

`bun run test` executa testes em Node para perfis, migração SQLite, sessões simuladas, navegação, arquitetura e limpeza do build. `bun run test:electron` executa um smoke test gráfico com dados sintéticos e diretório temporário; no Linux sem tela, use `xvfb-run -a bun run test:electron`. `bun run typecheck` verifica os tipos; `bun run build` verifica os tipos e compila o protótipo. `bun run dev` inicia apenas o servidor Vite, sem iniciar ou conectar o Electron; para executar o aplicativo use o build e `bun run start`. Ainda não há script de lint configurado. Os testes não substituem a [verificação manual](docs/benchmarks/protocolo-etapa-0.md) com sessões reais, nem testes no Windows. Não há Hunt Analyzer, analytics ou automação de ações de jogo.

O projeto usa `bun.lock` como lockfile principal. O `pnpm-lock.yaml` anterior foi mantido apenas como registro histórico; ele não contém o electron-builder e não está sincronizado com o projeto atual. Uma instalação isolada com cache gerado a partir dos pacotes existentes passou no Linux x64 glibc; ela não substitui a validação pela rede. Os testes continuam em Vitest/Node porque `bun test` não carregou `node:sqlite` neste ambiente. O aplicativo distribuído usa o runtime do Electron, não o executável Bun. Detalhes em [adoção do Bun](docs/adr/ADR-003-bun-desenvolvimento.md).

## Empacotamento experimental

Após uma instalação completa das dependências, `bun run dist:linux` gera um AppImage Linux e `bun run dist:win` gera um instalador NSIS no Windows. São necessárias as ferramentas e downloads de cada plataforma; não há assinatura de código. Um [AppImage experimental](release/PokeHub-0.0.0.AppImage) para Linux x64 foi gerado com ferramentas e binários em cache. Ele ainda não foi validado graficamente nem com contas reais; usa o ícone padrão do Electron. O Windows ainda não foi empacotado ou testado.

O empacotamento usa o Electron, não inclui o executável Bun e não recompila addons nativos, pois o SQLite usado é integrado ao Node do Electron. Qualquer futura dependência nativa exige revisar essa configuração.

Para retomar o desenvolvimento, consulte [o ponto de retomada](docs/RETOMADA.md).
