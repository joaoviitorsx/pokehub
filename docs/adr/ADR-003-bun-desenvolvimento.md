# ADR-003 — Bun para desenvolvimento

Status: adoção parcial, instalação limpa e plataformas pendentes. Bun 1.3.14; 2026-11-10.

O Bun passa a ser o gerenciador e executor de scripts preferido. `bun.lock` foi migrado do `pnpm-lock.yaml` com `bun pm migrate`; o override existente de undici foi transferido para `overrides` no `package.json`. O lockfile pnpm permanece até uma instalação limpa usando Bun ter sido validada; alterações futuras de dependências devem ser feitas com Bun e esta retenção não torna os dois lockfiles automaticamente sincronizados.

O Electron permanece como runtime do aplicativo. Não há dependência do executável Bun no código distribuído. O Electron 44 obtém seu binário na primeira execução; a instalação e o download precisam de rede ou cache apropriado. Seu Node embutido fornece `node:sqlite`. O projeto agora usa electron-builder; não há módulos nativos adicionais de SQLite. A documentação do electron-builder admite instalação com Bun, mas builds por plataforma e eventuais addons nativos devem ser testados ao configurar a distribuição.

`bun run test` mantém Vitest executado em Node. A experiência com `bun test` executou oito testes puros mas falhou ao carregar `node:sqlite` na versão 1.3.14; não substituir os testes de persistência por testes Bun até comprovar equivalência. O futuro domínio do Hunt Analyzer poderá avaliar `bun test` separadamente, mantendo independência de Electron.

Validação nesta máquina: `bun pm migrate`; validação em cópia isolada com `bun install --frozen-lockfile --lockfile-only`; `bun run typecheck`, `bun run test` (12 testes) e `bun run build` com dependências previamente instaladas pelo pnpm. Uma instalação limpa isolada falhou porque a rede para o registro não estava acessível. `bun run dev` não pôde abrir socket local (EPERM); `bun run start` foi bloqueado pelo sandbox gráfico (Operation not permitted). Não existe script de lint. Nada disso comprova instalação limpa, login ou execução gráfica em Windows/Linux.

Fontes: https://bun.com/docs/pm/cli/install, https://bun.com/docs/pm/lifecycle, https://www.electronjs.org/docs/latest/tutorial/installation, https://www.electron.build/docs/ .

## Correção do lockfile migrado

Em instalação isolada com cache local, a primeira versão migrada pelo Bun 1.3.14 não criava `node_modules/.bin`: os metadados `bin` não estavam no lockfile. Os campos foram recuperados dos `package.json` das versões já instaladas e preservam as versões e hashes originais. `bun install` e `bun install --frozen-lockfile` em diretórios temporários instalaram 64 pacotes e criaram os executáveis; typecheck, 24 testes e build passaram na instalação congelada. O binário do Electron foi obtido de cache local e executado em modo Node, confirmando `node:sqlite`.

O cache usado nessa verificação foi montado a partir dos pacotes anteriormente instalados pelo pnpm, portanto não demonstra download limpo do registro. O download do pacote opcional Rollup musl falhou por bloqueio de rede; o teste foi em Fedora x64 glibc e não valida Linux musl nem Windows. Manter o lockfile pnpm de referência até validar instalação independente com rede e as plataformas.

## Empacotamento experimental

O projeto agora declara electron-builder 26.15.3 e scripts Linux AppImage e Windows NSIS. Um AppImage Linux foi construído com o builder de um cache temporário e distribuição Electron local; o builder temporário utilizou `brace-expansion` em versões anteriores às correções de segurança de setembro de 2026. O lockfile do projeto fixa as versões corrigidas 1.1.21 e 5.0.12. A instalação completa do novo grafo em rede e a reconstrução com o próprio lockfile permanecem obrigatórias antes de release. Nenhum addon nativo externo é utilizado; `npmRebuild` está desativado e precisa de revisão caso isso mude. Fontes: https://github.com/advisories/GHSA-q2hr-2g5m-vwhr e https://www.electron.build/v26/docs/linux/ .
