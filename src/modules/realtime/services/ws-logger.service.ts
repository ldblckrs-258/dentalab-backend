import { Logger } from '@nestjs/common';

export interface WsLogContext {
  namespace?: string;
  clientId?: string;
  userId?: string;
  room?: string;
  event?: string;
  reason?: string;
}

export class WsLoggerService {
  private readonly logger: Logger;

  constructor(context?: string) {
    this.logger = new Logger(context ?? 'WsLogger');
  }

  private formatMsg(msg: string, ctx?: WsLogContext): string {
    let out = msg;
    if (!ctx) return out;
    const parts: string[] = [];
    if (ctx.namespace) parts.push(`ns=${ctx.namespace}`);
    if (ctx.clientId) parts.push(`client=${ctx.clientId}`);
    if (ctx.userId) parts.push(`user=${ctx.userId}`);
    if (ctx.room) parts.push(`room=${ctx.room}`);
    if (ctx.event) parts.push(`event=${ctx.event}`);
    if (ctx.reason) parts.push(`reason=${ctx.reason}`);
    if (parts.length) out += ` [${parts.join(', ')}]`;
    return out;
  }

  debug(msg: string, ctx?: WsLogContext): void {
    this.logger.debug(this.formatMsg(msg, ctx));
  }

  log(msg: string, ctx?: WsLogContext): void {
    this.logger.log(this.formatMsg(msg, ctx));
  }

  warn(msg: string, ctx?: WsLogContext): void {
    this.logger.warn(this.formatMsg(msg, ctx));
  }

  error(msg: string, trace?: string, ctx?: WsLogContext): void {
    this.logger.error(this.formatMsg(msg, ctx), trace);
  }
}
