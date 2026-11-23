# Acesso remoto pelo celular — plano (2026-11-23)

## Decisões do usuário (2026-11-23)
- **Rede:** só no Wi-Fi de casa (LAN). Nada de Tailscale ou Cloudflare por enquanto.
- **Vínculo:**
  1. O hub mostra um **código de pareamento** com 8 caracteres, válido por 2 min, junto com o endereço `https://<ip-do-pc>:<porta>` e o QR desse endereço.
  2. O celular abre o endereço e digita o código.
  3. O PC mostra o pedido **"Permitir <navegador/aparelho>?"** e o usuário precisa **aceitar no PC**.
  4. Só então o aparelho recebe o token e entra na lista de dispositivos, onde pode ser revogado.
- **Tela remota:** ver e mexer. O modo Controlar exige PIN e expira em 10 min.
- **Alertas:** Web Push. Exige HTTPS confiável, então o hub gera uma **CA local própria** (chave guardada só no PC) e um certificado para o IP da LAN. Na primeira vez, o usuário instala a CA no celular seguindo um guia passo a passo com QR, para Android e iOS. Depois disso, a PWA fica "instalável" e o push chega mesmo fora de casa: o PC envia via o serviço de push do navegador do celular (FCM/APNs), sempre de saída, sem abrir porta. Chaves VAPID geradas localmente.
- **PC acordado:** `powerSaveBlocker('prevent-app-suspension')` enquanto o acesso remoto estiver ligado e houver contas abertas.
- **Segurança da LAN:**
  - o servidor escuta só nos IPs privados da rede de casa (10/8, 172.16/12, 192.168/16) e recusa qualquer outro IP de origem;
  - o firewall do Windows pergunta na primeira vez, e o hub explica que a rede deve ser marcada como **Privada**;
  - o acesso desliga sozinho se a rede ativa mudar para uma desconhecida (perfil Público ou SSID diferente, quando detectável).

(O restante deste documento continua valendo; as opções Tailscale e Cloudflare ficam para o futuro.)

## PokéHub Mobile: gerenciamento completo para farmar (2026-11-23)

O usuário quer gerenciar no celular tudo o que o jogo permite, como no PC.

### Princípio: duas camadas

- **Atalhos nativos**, rápidos e feitos para toque, para as tarefas repetitivas do farm. Usam as mesmas funções do hub do PC, com as mesmas travas.
- **Tela ao vivo + Controlar**, para **qualquer** outra coisa. O celular vê a conta e toca nela, e o hub repassa os toques para a página do jogo. Assim nenhuma função do jogo fica de fora, nem as que o hub não conhece ou que surgirem em atualizações.

### Navegação (barra inferior, uma mão)

1. **Contas**
   - Cartões das 4 contas com estado, Pokémon em campo, hunt, XP/h, ouro e alertas (sem poção, caiu).
   - Toque no cartão abre a conta.
   - Arrastar para o lado: Recarregar ou Suspender.
2. **Conta** (por conta), com abas:
   - **Jogo:** tela ao vivo. O botão "Controlar" pede o PIN e vale por 10 min. Tem zoom e pan com pinça, teclado virtual para chat e campos, e botões grandes para Voltar, Fechar janela (Esc) e Rolar.
   - **Capturas:** feed da conta.
   - **Equipe:** dados do /hunt.
   - **Onde caçar:** ranking.
3. **Loja**
   - Estoque das contas, kits com "Repor" em 1 toque e compra avulsa (item, quantidade, ×10/×100).
   - Mostra sempre a tela de confirmação (itens, total e saldo depois) e pede o PIN.
   - Pode aplicar em várias contas de uma vez.
4. **Mercado**
   - Ranking de custo-benefício, "Ler todas as páginas", filtros e foco.
   - Cada anúncio tem **"Abrir no jogo"**: leva a conta à vitrine daquele anúncio, na tela ao vivo, para você decidir.
5. **Alertas**
   - Histórico de notificações (shiny, P5, drop raro, conta caiu, estoque baixo).
   - Ajustes de quais alertas receber.

### Compras

- **Market (ouro):** pokébolas, poções e revives. Compra direta pelo hub (Loja rápida), com confirmação e PIN.
- **Mercado da Comunidade (RMT):** usa gemas e coins de outros jogadores, com taxas e retenções, e as gemas valem dinheiro. **Decidido:** o hub leva a conta até o anúncio ("Abrir no jogo"), e o toque em Comprar é do usuário, na tela ao vivo. O hub nunca clica em Comprar no RMT.
- **Teto diário de gasto pelo celular:** 200.000 ouro por conta, ajustável no PC (decidido).

### Usabilidade

- Botões de pelo menos 44 px.
- Feedback tátil (vibração curta ao confirmar).
- Modo escuro de madeira e layout de uma coluna.
- Funciona com a tela do celular na vertical.
- O feed e o estado chegam por SSE. Sem conexão, mostra o último estado com "atualizado há X".
- A tela ao vivo pausa sozinha quando o app vai para segundo plano, para economizar a bateria do celular e a CPU do PC.

