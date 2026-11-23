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
## Implementado (R1, endurecido em 2026-11-23)

**Como usar:** Gerenciar → **Acesso remoto** → ligar a chave. O hub mostra o endereço `https://<ip-do-pc>:47321` e o QR. **Parear novo aparelho** abre um modal. Fluxo atual:
1. **Primeiro aparelho (certificado primeiro):** o modal mostra a **impressão digital SHA-256 da CA** em blocos de 4 (`AB12 CD34 ...`) e três QRs: o do **endereço** (`https://IP:porta/#fp=<sha256>`), o do certificado Android e o do perfil iPhone. O **código só aparece** depois que você marca **"Conferi a impressão digital no celular"**.
2. No celular: leia o QR do endereço. A página mostra a impressão digital esperada (vinda do QR, o fragmento `#...` nunca vai ao servidor); compare, bloco a bloco, com a do PC e, depois de instalar o certificado, com o SHA-256 nos detalhes dele no celular. **Se algo for diferente, pare** (pode haver outra pessoa na rede).
3. Digite o código de 8 caracteres (Crockford, 2 min, uso único). O PC responde na hora com um **número de conferência de 2 dígitos** (SAS); o celular o mostra e o modal do PC diz **"O celular deve estar mostrando 47"**. O celular consulta o resultado por *long-poll* (`GET /api/pair/wait`, até 25 s por consulta e 60 s no total).
4. O PC mostra o nome lido pelo servidor (User-Agent) **separado** do apelido que o celular informou (não confiável), o IP, e o botão **Permitir** só habilita 1,5 s depois do pedido e depois de qualquer troca de foco da janela. Permitir/liberar abre também uma **confirmação nativa do sistema** (padrão: Recusar), fora da página.
5. Se o **mesmo código certo** chegar de novo com o pedido aberto, o modal marca **contestado** e recomenda Recusar e gerar outro código. Se o celular desistir (parar de consultar), o pedido é cancelado e **nada é guardado**.

Também dá para ligar/desligar pela bandeja ("Acesso remoto: ligado/desligado").

**O que existe**
- Servidor HTTPS (`spike/remote/`) só quando ligado (preferência `remote_enabled`, padrão 0). Escuta **apenas na rede doméstica fixada** (ver abaixo), porta `remote_port` (47321). `127.0.0.1` só em testes (`portOverride`).
- CA local própria + certificado do servidor, gerados na primeira ativação (`certs.ts`, só com o `crypto` do Node: ECDSA P-256 e X.509 em DER; **nenhuma dependência nova**). Chaves em `<userData>/remote/`, **cifradas em repouso com o `safeStorage` do Electron** quando disponível.
- Pareamento, PIN (scrypt assíncrono, bloqueios persistentes e escalonados), lista de aparelhos com **Revogar**, alternância **"Pode agir"** (com confirmação nativa) e **auditoria** (últimos 100) em Gerenciar.
- API somente leitura, toda autenticada: `GET /api/me`, `/api/state`, `/api/hunt/:id`, `/api/market/:id` (exigem o cabeçalho `X-PH: 1`; 10/min por aparelho; chamadas iguais simultâneas dividem uma execução), `/api/diag`, `/api/events` (SSE) e `POST /api/logout`. O antigo `POST /api/pin/check` **foi removido** (só voltará com elevação de PIN no servidor, ver "Requisitos obrigatórios").
- App do celular (`spike/remote-ui/`, entrada Vite `remote.html`) **compilado para uma pasta separada** (`dist-remote`, com `sw.js` e manifesto); o desktop (`dist`) não leva nada do celular e o servidor só serve arquivos de `dist-remote`. Barra inferior com 5 abas em pixel art (Contas, Conta, Loja, Mercado, Alertas; a Loja e as ações chegaram no R4). Links diretos: `#conta`, `#mercado`, `#saude`.
- `powerSaveBlocker('prevent-app-suspension')` só enquanto o servidor está **de fato escutando** e há ≥1 conta aberta.
- Banco v12 (não destrutivo): v11 (`remote_enabled`, `remote_port`, `remote_pin_hash`, `remote_daily_cap_gold`, tabelas `remote_devices`, `remote_audit`, `remote_spend`) + v12 (rotação do token, pino da rede, ações desligadas e `remote_pin_state` com os contadores do PIN).

### Rede doméstica fixada
- **Windows:** o hub pergunta ao `Get-NetConnectionProfile` (PowerShell com argumentos fixos, sem shell, limite de 3 s, JSON lido com defesa) e só escuta em interfaces de categoria **Privada** e **adaptador físico** (`Get-NetAdapter -Physical`); VPN/virtuais (TAP, OpenVPN, WireGuard, NordLynx, ProtonVPN, AnyConnect, "Local Area Connection*", vEthernet, WSL, Docker, Hyper-V, ZeroTier, Tailscale, Hamachi) ficam de fora por nome mesmo se marcados Privados. Se o PowerShell falhar, **nada é aberto** (nunca "libera tudo"). Fora do Windows usa a impressão digital da sub-rede.
- Ao ligar, grava o **pino da rede** (hash do nome do perfil + sub-redes). Se a rede mudar, o servidor **para**, `enabled` continua ligado e `running=false` com a mensagem **"Rede nova detectada: liberar aqui?"**; **nunca religa sozinho em outra rede** (volta sozinho se você voltar à rede fixada; liberar a nova pede confirmação nativa). Tudo é auditado (`rede_nova`, `rede_liberada`, `rede_fixada`).
- Cada conexão e cada requisição exigem que o IP de origem esteja **na mesma sub-rede** do endereço local do soquete (máscara de `os.networkInterfaces()`).

