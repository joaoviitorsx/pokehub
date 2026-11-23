export type AuditVerdict = 'leitura' | 'interage' | 'bloqueada';
export type FindingKind = 'network' | 'link' | 'fetch' | 'click' | 'dispatch' | 'send' | 'eval' | 'skipped';
export interface AuditFinding { kind: FindingKind; file: string; detail: string }
export interface AuditResult { verdict: AuditVerdict; findings: AuditFinding[] }
export interface ExtensionInfo {
  id: string;
  catalogId: string | null; // extensão conhecida (/hunt, Smart Market) ou null para pasta adicionada à mão
  name: string;
  version: string | null;
  path: string;
  enabled: boolean;
  loaded: number; // sessões abertas com a extensão carregada
  sessions: number;
  verdict: AuditVerdict | null;
  findings: AuditFinding[];
  error: string | null; // pasta inválida, bloqueada ou falha ao carregar; as sessões seguem sem a extensão
}
