export interface RequestContext {
  userId?: string;
  requestId: string;
  ip: string;
  timestamp: Date;
}