### Instalar o certificado no celular
Só o certificado **público** da CA é baixável, **só enquanto o pareamento está aberto**; o arquivo se chama `pokehub-ca-<6 primeiros hex da impressão digital>.crt` e o perfil do iPhone traz a impressão digital na descrição. Sem a CA, o celular não registra o service worker (o pareamento exige o cabeçalho `X-PH-SW: 1` que ele acrescenta), não instala o app e não recebe push.
- **Android:** leia o QR "Android" e instale em **Configurações → Segurança → Instalar certificado CA** (em alguns aparelhos: Segurança e privacidade → Mais segurança → Criptografia e credenciais → Instalar um certificado → Certificado de CA).
- **iPhone/iPad:** leia o QR "iPhone" no Safari → permita baixar o perfil → **Ajustes → Perfil baixado → Instalar**. Depois **Ajustes → Geral → Sobre → Confiança de certificados** e ligue **PokeHub CA**.
- **Antes de instalar, confira a impressão digital.** O navegador vai avisar que o certificado do site não é confiável: nessa etapa **não prossiga sem comparar** a impressão digital da página com a do PC. Só se forem idênticas baixe o certificado. Se divergir, feche e não digite o código.
- A CA tem restrição de nomes (*name constraints*): só as sub-redes /24 fixadas, `127.0.0.1` e `localhost`, com IPv6 excluído. Isso **reduz o risco** se a chave vazar (não serve para sites da internet nem para outras redes), mas **não o elimina**: quem tiver a chave pode se passar pelo PC na sua rede de casa. **Se a sub-rede mudar, a CA é refeita** e o certificado precisa ser reinstalado no celular (o PC avisa).
- O certificado do servidor dura 397 dias (limite do iOS: 398) e é renovado quando faltam 30 dias ou quando o IP muda dentro da mesma rede. A CA dura 10 anos. Para remover: apague o perfil/certificado no celular e a pasta `remote` em userData.

### Firewall do Windows
Na primeira vez o Windows pergunta se o PokéHub pode receber conexões: marque **Redes privadas** (não marque públicas). Se o celular não abrir o endereço, confira se a rede está como **Privada**. Em Wi-Fi Público (cafés, hotéis) o hub não abre a porta: aparece "Rede nova detectada".

## Implementado (R3, capturas e Web Push)

**Contrato com o app do celular** (tipos em `spike/contracts/remote.ts`). Todas as rotas exigem autenticação; os GETs exigem `X-PH: 1`; os POSTs mantêm Origin idêntico, `Content-Type: application/json` e corpo ≤ 8 KB.
- `GET /api/captures?profileId=&onlyAlerts=1&limit=1..200` → `{captures: RemoteCapture[]}`, mais novas primeiro. `RemoteCapture` = captura + `label` e `color` da conta (colocados pelo servidor). **Nunca** leva `emailLabel` nem as dicas internas (`hints`); há teste que varre as respostas, o SSE e o push.
- `GET /api/alerts?limit=1..200` → `{alerts: RemoteAlert[]}` (histórico do banco: 7 dias, no máximo 1.000 linhas).
- `GET|POST /api/alerts/prefs` → `AlertPrefs` por aparelho (`{shiny, p5, recorde, notaMin 0–10|null, contaCaiu}`; padrão `shiny` e `p5` ligados, `recorde` desligado, `notaMin` nulo, `contaCaiu` ligado). O POST é validado (chaves exatas, tipos e faixa).
- `GET /api/push/key` → `{publicKey}` (VAPID, base64url). **Só a pública** é servida.
- `POST /api/push/subscribe` (`{endpoint, keys:{p256dh, auth}}`), `POST /api/push/unsubscribe` (`{endpoint}`), `POST /api/push/test` (3 a cada 10 min por aparelho; `{sent}`).
- SSE em `/api/events`: `capture` (`{captures: RemoteCapture[]}`, só as novas) e `alert` (`RemoteAlert`, só para os aparelhos cujas preferências combinam).

**Como funciona**
- **Leitor de capturas sob demanda.** O leitor do `createCaptureService` só fica ligado enquanto o acesso remoto está de fato escutando **e** há quem precise: ao menos um aparelho com push assinado ou um fluxo SSE aberto. Respeita o Modo leve (30 s → 60 s). Sem isso, custo zero.
- **Alertas** (`spike/remote/alerts.ts`): para cada captura nova, `alertsOf` calcula shiny, P5, recorde e nota mínima; `conta_caiu` quando uma conta fica em erro/offline por mais de 5 min seguidos (recarregar não zera o relógio) e `conta_voltou` quando ela volta a `ready` depois de um `conta_caiu`. Cada alerta vira uma linha do histórico (7 dias, ≤ 1.000) e, por aparelho, SSE + push conforme as preferências.
- **Agrupamento:** no máximo 1 push por aparelho e por tipo a cada 2 min; o push seguinte àquele que foi retido diz "(+N)". O SSE e o histórico não são agrupados.
- **Assinaturas** (`remote_push`, banco v13): presas ao aparelho (`ON DELETE CASCADE`, e também apagadas de forma explícita ao revogar, sair ou expirar), no máximo 2 por aparelho (a mais antiga sai), `endpoint` único. 404/410 do serviço apaga na hora; 5 falhas seguidas apagam.
- **Biblioteca:** `web-push` 3.6.7 (dependência de runtime; `bun audit --prod` sem vulnerabilidades) **só cifra (RFC 8291, aes128gcm) e assina o VAPID (RFC 8292, ES256, validade de 12 h)**. O envio é nosso (ver abaixo), nunca o da biblioteca.

