import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsRateLimitService } from '../services';
import { WsErrorCode } from '../interfaces';
import type { AuthenticatedSocket } from '../interfaces';

@Injectable()
export class WsEventRateLimitGuard implements CanActivate {
  constructor(private readonly wsRateLimit: WsRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const event = context.switchToWs().getPattern();

    if (!client.data?.userId) {
      throw new WsException(WsErrorCode.WS_UNAUTHORIZED);
    }

    const allowed = await this.wsRateLimit.checkEvent(
      client.data.userId,
      event,
    );

    if (!allowed) {
      throw new WsException(WsErrorCode.WS_RATE_LIMITED);
    }

    return true;
  }
}
