# ADR-002 — WebContentsView e partições

Status: proposta para spike (2026-11-10).

Decisão: Main cria até quatro WebContentsView, cada uma com partição `persist:pokehub-spike-N`; não há preload nas views remotas, Node está desabilitado e sandbox e isolamento de contexto habilitados. O foco altera visibilidade e bounds sem recriar as views. A redução do número fecha views excedentes; armazenamento não é apagado. IDs fixos são exclusivos deste experimento, não modelo de perfis de produção.

As APIs Electron documentam que partições `persist:` são persistentes e a mesma partição compartilha sessão: https://www.electronjs.org/docs/latest/api/session . Persistência e isolamento reais ainda precisam de verificação. A navegação é limitada à origem do jogo e popups são negados; isso pode bloquear SSO, que deve ser investigado sem bypass. Revisar após testes de autenticação, resize, DPI, falhas e ciclo de vida nos dois sistemas.