**O que sai do PC com o push ligado** (ver também `SECURITY.md`)
- Um `POST` de saída ao serviço de push do navegador do celular. Os destinos aceitos são só: `fcm.googleapis.com`, `web.push.apple.com` e `*.push.apple.com`, `updates.push.services.mozilla.com` e `*.push.services.mozilla.com`, `*.notify.windows.com`.
- **Conteúdo (cifrado ponta a ponta; o serviço vê só destino e tamanho):** JSON ≤ 1 KB com `{kind, label, text, at, url}`. `kind`: shiny, p5, recorde, nota, conta_caiu ou conta_voltou. `label`: nome da conta no PokéHub. `text`: frase curta em pt-BR (≤ 120), por exemplo "Shiny: Pikachu Nv 20 P5". `at`: horário ISO. `url`: um destes atalhos dentro do app: `#alertas`, `#contas`, `#conta/<id>`. **Nunca** vai e-mail, token, PIN, IP, caminho, chave nem nada de pagamento.
- Cabeçalhos: `Authorization: vapid t=<JWT>, k=<chave pública>` com assunto genérico `mailto:pokehub@example.com` (**nunca** o seu e-mail), `TTL: 3600`, `Urgency`.

**Segurança do R3 (testada)**
- **SSRF:** o endpoint é conferido antes de qualquer envio (na assinatura e de novo a cada envio): `https`, porta 443, sem usuário/senha nem fragmento, host fora de IP literal (v4, v6, decimal, hexa), host exatamente na lista ou sufixo `.push.apple.com`/`.notify.windows.com`/`.push.services.mozilla.com` com rótulo antes (nada de `fcm.googleapis.com.evil.com`, `xpush.apple.com` ou ponto final). Vai à rede a URL **normalizada** (a mesma que foi conferida). `redirect: 'error'`, `credentials: 'omit'`, tempo máximo de 5 s e o corpo da resposta é descartado sem ser lido.
- **Chave VAPID:** gerada uma vez (na primeira necessidade) em `<userData>/remote/vapid.key`, **cifrada com o `safeStorage`** (sem ele, em texto com permissão restrita da pasta, como as chaves da CA); nunca servida, logada nem devolvida por IPC/status. Se a chave cifrada não puder ser aberta (outro usuário/máquina), é refeita e as assinaturas antigas são apagadas.
- **Aparelho dono da assinatura:** só o aparelho autenticado assina/remove as suas (um aparelho não remove a de outro); revogar, sair ou expirar apaga assinaturas e preferências.
- **Sem cache no service worker:** o `sw.js` não pode guardar respostas de `/api/*` nem o push; ele só mostra a notificação e abre o atalho.
- **Limites:** POSTs de preferências/assinatura 30 por 10 min por aparelho; teste de push 3 por 10 min (também no botão do PC).
- **Banco v13** (não destrutivo, aceita 0–13): `remote_push`, `remote_alert_prefs`, `remote_alerts` (+ índice por data).

**No PC:** Gerenciar → Acesso remoto mostra, por aparelho, "Notificações: ativas (N)" e o botão **Enviar teste**, e o histórico dos últimos 20 alertas.

**Limites honestos do R3**
- O serviço de push do navegador (Google, Apple, Mozilla, Microsoft) sabe que o seu PC mandou algo para aquele celular e quando (o conteúdo é cifrado). Quem não quer isso não ativa as notificações.
- Se o PC estiver dormindo/sem internet, o alerta não sai; o histórico no banco mostra o que ocorreu.
- No iPhone o push só funciona com o app instalado na tela inicial (PWA) e a CA instalada; a Apple recusa assuntos VAPID com `localhost`, por isso o assunto genérico é `example.com`.
- Não há envio por Discord/ntfy (fica para depois).

## Implementado (R4, ações pelo celular)

Só funciona para aparelhos com **"Pode agir"** (liga-se no PC, com confirmação nativa), com **PIN** definido no PC e com as ações não desligadas por erros de PIN. Tudo é decidido **no servidor** (`spike/remote/actions.ts`); o celular só pede.

