export type AuditVerdict = 'leitura' | 'interage' | 'externa' | 'bloqueada';
export type FindingKind = 'network' | 'link' | 'fetch' | 'click' | 'dispatch' | 'send' | 'eval' | 'skipped';
export interface AuditFinding { kind: FindingKind; file: string; detail: string }
export interface AuditResult { verdict: AuditVerdict; findings: AuditFinding[]; hosts: string[] }
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
  hosts: string[]; // sites externos achados pela auditoria (veredito 'externa')
  approvedHosts: string[]; // permitidos: os do catálogo mais os que o usuário aprovou
  pending: boolean; // 'externa' com hosts ainda não aprovados: não carrega até o usuário permitir
  error: string | null; // pasta inválida, bloqueada ou falha ao carregar; as sessões seguem sem a extensão
}
