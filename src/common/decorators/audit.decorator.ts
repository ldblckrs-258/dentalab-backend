import { SetMetadata } from '@nestjs/common';
import type { AuditEventCode } from '@modules/audit/audit-events';

export const AUDIT_MUTATION_KEY = 'audit_mutation';
export const AUDIT_ACCESS_KEY = 'audit_access';

export interface AuditMutationConfig {
  code: AuditEventCode;
  resource: string;
  paramKey?: string;
  useActorUserId?: boolean;
}

export interface AuditAccessConfig {
  code: AuditEventCode;
  paramKey?: string;
  debounceSeconds?: number;
  resource?: string;
}

export const AuditMutation = (config: AuditMutationConfig) =>
  SetMetadata(AUDIT_MUTATION_KEY, config);

export const AuditAccess = (
  code: AuditEventCode,
  opts?: Omit<AuditAccessConfig, 'code'>,
) =>
  SetMetadata(AUDIT_ACCESS_KEY, { code, ...opts } satisfies AuditAccessConfig);