**Rotas** (POST, JSON ≤ 8 KB, Origin conferido; sem `can_act` = 403; todas auditadas)
- `POST /api/shop/read {profileIds}` → `{accounts:[{profileId, label, gold, items:[{cat,name,have,price}], error?}]}`. Leitura nova no jogo (`shop.read`, respeita a trava por conta), **só itens do catálogo** da Loja. 10/min por aparelho (junto com `plan`).
- `POST /api/shop/plan {profileIds, mode:'manual'|'kit', lines?:[{cat,name,qty}], kit?:{name, lines:[{cat,name,target}]}}` → relê os preços no jogo, valida contra o catálogo, monta o plano canônico por conta (itens, quantidade, preço unitário, total, ouro antes/depois, "cabe?", teto restante), calcula `planHash = sha256(JSON canônico)` e guarda `{confirmId (128 bits), aparelho, planHash, plano, expira em 60 s, usada:false}` na memória **e** no banco (`remote_confirms`). Um plano novo invalida o anterior do mesmo aparelho. Sem nada executável: 422 com o plano (sem `confirmId`).
- `POST /api/shop/confirm {confirmId, planHash, pin?}` + cabeçalho **`Idempotency-Key`** (obrigatório, 8–64 caracteres): mesmo aparelho, não expirada (410), não usada (409), hash igual (senão 409 e a confirmação é queimada), PIN verificado no servidor (ver abaixo). Depois: **marca como usada de forma atômica** (UPDATE condicional) → **reserva o teto diário** (`BEGIN IMMEDIATE`) por conta → **relê os preços no jogo**: se subiu, aborta aquela conta ("Preço mudou", reserva devolvida); se caiu, compra pelo preço novo; falta de ouro também aborta → executa pelo `shop.run` (catálogo, só ouro, `accountLock`) → devolve o que sobrou da reserva → grava cada linha em `remote_purchases`. Resposta 200 com o resumo por conta (ou 409 `compra_abortada` se nada foi comprado). Repetir a mesma `Idempotency-Key` devolve o resultado guardado (também depois de reiniciar o PC), sem comprar de novo. O progresso sai pelo SSE `shop` (`start`, `line`: buying/ok/error, `done`), **só para o aparelho que confirmou**.
- `POST /api/elevate {pin}` → "lembrar o PIN por 10 min", **na memória do servidor**, por aparelho (nunca no celular). Não renova sozinha. Cai ao revogar/expirar/sair, trocar ou remover o PIN, bloquear o PIN, desligar o acesso remoto, mudar de rede, tirar o "Pode agir" e ao **aumentar o teto**. Compras acima de **50% do teto restante** de qualquer conta pedem o PIN **sempre**, mesmo com a elevação.
- `POST /api/account/:id/{reload|suspend|resume}`, `POST /api/lite {on}` (corpo com `pin` quando não há elevação): as mesmas funções do IPC do PC. 5 ações/min por aparelho (429), estado inválido = 409 (não gasta o limite), aviso na bandeja/notificação do PC e linha no registro.
- `GET /api/me` ganhou `actions`: `{canAct, pinSet, actionsDisabled, lockedMs, elevatedMs, dailyCapGold, lite}` para o app mostrar o motivo de cada botão desligado.
- **Não existe nenhuma rota, seletor ou URL de compra no Mercado da Comunidade (RMT).** Há teste que varre o código das ações e confere os 404.

**PIN, bloqueio e limites.** Os erros de PIN passam pelo mesmo `PinGuard` de antes (scrypt assíncrono; 5 erros = 15 min → 1 h → 24 h → revoga; 10 erros/dia desligam as ações). Erro de PIN **não** queima a confirmação (dá para tentar de novo no mesmo plano) e não gasta o limite de 5 ações/min. 403 `pin_necessario`/`pin_errado`, 423 `pin_bloqueado`/`acoes_desligadas` com `Retry-After`.

**Teto diário.** `remote_daily_cap_gold` (padrão 200.000 de ouro **por conta**, **só editável no PC**). `remote_spend(day, profile_id, gold, tz)`: dia no **fuso local do PC** (o fuso fica gravado). A reserva soma e confere na mesma transação, então dois planos que juntos estourariam o teto nunca passam os dois.

**O que o PC faz a cada compra:** notificação "Compra feita pelo celular: Conta: 100× Poke Ball (−10.000 ouro) · aparelho" (balão da bandeja no Windows), **push** a todos os aparelhos com notificações (`kind: "acao"`, sem dados sensíveis, `url: #alertas`) e entrada no registro (`compra_confirmada`, `compra_abortada`, `compra_preco_mudou`, `compra_recusada_teto`, `compra_hash_diferente`, `acao_recarregar|suspender|retomar`, `modo_leve`, `elevacao_pin`, `teto_diario`). `remote_purchases` **nunca é podada** (id, data, aparelho, conta, confirmação, hash, item, quantidade, preço, total, resultado); o painel mostra as últimas 50.

**No PC (Gerenciar → Acesso remoto):** por aparelho, "Pode agir: sim/não" (confirmação nativa); editor do **teto diário** (aumentar pede confirmação nativa e encerra os PINs lembrados); gasto de hoje por conta; histórico das últimas 50 compras. **No celular:** aba **Loja** (contas, "Ler estoque", tabela, compra manual com ×10/×100, kits em `localStorage` `pokehub.kits` com a mesma validação do PC, "Revisar compra" → plano com ouro depois e uso do teto → teclado de PIN de 6 dígitos, teclas grandes, vibração curta, ou "PIN lembrado (x min)" → progresso ✓/✗ ao vivo → resumo), botões **Recarregar/Suspender/Retomar** na aba Conta e **Modo leve** na aba Contas, sempre com o motivo claro quando algo está desligado (sem "Pode agir", sem PIN, PIN bloqueado, ações desligadas).

