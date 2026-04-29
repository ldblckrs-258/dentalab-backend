import { RequestContextService } from '@modules/common/context/request-context';

export function getAuditActorContext(): {
  actorId?: string;
  actorEmail?: string;
  actorRoleCodes: string[];
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
} {
  const ctx = RequestContextService.getCurrentContext();
  if (!ctx) {
    return { actorRoleCodes: [] };
  }
  return {
    actorId: ctx.userId,
    actorEmail: ctx.actorEmail,
    actorRoleCodes: ctx.roleCodes ?? [],
    requestId: ctx.requestId,
    sessionId: ctx.sessionId,
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
  };
}
