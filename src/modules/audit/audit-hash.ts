import { createHash } from 'crypto';
import stringify from 'fast-json-stable-stringify';

export interface HashInput {
  eventCode: string;
  eventVersion: number;
  actorId?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  createdAt: string;
}

export function computeAuditHash(
  event: HashInput,
  hashPrev: string | null,
): string {
  const canonical = stringify({
    event_code: event.eventCode,
    event_version: event.eventVersion,
    actor_id: event.actorId ?? null,
    resource: event.resource ?? null,
    resource_id: event.resourceId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    metadata: event.metadata ?? null,
    created_at: event.createdAt,
  });
  return createHash('sha256')
    .update(canonical)
    .update(hashPrev ?? '')
    .digest('hex');
}