**Banco v14** (não destrutivo, aceita 0–14): `remote_confirms` (apagada em cascata com o aparelho), `remote_purchases` e a coluna `tz` de `remote_spend`.

**Limites honestos do R4**
- Quem tem o celular desbloqueado, "Pode agir" e o PIN pode gastar até o teto do dia por conta. O teto e a confirmação nativa do PC são a rede de proteção; 200.000 por conta/dia é o padrão, não um valor "seguro" universal.
- A resposta de uma compra longa pode se perder (Wi-Fi): o celular repete com a mesma `Idempotency-Key` e recebe o resultado guardado; se a chave se perder, confira o histórico no PC.
- A garantia final do preço é a do jogo: o hub relê e o script compara o preço exato antes do clique; uma mudança no meio de um clique não é detectável.
## Implementado (R5, tela ao vivo e Controlar)

No celular: **Conta → Jogo**. O hub transmite a conta como JPEG por **WebSocket** e, com o PIN, o celular passa a **controlar** a conta.

**Protocolo** (tipos em `spike/contracts/screen.ts`; servidor em `spike/remote/screen.ts`, entrada em `screen-input.ts`, WebSocket em `ws.ts`)
- `GET /api/screen/:profileId` com `Upgrade: websocket` no mesmo servidor HTTPS, subprotocolo **`ph.v1`** (o navegador não consegue enviar `X-PH` num WebSocket, então o subprotocolo faz esse papel). **Sem dependência nova:** o `ws.ts` é um RFC 6455 mínimo só de servidor (sem extensões nem fragmentação; payload máximo de **64 KB** conferido antes de acumular; cliente sem máscara, bits reservados, fragmento, binário e UTF-8 inválido fecham o soquete). `bun audit --prod` segue sem vulnerabilidades (nada foi adicionado ao `package.json`).
- **Upgrade, na ordem:** IP na mesma sub-rede → `Host` é um IP vinculado (421) → limite geral → **`Origin` idêntico a `https://<Host>` (403; sem `Origin` também recusa: Cross-Site WebSocket Hijacking)** → cookie de aparelho válido, não revogado nem vencido (401; o upgrade **não rotaciona** o cookie) → conta conhecida (404) e **não suspensa** (409) → subprotocolo `ph.v1` (400) → limites (429): **1 espectador por conta e 2 no total** (o mesmo aparelho reconectando substitui a conexão velha) → alvo de captura que não seja o hub (403).
- Do celular só entra JSON de texto ≤ 4 KB: `ack`, `pause`/`resume`, `control` (PIN), `end-control` e `in` (entrada). Do PC saem `hello`, `status`, `stats`, `control`, `denied`, `limit`, `bye` e os **quadros** (mensagem binária: 4 bytes com o tamanho do cabeçalho, cabeçalho `{seq,w,h,at}` e o JPEG). Nenhuma mensagem leva `emailLabel`, URL nem token do jogo (há teste que varre tudo).
- Vida da conexão: ping do servidor a cada 20 s (o navegador responde sozinho); sem nenhuma mensagem por 60 s, fecha; pausada por mais de 10 min, fecha. Fecham na hora: **revogar** o aparelho, sair (`/api/logout`), aparelho vencido, **desligar o acesso remoto**, **mudar de rede** (o servidor para) e **sair do app**. Tudo isso passa por `closeStreams`/`close()` do servidor.

**Ver**
- Captura **só** de `webContents.capturePage()` da **view da conta** (`spike/electron/screen-target.ts`); nunca `desktopCapturer`, nunca a janela do hub (o hub passa `forbidden: [window.webContents]` e a captura de um alvo proibido é recusada, com teste) e nunca outra janela.
- Só transmite com a URL **exatamente** em `https://pokeidle.io`. Qualquer outra origem (login do Google/Discord, `pokeidle.io.evil.com`, `http:`, outra porta, `about:blank`) manda o estado **"conteúdo protegido"** e **não captura**. A origem é conferida antes e depois de cada captura (o quadro é descartado se mudou no meio).
- **Campo de senha com foco pausa** a captura (script constante em mundo isolado: o `activeElement` é `input[type=password]`; atravessa shadow DOM; iframe que não dá para inspecionar ou erro na verificação contam como senha). Também confere antes e depois da captura. Durante o controle, **teclas e texto não passam** se há senha com foco.
- 1–2 quadros/s (500 ms; cai para 1/s depois de 3 quadros iguais), JPEG qualidade 60, largura máxima 1280 (`nativeImage.resize`), só envia se o quadro **mudou** (MD5 do bitmap, antes de codificar o JPEG). No máximo 2 quadros sem `ack`; **sem `ack` por 10 s pausa** (`sem-ack`); o `visibilitychange` do celular manda `pause` (`oculto`) e `resume`.
- **Indicador no PC:** faixa na barra do hub ("Celular X está vendo/controlando Y") com **Encerrar controle** e **Cortar**, e o tooltip da bandeja ("tela remota: …" / "CONTROLE REMOTO: …").

**Visão oculta (medido no Electron 44, Windows)**

