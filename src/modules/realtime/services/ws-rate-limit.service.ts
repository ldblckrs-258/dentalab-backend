import { Injectable } from '@nestjs/common';
import { CacheService } from '@modules/redis';
import type { Socket } from 'socket.io';

const CACHE_DOMAIN_WS = 'ws_rate_limit';

@Injectable()
export class WsRateLimitService {
  constructor(private readonly cacheService: CacheService) {}

  async checkHandshake(
    client: Socket,
    limit = 10,
    windowSeconds = 60,
  ): Promise<boolean> {
    const ip = client.handshake.address ?? 'unknown';
    const key = `handshake:${ip}`;

    const count = await this.cacheService.increment(
      CACHE_DOMAIN_WS,
      key,
      windowSeconds,
    );

    return count <= limit;
  }

  async checkEvent(
    userId: string,
    event: string,
    limit = 60,
    windowSeconds = 60,
  ): Promise<boolean> {
    const key = `event:${userId}:${event}`;

    const count = await this.cacheService.increment(
      CACHE_DOMAIN_WS,
      key,
      windowSeconds,
    );

    return count <= limit;
  }
}
