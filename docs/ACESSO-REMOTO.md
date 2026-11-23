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

## Implementado (R1) — 2026-11-23

**Como usar:** Gerenciar → **Acesso remoto** → ligar a chave. O hub mostra o endereço `https://<ip-do-pc>:47321` e o QR. **Parear novo aparelho** abre um modal com o endereço, o QR e o código de 8 caracteres (Crockford, 2 min, uso único) com contagem regressiva e **Gerar outro**. Quando o celular envia o código, o **mesmo modal** passa a perguntar **"Permitir este aparelho? <nome> · <IP>"** (Permitir/Recusar, sem diálogo nativo; as views do jogo ficam escondidas enquanto o modal está aberto). Também dá para ligar/desligar pela bandeja ("Acesso remoto: ligado/desligado").

**O que existe**
- Servidor HTTPS (`spike/remote/`) só quando ligado (preferência `remote_enabled`, padrão 0). Escuta apenas nos IPv4 privados da máquina (10/8, 172.16/12, 192.168/16) + 127.0.0.1, porta `remote_port` (47321).
- CA local própria + certificado do servidor, gerados na primeira ativação (`certs.ts`, só com o `crypto` do Node: ECDSA P-256 e X.509 montado em DER; **nenhuma dependência nova**). Chaves em `<userData>/remote/`.
- Pareamento, PIN (scrypt, bloqueio de 15 min após 5 erros, por aparelho), lista de aparelhos com **Revogar** e **auditoria** (últimos 100) em Gerenciar.
- API somente leitura, toda autenticada: `GET /api/me`, `/api/state`, `/api/hunt/:id` (mesmo `huntSnapshot` da lateral), `/api/market/:id` (acúmulo do Mercado do PC; se vazio, lê a página aberta), `/api/diag` (CPU/RAM por conta), `/api/events` (SSE: o estado das contas chega na hora). `POST /api/pin/check` e `/api/logout`.
- App do celular (`spike/remote-ui/`, entrada Vite `remote.html`, mesma linguagem visual do desktop via `spike/shared/dna.css`): barra inferior com 5 abas em pixel art — Contas (cartões + Saúde do PC), Conta (Onde caçar; Jogo/Capturas/Equipe "em breve"), Loja (em breve), Mercado, Alertas (em breve). "Atualizado há X" e aviso de offline via SSE. PWA: manifesto + ícone + service worker que só se registra (Web Push entra na R3). Links diretos: `#conta`, `#mercado`, `#saude`.
- `powerSaveBlocker('prevent-app-suspension')` enquanto o acesso remoto está ligado **e** há ≥1 conta aberta; solta ao desligar, suspender tudo ou sair.
- Banco v11 (não destrutivo): colunas `remote_enabled`, `remote_port`, `remote_pin_hash`, `remote_daily_cap_gold` (200000, para a R4) e tabelas `remote_devices`, `remote_audit`, `remote_spend` (R4).

### Instalar o certificado no celular (só na primeira vez)
O modal de pareamento mostra dois QRs (só o certificado **público** da CA; só enquanto o código está válido). Sem a CA o celular mostra um aviso de segurança, não instala o app na tela inicial e não recebe push.
- **Android:** leia o QR "Android" (baixa `pokehub-ca.crt`) e instale em **Configurações → Segurança → Instalar certificado CA** (em alguns aparelhos: Segurança e privacidade → Mais segurança → Criptografia e credenciais → Instalar um certificado → Certificado de CA). Aceite o aviso do sistema.
- **iPhone/iPad:** leia o QR "iPhone" no Safari → permita baixar o perfil → **Ajustes → Perfil baixado → Instalar**. Depois **Ajustes → Geral → Sobre → Confiança de certificados** e ligue **PokeHub CA**.
- Antes de instalar, o navegador avisa que o site "não é seguro": nessa etapa, continue só para baixar o certificado. Depois de instalado e confiado, o aviso some.
- A CA é restrita (*name constraints*) a IPs privados e `localhost`: mesmo que a chave vazasse, ela não serve para forjar sites da internet. Para remover: apague o perfil/certificado no celular e a pasta `remote` em userData (a CA é refeita ao religar).
- O certificado do servidor dura 397 dias (o limite do iOS é 398) e é renovado sozinho quando faltam 30 dias ou quando o IP do PC muda (a rede é conferida a cada 30 s e o servidor reabre nos IPs novos). A CA dura 10 anos.