| Situação | `capturePage` |
|---|---|
| view visível | funciona |
| view com `setVisible(false)` (outra conta em foco, grade) e janela visível | **funciona**, quadros novos |
| view fora da tela com `setVisible(true)` (janela visível) | funciona |
| janela **escondida na bandeja** (`window.hide()`) | **nunca responde** (a promessa fica pendurada), com ou sem view visível |
| janela minimizada | funciona |
| `beginFrameSubscription` com a janela escondida | 0 quadros |

- Decisão: `capturePage` + **"janela fantasma"** só enquanto alguém assiste. Com a janela na bandeja o hub a mostra com `showInactive()`, **opacidade 0, sem botão na barra de tarefas e sem receber o mouse** (`setOpacity(0)`, `setSkipTaskbar(true)`, `setIgnoreMouseEvents(true)`); ao parar de assistir ela volta exatamente ao que era (`hide()`, opacidade 1, mouse e barra de tarefas normais). Se você abrir a janela de verdade nesse meio tempo (bandeja ou atalho), ela é devolvida ao normal sem esconder de novo; se voltar para a bandeja com alguém assistindo, o truque é reaplicado. Uma view que nunca recebeu área (modo Foco desde o início) ganha 1280×720 só enquanto a assistem, continua oculta e só é desfeita se ninguém mexeu nos limites. O `capturePage` tem prazo de 2,5 s: se não responder, o celular vê "sem imagem agora".
- Não usamos `beginFrameSubscription`: não entregou quadros com a janela escondida, e o `capturePage` a 2 qps é barato.

**Controlar**
- Exige o aparelho com **"pode agir"** (reconferido durante a sessão; remover encerra o controle), o PIN definido e as ações não desligadas. O PIN é verificado **no servidor** pela mesma `PinGuard` (mesmos bloqueios escalonados: 5 erros → 15 min, 1 h, 24 h, revoga; 10 erros/dia desligam as ações) e é **dedicado ao controle**: gera um **token de controle de 128 bits ligado a esta conexão**, válido **10 min**, **não renovável sem digitar o PIN de novo**, com **2 min de ociosidade** (só entrada aceita conta). **Um controlador por conta.** Pausada, protegida ou fora de `pokeidle.io`, a entrada é ignorada. Não reaproveita nenhuma "elevação" de compras (R4).
- **Entrada sanitizada** (`screen-input.ts`): lista fechada `md`/`mu`/`mm`/`wh`/`kd`/`ku`/`ch`, campos estritos (qualquer campo extra recusa); só o **botão esquerdo** (nada de clique direito/menu de contexto); coordenadas da imagem do celular **mapeadas** para os limites da view e **presas ao interior**; roda ±1200; `kd/ku` só Enter, Backspace, Esc, Tab, Delete, setas e letras/dígitos, e **qualquer Ctrl/Alt/Meta junto, F1–F24, Meta/Win/OS/ContextMenu, Control/Alt sozinhos** ficam **bloqueados** (F12, Ctrl+Shift+I/J/C, Ctrl+L/P/S/U/W/R/N/T, Alt+F4, F5, Alt+←/→); texto em blocos de ≤ 16 caracteres imprimíveis (sem controle nem bidi). **Taxa: 30 eventos/s (balde) e 500 caracteres/min.** O que chega ao `sendInputEvent` é montado no PC, nunca copiado do celular.
- Durante o controle a conta **só navega em `pokeidle.io`** (o `will-navigate`/`will-redirect` do hub recusa até o login do Google/Discord); downloads e pop-ups seguem bloqueados.
- **Encerrar:** botão **"Encerrar controle"** na faixa do PC, atalho global **Ctrl+Shift+F12** (registrado só enquanto alguém controla; encerra **todos** os controles e mantém a visão) e **"Cortar"** (encerra tudo). Também encerram: expirar (10 min), ociosidade (2 min), perder "pode agir", revogar, desligar, sair.
- **Auditoria** (`remote_audit`, sem migração nova): `tela_inicio` (conta, aparelho), `tela_fim` (conta, **duração**, quadros, motivo), `controle_inicio`, `controle_fim` (duração e motivo: `encerrado`, `expirou`, `ocioso`, `pc`, `permissao`, `sessao`), `controle_pin_recusado`, `tela_recusada`.

**No celular** (`spike/remote-ui/screen-ui.tsx`): imagem num `<canvas>` com **pinça e arrasto** (zoom até 5×, duplo toque alterna 2,5×), indicador de qps · latência (RTT medido pelo `ack`) · kbps, **Pausar/Retomar**, **Tela cheia** (retrato e paisagem) e **Controlar** → teclado de PIN (6 dígitos, envia no sexto). Controlando: faixa e borda vermelhas, contagem regressiva dos 10 min; **toque = clique**, **toque duplo = duplo clique**, **arrastar = arrastar** (mouse com botão), **dois dedos** = rolar (roda) ou pinça (zoom); toque longo é ignorado (nada de clique direito). Botões grandes: **Esc**, **Teclado** (campo que manda texto, Backspace e Enter), **Ajustar** e **Voltar ao jogo** (encerra o controle e volta a só ver). Pausa sozinha com o app em segundo plano e fecha ao sair da aba; respeita `prefers-reduced-motion`. Verificado em 390×844 e 800×360 com a prévia `spike/dev/remote-mock.ts` (WebSocket falso em `remote-mock-screen.ts`; PIN de teste 123456).