### Segurança extra no mobile

- Ações que gastam algo pedem o PIN. Há uma opção "lembrar PIN por 10 min neste aparelho".
- Cada compra vai para o registro de auditoria e para a notificação "Compra feita pelo celular: X".
- Teto diário de gasto pelo celular, ajustável no PC. Padrão: 200.000 ouro/dia por conta.
- Revogar o aparelho ou desligar o acesso remoto pela bandeja corta tudo na hora.

### Fases ajustadas
- **R1:** base, pareamento, leitura (em andamento).
- **R3:** capturas e Web Push.
- **R4:** ações (Loja com kits, recarregar, suspender, Modo leve) com PIN e teto diário.
- **R5:** tela ao vivo e Controlar. Isso destrava "todo tipo de gerenciamento".
- **R6:** auditoria de segurança.

Objetivo: com o PC em casa farmando, abrir no navegador do celular, de **qualquer lugar**, um painel do PokéHub para ver capturas, Pokémon, estoque, hunts e mercado, fazer ações simples (repor kit, recarregar ou suspender conta) e, quando preciso, **ver e mexer no jogo** de uma conta.

## 1. Princípios de segurança (inegociáveis)

1. **Nada exposto na internet aberta.** Não abrimos porta no roteador, não usamos UPnP e não colocamos IP público. O servidor do hub escuta só em `127.0.0.1` (ou só no IP da VPN privada) e chega ao celular por um túnel autenticado.
2. **Desligado por padrão.** Liga em Gerenciar → Acesso remoto, com um aviso, e desliga com um clique, inclusive pelo menu da bandeja.
3. **Pareamento por QR code.** O hub mostra um QR com um código de uso único que vale 2 min. O celular troca esse código por um token de dispositivo de 256 bits. O hub guarda só o hash do token. Cada dispositivo pode ser revogado em Gerenciar.
4. **Camadas de permissão:**
   - **Ver**: padrão, só leitura.
   - **Agir**: repor, recarregar e suspender; pede o PIN de 6 dígitos que você define no PC.
   - **Controlar o jogo**: toque e teclado na tela da conta; é desligado por padrão, pede PIN e expira sozinho após 10 min.
5. **Proteções de transporte:**
   - HTTPS de ponta a ponta, pelo próprio túnel.
   - Cookies `HttpOnly`/`Secure`/`SameSite=Strict`.
   - Proteção CSRF e CSP estrita.
   - Limite de tentativas: 5 PINs errados bloqueiam o dispositivo por 15 min.
   - Registro de auditoria com data, dispositivo e ação, visível em Gerenciar.
6. **Mesmas travas de hoje.** Toda ação remota passa pelos mesmos guardas já existentes no hub:
   - sessão legível e origem `pokeidle.io`;
   - Loja só com ouro e sempre com confirmação, agora feita no celular.

   Nenhuma senha do jogo trafega pelo acesso remoto.

## 2. Como o celular chega ao PC de qualquer lugar

| Opção | Como funciona | Prós | Contras | Veredito |
|---|---|---|---|---|
| **Tailscale** (VPN privada, plano grátis) | Instala no PC e no celular com a mesma conta. O hub publica com `tailscale serve`, que dá HTTPS com certificado válido em `https://<pc>.<tailnet>.ts.net` só para os seus aparelhos. | Mais seguro e simples. Sem porta aberta, funciona em 4G, certificado real, nada público. | Precisa do app Tailscale no celular, ligado. | **Recomendado** |
| Cloudflare Tunnel + Access | Túnel de saída e URL pública protegida por login (e-mail ou OTP) do Cloudflare. | Não precisa de app no celular. | Precisa de domínio na Cloudflare e configurar Access. A URL é pública (protegida). | Alternativa avançada |
| Só rede local (Wi-Fi de casa) | O hub escuta no IP da LAN. | Zero configuração externa. | Não funciona fora de casa e precisa de HTTPS autoassinado (aviso no celular). | Só como modo extra |
| Abrir porta no roteador | — | — | Expõe o PC na internet. | **Não fazer** |

O hub detecta o Tailscale (`tailscale status --json`), mostra o endereço e oferece um botão **"Publicar com Tailscale"**. Esse botão roda `tailscale serve --bg https / http://127.0.0.1:<porta>`; o comando exato vai ser confirmado contra a versão instalada.

## 3. O que o painel do celular mostra (PWA, "Adicionar à tela inicial")

- **Início:** cada conta com estado (pronta, carregando, erro, suspensa), Pokémon em campo, hunt atual, XP/h e ouro/h, e "última atividade há X min".
- **Capturas:** feed ao vivo por conta, com espécie, nível, P, Nota, shiny ✨ e horário, e filtro "só shiny/P5". A fonte é a lista "Capturas" visível do jogo e as linhas "capturado: …" do log. O leitor do log saiu junto com o Grindolino e volta numa versão mínima, só para isso.
- **Pokémon:** equipe da conta (via /hunt, se ativa) com nível, IV/Nota e potência.
- **Onde caçar:** o mesmo ranking da lateral.
- **Mercado:** o ranking de custo-benefício e o último "Ler todas" executado no PC.
- **Loja:** estoque por conta e kits. Botão **Repor** com tela de confirmação e PIN.
- **Saúde do PC:** CPU e RAM por conta (o mesmo do Diagnóstico) e "PC online desde".
- **Ações (com PIN):** recarregar, reabrir, suspender ou retomar conta, ligar o Modo leve e desligar o acesso remoto.

