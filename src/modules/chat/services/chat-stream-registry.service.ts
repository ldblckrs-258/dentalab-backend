import { Injectable } from '@nestjs/common';
import { CacheService } from '@modules/redis/cache.service';

const DOMAIN = 'chat-inflight';
const INITIAL_TTL_SECONDS = 60;
const HARD_CAP_SECONDS = 180;

@Injectable()
export class ChatStreamRegistryService {
  constructor(private readonly cache: CacheService) {}

  static get hardCapSeconds(): number {
    return HARD_CAP_SECONDS;
  }

  async acquire(sessionId: string): Promise<boolean> {
    return this.cache.setWithNX(DOMAIN, sessionId, '1', INITIAL_TTL_SECONDS);
  }

  async refresh(sessionId: string): Promise<void> {
    await this.cache.expire(DOMAIN, sessionId, INITIAL_TTL_SECONDS);
  }

  async release(sessionId: string): Promise<void> {
    await this.cache.del(DOMAIN, sessionId);
  }

  async isActive(sessionId: string): Promise<boolean> {
    return this.cache.exists(DOMAIN, sessionId);
  }
}
