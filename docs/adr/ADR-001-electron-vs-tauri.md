# ADR-001 — Electron para o experimento

Status: proposta, sujeita ao gate da Etapa 0 (2026-11-10).

Contexto: quatro páginas independentes exigem isolamento de armazenamento, manutenção de views e comportamento consistente entre Windows e Linux. Tauri usa motores dependentes da plataforma, acrescentando uma variável ao experimento.

Decisão: testar Electron/Chromium com React e TypeScript, sem considerá-lo aprovado para produção antes da autenticação, estabilidade e medição nos dois sistemas. Fonte: https://www.electronjs.org/docs/latest/api/web-contents-view

Consequências: custo potencial de memória e distribuição; uma implementação testável sem comprovação de compatibilidade não demonstra viabilidade. Revisar se autenticação legítima, consumo ou suporte de plataforma impedir o gate.