## 4. Ver e jogar a conta pelo celular

- **Ver:** o hub captura a tela da conta escolhida com `webContents.capturePage()` e envia JPEG a 1–2 quadros/s por WebSocket, **só enquanto a tela estiver aberta no celular**. Banda estimada: 50–150 KB/s.
- **Mexer (modo Controlar):** os toques no celular viram clique, rolagem e teclado na conta via `webContents.sendInputEvent`, com coordenadas convertidas.
- **Limite a confirmar:** uma view oculta (em foco em outra conta, ou janela na bandeja) pode devolver quadro vazio ou desatualizado no `capturePage`. Se isso acontecer, ao abrir a tela remota o hub torna a view "visível fora da tela" enquanto alguém assiste. Precisa de teste: é a mesma pergunta P0-2 de `DESEMPENHO.md`.
- **Alternativa sem o hub:** abrir o próprio pokeidle.io no navegador do celular. Logar a mesma conta em dois lugares pode derrubar a sessão do PC (verificar nos termos ou no jogo), por isso a tela remota do hub é o caminho preferido.

## 5. Alertas no celular (sem precisar abrir nada)

Notificações push para o que importa:
- shiny capturado;
- P5 capturado;
- drop raro;
- conta caiu (erro ou offline por mais de 5 min);
- conta sem poção ou revive (pelo estoque);
- PC ficou sem internet e voltou.

**Canais:**
- **Push da própria PWA (Web Push).** Funciona com Tailscale/HTTPS; no iOS, só com a PWA instalada.
- **Webhook do Discord.** Você cria um webhook num canal seu e cola a URL no hub. É o mais simples e funciona sempre.
- **ntfy** (app gratuito; tópico privado e aleatório).

Cada alerta pode ser ligado ou desligado. Alertas repetidos são agrupados, no máximo um a cada X minutos por tipo.

## 6. Arquitetura

- **Servidor:** fica no processo principal do Electron, usando `node:http` e `ws`. Avaliar se o `ws` cabe; senão, WebSocket nativo via `node:http` upgrade.
  - escuta só em `127.0.0.1:<porta>` (ou no IP Tailscale);
  - roteia por uma camada `remote/` que **só chama funções já existentes**, como `marketScan`, `shopRead` e `huntSnapshot`, sem duplicar a lógica.
- **Front do celular:** outra entrada do Vite (`remote.html`), mobile-first, com o mesmo tema madeira, empacotada no app e servida pelo próprio servidor.
- **Dados ao vivo:** um único WebSocket autenticado envia eventos (estado das contas, capturas, progresso de compras), em vez de o celular ficar consultando o PC.
- **Persistência:**
  - tabelas `remote_devices` (hash do token, nome, criado em, último acesso, permissões);
  - `remote_audit`;
  - `capture_log` (capturas para o feed, guardadas por 7 dias);
  - preferências de alertas.

  Tudo em migrações não destrutivas.
- **Consumo:** com ninguém conectado, o custo é quase zero (servidor parado, ou só ouvindo). Sem polling extra: o feed aproveita eventos que o hub já recebe.

## 7. Fases

| Fase | Entrega | Depende de |
|---|---|---|
| R1 | Servidor local, pareamento por QR, dispositivos e auditoria, painel somente leitura (Início, Saúde, Onde caçar, Mercado, Loja só leitura) | — |
| R2 | Integração com Tailscale (detecção, endereço, botão Publicar, guia passo a passo). Modo só LAN como opção. | R1 |
| R3 | Leitor mínimo de capturas e feed com filtros. Alertas por Discord, ntfy e Web Push. | R1 |
| R4 | Ações com PIN: repor kit com confirmação, recarregar, suspender, Modo leve | R1 e Loja rápida |
| R5 | Tela remota (ver) e depois modo Controlar com PIN e expiração | R1 e teste de captura de view oculta |
| R6 | Testes de segurança: força bruta, CSRF, token roubado ou revogado, replay, origem errada. Revisão do código. | todas |

## 8. Riscos e testes reais necessários
- `capturePage` e `sendInputEvent` em views ocultas ou com a janela na bandeja.
- Se o jogo progride com a janela escondida na bandeja (P0-2).
- Se o PC dorme: o hub precisa impedir a suspensão do sistema enquanto houver contas farmando (`powerSaveBlocker`, opcional e ligado por padrão quando o acesso remoto estiver ativo).
- Se o jogo bloqueia a mesma conta logada em dois lugares.
- iOS: Web Push só funciona com a PWA instalada na tela inicial.