**Limites honestos do R5**
- **Largura de banda:** cada quadro tem em geral 40–150 KB (JPEG 60, ≤ 1280 px) a 1–2 qps, ou seja, **~50–250 KB/s** (0,4–2 Mbit/s) enquanto a imagem muda; parado, quase zero. Só Wi-Fi de casa; não há áudio.
- **Latência:** é de "quadro a cada 0,5–1 s": serve para ver e para clicar/digitar com calma, **não** para jogo em tempo real. O toque só aparece na imagem depois do próximo quadro.
- **A imagem é uma foto da view:** animações rápidas e WebGL podem sair com atraso; o `capturePage` custa CPU/GPU no PC enquanto alguém assiste (por isso 2 qps e hash).
- **Janela na bandeja:** depende do truque da janela fantasma, medido no Windows. Em outros sistemas pode não funcionar (o celular vê "sem imagem agora"). Enquanto assistem, a janela do hub fica "mostrada" invisível: pode aparecer no Alt+Tab em algumas versões e pode receber o foco de teclado se algo a ativar; ao parar de assistir volta ao normal.
- `sendInputEvent` numa view **sem foco** do SO: o mouse funciona; o teclado depende de o jogo aceitar eventos sem o foco da janela (o hub não rouba o foco do seu teclado). **A confirmar em jogo real** (P0-2 do `DESEMPENHO.md` segue valendo).
- A verificação de senha enxerga `input[type=password]`; **não** vê um campo de texto comum onde alguém digite uma senha, nem o conteúdo de iframes de outra origem (esses contam como senha, ou seja, bloqueiam). Quem controla a conta fala com o jogo como você: **o PIN, os 10 min e a faixa do PC são a proteção**, não um isolamento forte.
- Um celular pareado com "pode agir" e o PIN pode jogar a conta por 10 min por vez. O que o limita: PIN com bloqueios, 10 min, 2 min de ociosidade, um controlador, navegação travada, teclas bloqueadas e o botão/atalho no PC.

## SEGURANÇA (R1, o que é garantido de verdade)
**Garantias reais (testadas):**
- **Desligado por padrão**; ao desligar (chave, bandeja ou sair do app) todos os listeners fecham na hora. Ligar, desligar e reiniciar passam por **fila serial com contador de geração**: um *listen* lento nunca sobrevive a um "desligar" posterior.
- **Só a rede doméstica:** bind nas interfaces Privadas/físicas (Windows), origem na mesma sub-rede do soquete, sem UPnP e sem porta no roteador. Rede nova = servidor parado até você liberar.
- **Host/DNS rebinding:** `Host` precisa ser um IP vinculado ou `localhost` (421). **CSRF:** todo POST exige `Origin` idêntico e `Content-Type: application/json`; cookie `SameSite=Strict`; GETs caros exigem `X-PH: 1`.
- **Pareamento:** código de 8 caracteres (40 bits), 2 min, uso único; **5 erros por IP** bloqueiam só aquele IP e **20 no total** invalidam o código (um vizinho não queima o seu código sozinho; o modal mostra as tentativas por IP); 1 pedido pendente; SAS de 2 dígitos; confirmação **nativa**; sem resposta em 60 s = recusado; no máximo 8 aparelhos.
- **Token:** 256 bits, só o SHA-256 no banco (`timingSafeEqual`), cookie `__Host-ph` (`Secure; HttpOnly; SameSite=Strict; Path=/`). **Rotação a cada 24 h** (novo `Set-Cookie`; o anterior vale 5 min), cookie com **Max-Age de 30 dias renovado no uso**, **expira após 30 dias sem uso** e tem **limite absoluto de 180 dias** (auditoria `expirado`). Revogar derruba os fluxos SSE na hora.
- **PIN:** 6 dígitos, scrypt **assíncrono** com parâmetros **fixos** (o que estiver gravado no hash é ignorado). Contadores no **banco** (sobrevivem a reiniciar): 5 erros → bloqueio de 15 min, depois 1 h, depois 24 h; o ciclo de 5 erros seguinte **revoga o aparelho** e avisa o PC; **10 erros no dia** (todos os aparelhos) desligam as ações pelo celular até você religar no PC.
- **Limites:** 300 req/min por IP (10/min no pareamento), 8 conexões por IP, 64 no total, verificação de conexões a cada 2 s, soquete de 30 s (só o SSE passa disso), SSE ≤ 20 (4 por aparelho) com **contrapressão** (fecha quem acumula mais de 256 KB), hunt/mercado 10/min por aparelho.
- **Chaves:** CA e servidor com chave privada só em `<userData>/remote/*.key.pem`, **cifradas com o `safeStorage`** quando o sistema oferece (sem ele ficam em texto, protegidas só pela permissão do arquivo: 0600 no POSIX; no Windows, `icacls` com o **SID do usuário atual**, sem shell; se falhar, o status mostra o aviso). Nenhuma rota, IPC ou status devolve chave, token, hash de token ou caminho (há teste).
- **Sem log:** o servidor não escreve no console; erros voltam genéricos.
- **Empacotamento:** o app do celular vai para `dist-remote`; `GET /assets/main-*.js` do desktop dá 404; CSP sem origens externas.

