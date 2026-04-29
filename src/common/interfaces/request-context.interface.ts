export interface RequestContext {
  userId?: string;
  actorEmail?: string;
  roleCodes?: string[];
  sessionId?: string;
  userAgent?: string;
  requestId: string;
  ip: string;
  timestamp: Date;
}