### Firewall do Windows
Na primeira vez o Windows pergunta se o PokéHub pode receber conexões: marque **Redes privadas** (não marque públicas). Se o celular não abrir o endereço, confira em Configurações → Rede e Internet → Wi-Fi → propriedades se a rede está como **Privada**. Quem usa Wi-Fi marcado como Público (cafés, hotéis) não deve ligar o acesso remoto. (Ainda não há desligamento automático por troca de rede; veja "O que falta".)

## SEGURANÇA (R1)
- **Desligado por padrão**; ao desligar (chave, bandeja ou sair do app) todos os listeners e conexões fecham na hora (testado: a porta passa a recusar conexão).
- **Só LAN:** bind apenas em IPv4 privado/loopback; cada conexão e cada requisição conferem o IP de origem (privado ou loopback) e o resto é derrubado. Sem UPnP, sem porta no roteador.
- **Host/DNS rebinding:** o cabeçalho `Host` precisa ser um dos IPs vinculados ou `localhost`, senão 421. **CSRF:** todo POST exige `Origin` idêntico ao servidor e `Content-Type: application/json`; cookie `SameSite=Strict`.
- **Corpo:** só JSON, no máximo 8 KB (413 acima). Cabeçalhos ≤ 8 KB, timeouts de requisição/handshake, máx. 64 conexões, SSE ≤ 20 (4 por aparelho). Limite por IP: 300 req/min (10/min no pareamento), 429 acima.
- **Cabeçalhos:** CSP `default-src 'self'` (+ imagens do pokeidle.io), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, CORP/COOP `same-origin`, `Cache-Control: no-store` na API. HSTS não é usado na LAN.
- **Pareamento:** código de 8 caracteres Crockford (40 bits, `crypto.randomInt`), 2 min, uso único, **5 erros invalidam** o código; só 1 pedido pendente; o aparelho só entra depois do **Permitir** no PC (sem resposta em 60 s = recusado); no máximo 8 aparelhos.
- **Token:** 256 bits aleatórios, **novo a cada pareamento**; o banco guarda só o SHA-256 e a comparação usa `timingSafeEqual`. Cookie `__Host-ph` com `Secure; HttpOnly; SameSite=Strict; Path=/` (sem `Domain`). **Revogar** apaga o aparelho e **fecha na hora os fluxos SSE** dele; o heartbeat também confere se o aparelho ainda existe.
- **PIN:** 6 dígitos, scrypt com sal; 5 erros bloqueiam **o aparelho** por 15 min (nem o PIN certo passa durante o bloqueio; o contador fica em memória). Limite honesto: 6 dígitos é pouco contra ataque *offline* ao banco; a defesa real é o bloqueio e o banco ficar só no PC do usuário.
- **Chaves:** a CA e o servidor têm chave privada só em `<userData>/remote/*.key.pem` (0600 no Linux/macOS; no Windows o diretório recebe ACL só do usuário via `icacls`, chamado sem shell e com argumentos fixos; se falhar, a pasta continua dentro do perfil do usuário). Nenhuma rota, IPC ou status devolve chave privada, hash, token ou caminho de arquivo (há teste para isso). Só o **certificado público** da CA é baixável e **só com o pareamento ativo**.
- **Sem vazamento em log:** o servidor não escreve no console; códigos, tokens, PINs, cookies e IPs só existem na tabela de auditoria (IP apenas nos eventos de pareamento). Erros voltam genéricos ("Não autorizado.", "Não encontrado."...), sem pilha nem mensagem interna.
- **Mesmas travas do hub:** a API só chama funções que já existem (`huntSnapshot`, `marketScan`, leitura de métricas), com as mesmas verificações de origem `pokeidle.io` e sessão legível. Nenhuma senha do jogo passa por aqui.

## O que falta
- **R3:** leitor mínimo de capturas + feed, Web Push (VAPID local), Discord/ntfy. O service worker já está registrado.
- **R4:** ações com PIN (repor kit, recarregar, suspender, Modo leve), teto diário de ouro (`remote_daily_cap_gold`/`remote_spend` já existem) e a Loja.
- **R5:** tela ao vivo (capturePage) e modo Controlar com PIN e expiração de 10 min.
- **R6:** revisão de segurança (força bruta distribuída, replay, token roubado). Pendente também: desligar sozinho ao trocar para uma rede desconhecida/Pública, guardar o contador de PIN no banco, proteger a chave da CA com o cofre do sistema (`safeStorage`) e pareamento por QR com o código embutido.
- Limitações conhecidas: a resposta do pareamento fica aberta até o PC aceitar (se o celular perder a conexão nesse meio-tempo, é preciso parear de novo); o ranking do Mercado no celular usa o que o PC já leu (o celular não clica nas páginas).


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