**Limites honestos (o que NÃO é garantido):**
- O primeiro contato **depende de você comparar a impressão digital**; se não comparar, quem estiver na sua rede Wi-Fi pode se passar pelo PC. A trava `X-PH-SW` do pareamento é só **heurística** (um cliente próprio pode enviar o cabeçalho).
- Quem já está na sua rede doméstica e conhece o código dentro de 2 minutos ainda pode pedir pareamento; o que o protege é o seu olho no número de conferência e na confirmação nativa.
- A restrição de nomes da CA e a cifra das chaves **reduzem o risco**, não o eliminam (um malware rodando como você pode usar o `safeStorage`). 6 dígitos de PIN são pouco contra ataque offline ao banco.
- Não há criptografia além do TLS da LAN; o celular perde a sessão se perder a resposta do `Set-Cookie` de uma rotação por mais de 5 min (é preciso parear de novo).
- O acesso remoto **não** protege contra malware no PC ou no celular.

**Correções da auditoria (R5).** Controlar passou a exigir a permissão **separada** `can_control` (migração v15, não destrutiva; "Pode controlar a tela" na lista de aparelhos, só no PC, com diálogo nativo: controle total, gemas/ouro sem teto, Community Market, venda e troca), além do PIN; "pode agir" sozinho não basta. Ver a tela exige "pode agir" ou "pode controlar" (1 sessão por aparelho, no máximo 6 novas por minuto; início/fim repetidos em 60 s viram uma linha de auditoria com contagem). Validade, ociosidade, permissão e PIN são conferidos em cada entrada; trocar/remover o PIN encerra o controle. O PC avisa (notificação, piscar da janela, faixa atualizada por `remote:changed` com debounce de 300 ms). WebSocket: balde de 50 msgs/s (rajada 100) fecha com 1008, texto com socket parado derruba a conexão, códigos de close inválidos 1002/1007. Janela fantasma restaura ao focar; atalho global indisponível vira aviso e auditoria `atalho_indisponivel`; navegação fora do jogo durante o controle volta ao jogo e encerra o controle. Senha: o resultado em cache cai após clique/tecla e todo texto reconfere.

## Requisitos obrigatórios para R3/R4/R5
Os itens de R5 ainda não existem; **não implemente R5 sem cada item abaixo** (Push, R3, e Compras/Elevação, R4, já estão feitos: ver "Implementado (R3)" e "Implementado (R4)"):
- **Compras (R4):** *tokens de confirmação emitidos pelo servidor*, de uso único, ligados ao **hash do plano** (item, quantidade, conta, preço), com validade curta; reserva **atômica** do teto diário em SQLite (`remote_spend`, uma transação que confere e soma antes de agir). O celular nunca decide o valor.
- **Elevação por PIN no servidor:** ação que muda algo exige o PIN verificado **no servidor** (mesmos bloqueios/escalonamento), gerando uma elevação curta e vinculada ao aparelho e à ação; nada de `pin/check` que só devolve "ok".
- **Push (R3), implementado:** *allowlist* de endpoints de push (host/esquema/porta) para evitar **SSRF** ao enviar; chave **VAPID** guardada com `safeStorage` e nunca servida; payload sem dados sensíveis; assinaturas presas ao aparelho com cascata; no máximo 2 por aparelho; agrupamento/limite de taxa; sem cache de `/api` no service worker. Ver "Implementado (R3)".
- **Tela ao vivo (R5), implementado (ver "Implementado (R5)"):** capturar **somente** views de conta em `https://pokeidle.io`, **nunca** a janela do hub nem campos de senha; recusar se a URL da view mudou de origem.
- **WebSocket/stream (R5), implementado:** conferir o cabeçalho `Origin` no *upgrade*; sem ele, fechar.
- **Controlar (R5), implementado:** *allowlist* de tipos de evento de entrada (clique, tecla, rolagem) com limites de taxa e tamanho; **atalhos bloqueados** (fechar janela, DevTools, colar, Alt+F4 etc.).
- **Indicador visível no PC (R5, implementado)** enquanto houver alguém vendo/controlando (barra ou ícone na bandeja), com botão de cortar.
- **Auditoria** de toda ação (aparelho, ação, parâmetros resumidos, resultado) e revisão de segurança antes de liberar cada fase.

## O que falta
- **R3:** feito (servidor): leitor de capturas, feed, alertas e Web Push (VAPID local). Falta no app do celular a tela de Alertas/assinatura (feita à parte) e, mais tarde, Discord/ntfy.
- **R4:** feito (ver "Implementado (R4)"): Loja com confirmação do servidor, teto diário atômico, elevação por PIN, recarregar/suspender/retomar e Modo leve.
- **R5:** tela ao vivo (capturePage) e modo Controlar com PIN e expiração de 10 min, **com os requisitos acima**.
- **R4:** ações com PIN (repor kit, recarregar, suspender, Modo leve), teto diário de ouro e a Loja, **com os requisitos acima**.
- **R5:** feito (ver "Implementado (R5)"): tela ao vivo (capturePage), Controlar com PIN e expiração de 10 min. Falta validar em jogo real o teclado em view sem foco do SO e a janela fantasma fora do Windows.
- **R6:** revisão de segurança (força bruta distribuída, replay, token roubado).
- Limitações conhecidas: o ranking do Mercado no celular usa o que o PC já leu (o celular não clica nas páginas); a rede fixada usa o nome do perfil do Windows + sub-rede (sem o MAC do gateway).


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
