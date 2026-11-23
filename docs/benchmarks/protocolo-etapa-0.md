# Protocolo de verificação da Etapa 0

Execute em instalações separadas do Fedora ou Ubuntu e do Windows 11. Registre versões do SO, hardware, resolução, escala de tela, data e versão do app. Antes de utilizar contas, leia integralmente as regras atuais do jogo e respeite todos os limites aplicáveis. Utilize apenas suas contas. Não registre senhas, cookies, tokens ou informações pessoais em evidências.

## Preparação

1. Instale Bun e Node.js e execute `bun install --frozen-lockfile`, `bun run test`, `bun run build` e `bun run start` na pasta do projeto.
2. Não desabilite o sandbox do Electron. Registre erros de inicialização sem incluir dados sensíveis.
3. Registre o resultado de cada item como passou, falhou ou não testado; inclua descrição e horário quando falhar.

## Sessões e autenticação

1. Na sessão 1, entre manualmente pela interface oficial. Registre se o login requer redirecionamento, popup ou SSO e se algum deles é bloqueado. Não tente contornar bloqueios.
2. Selecione 2 sessões. Verifique que a sessão 2 não herda a autenticação da 1. Entre manualmente com outra conta própria, se permitido pelas regras.
3. Selecione 4 sessões e repita a verificação de independência para as demais contas, somente se permitido e disponíveis. Sem quatro contas, marque a validação real como não testada.
4. Alterne grade e foco para cada sessão; verifique que as páginas não recarregam e que as contas continuam independentes.
5. Feche e reabra o aplicativo. Verifique cada sessão, distinguindo persistência de armazenamento de eventual expiração legítima do login.
6. Minimize por um intervalo documentado e restaure. Verifique o estado e comportamento do jogo sem presumir processamento em segundo plano.
7. Redimensione a janela e teste escala HiDPI quando disponível; registre cortes, sobreposições e dimensões inutilizáveis.
8. Registre capturas da grade e foco após ocultar identificadores pessoais. Não envie telas de autenticação ou dados de sessão.

## Medições

Sem DevTools, no mesmo hardware e resolução, meça cenários de referência sem jogos e com 1, 2 e 4 sessões em condições equivalentes e duração fixa. Registre duração, CPU média e p95, memória RSS total e por processo, GPU e rede quando mensuráveis, tempo de inicialização, troca de foco e retomada após minimização. Identifique ferramenta e método de medição. Valores indisponíveis devem ser marcados como não medidos.

## Resultado

O gate só pode ser avaliado com evidências para ambos os sistemas, autenticação permitida, isolamento, persistência, foco, minimização e recursos. Uma falha legítima de autenticação exige revisão da arquitetura; ausência de teste não demonstra falha nem aprovação. Registre os resultados no relatório de viabilidade.
