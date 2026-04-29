import type { AuditEventCode } from './audit-events';

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEventInput<C extends AuditEventCode = AuditEventCode> {
  code: C;
  outcome?: AuditOutcome;
  resource?: string;
  resourceId?: string;
  parentResource?: string;
  parentId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  reason?: string;
  actorType?: string;
  /** Override the actor resolved from RequestContext (e.g. for pre-auth events like login). */
  actorId?: string;
  actorEmail?: string;
  source?: string;
}
