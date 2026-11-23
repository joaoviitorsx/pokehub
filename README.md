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

As contas aparecem como colunas lado a lado, cada uma com um cabeçalho (cor, nome, estado, focar, recarregar e reabrir); se a janela estreitar, as colunas quebram em linhas. O Professor Grindolino foi removido na v0.1: as tabelas `grindolino_*` continuam no banco local, sem uso, para não apagar dados existentes.

Os perfis são armazenados em SQLite dentro de `app.getPath('userData')`. As sessões usam partições persistentes distintas, identificadas por UUID. Não há sincronização entre máquinas. A persistência do login depende do jogo e ainda não foi validada com contas reais.

A navegação remota é restrita à origem oficial; popups, permissões do site e outras origens são bloqueados. Isso pode impedir alguns fluxos de autenticação ou funções do jogo. Não tente contornar bloqueios: registre o problema para revisão da arquitetura. Antes de testar, confira as regras vigentes e use apenas contas próprias respeitando os limites totais do jogo.

## Verificação

`bun run test` executa testes em Node para perfis, migração SQLite, sessões simuladas, navegação, arquitetura e limpeza do build. `bun run test:electron` executa um smoke test gráfico com dados sintéticos e diretório temporário; no Linux sem tela, use `xvfb-run -a bun run test:electron`. `bun run typecheck` verifica os tipos; `bun run build` verifica os tipos e compila o protótipo. `bun run dev` inicia apenas o servidor Vite, sem iniciar ou conectar o Electron; para executar o aplicativo use o build e `bun run start`. Ainda não há script de lint configurado. Os testes não substituem a [verificação manual](docs/benchmarks/protocolo-etapa-0.md) com sessões reais, nem testes no Windows. Não há Hunt Analyzer, analytics ou automação de ações de jogo. Única exceção: na aba Mercado da lateral, o botão “Ler todas as páginas desta busca” aperta só “próxima página” (no ritmo de uma pessoa, máx. 30 páginas, só com busca preenchida e interrompível) para somar os anúncios ao ranking; não compra, não anuncia e não abre anúncios (detalhes em [docs/data-sources.md](docs/data-sources.md)). Segunda exceção: a aba Loja da lateral compra no Market NPC do jogo (só ouro/Coins; Pokébolas, Poções e Revives) clicando na interface do próprio jogo, **sempre depois de uma janela de confirmação** com item, quantidade, preços e ouro antes/depois; nunca automática nem agendada, uma operação por conta, 1,2 s entre compras, preço e saldo reconferidos no jogo antes do clique. Regras exatas em [docs/data-sources.md](docs/data-sources.md#loja-rápida--lateral-loja-compra-no-market-npc-do-jogo).

O projeto usa `bun.lock` como lockfile principal. O `pnpm-lock.yaml` anterior foi mantido apenas como registro histórico; ele não contém o electron-builder e não está sincronizado com o projeto atual. Uma instalação isolada com cache gerado a partir dos pacotes existentes passou no Linux x64 glibc; ela não substitui a validação pela rede. Os testes continuam em Vitest/Node porque `bun test` não carregou `node:sqlite` neste ambiente. O aplicativo distribuído usa o runtime do Electron, não o executável Bun. Detalhes em [adoção do Bun](docs/adr/ADR-003-bun-desenvolvimento.md).

## Empacotamento experimental

Após uma instalação completa das dependências, `bun run dist:linux` gera um AppImage Linux e `bun run dist:win` gera um instalador NSIS no Windows. São necessárias as ferramentas e downloads de cada plataforma; não há assinatura de código. Um [AppImage experimental](release/PokeHub-0.0.0.AppImage) para Linux x64 foi gerado com ferramentas e binários em cache. Ele ainda não foi validado graficamente nem com contas reais; usa o ícone padrão do Electron. O Windows ainda não foi empacotado ou testado.

O empacotamento usa o Electron, não inclui o executável Bun e não recompila addons nativos, pois o SQLite usado é integrado ao Node do Electron. Qualquer futura dependência nativa exige revisar essa configuração.

Para retomar o desenvolvimento, consulte [o ponto de retomada](docs/RETOMADA.md).

## Atualizações e releases

O aplicativo instalado verifica atualizações no GitHub Releases (`joaoviitorsx/pokehub`) 10 segundos depois de abrir e a cada 6 horas; é possível desligar a verificação automática ou verificar na hora em Configurações → Atualizações. Quando há versão nova, aparece o selo "Atualização x.y.z" na barra superior: o clique baixa (com progresso) e depois "Reiniciar e atualizar" instala. Fora do app empacotado (`bun run start`, desenvolvimento) o atualizador fica desativado.

Para publicar uma versão:

1. Suba `version` em `package.json` (ex.: `0.1.1`) e faça o commit.
2. Crie a tag com o mesmo número e envie: `git tag v0.1.1 && git push origin v0.1.1`.
3. O workflow `.github/workflows/release.yml` roda typecheck e testes, gera o instalador NSIS (Windows) e o AppImage (Linux) e os publica no release da tag junto com `latest.yml` e `latest-linux.yml`. Para publicar por fora do CI, use `GH_TOKEN=<token> bun run release:win` ou `release:linux`.

A primeira instalação é manual (baixe o instalador do release); as seguintes se atualizam pelo próprio aplicativo. Sem assinatura de código, o Windows mostra o SmartScreen ("Windows protegeu o computador") só na primeira instalação: "Mais informações" → "Executar assim mesmo". No Linux a atualização automática só funciona quando o app roda como AppImage. Não altere `productName` na raiz do `package.json`: isso mudaria a pasta de dados do usuário.

## Atalhos e gerenciamento

- Ctrl+0 grade; Ctrl+1 a Ctrl+4 focam uma conta; Ctrl+H abre/fecha “Onde caçar?” (vale na grade, no foco e na conta expandida).
- Expandir uma conta: botão no cabeçalho da coluna, duplo clique no cabeçalho ou Ctrl+Shift+Enter (funciona de qualquer lugar, inclusive com o foco dentro do jogo; usa a conta da página que recebeu a tecla, ou a coluna sob o ponteiro na barra). Esc ou Ctrl+Enter, na barra e nos cabeçalhos, e o mesmo botão voltam à grade. As sessões não recarregam.
- O botão da engrenagem (“Gerenciar”) reúne Contas, Extensões, Atualizações, Layout e Diagnóstico.
- Extensões que acessam outros sites (veredito “Acessa outros sites”) só carregam depois que você permite a lista exata de hosts; a /hunt já vem com pokeidleguide.io e pokeidle-gg.pages.dev aprovados.
