import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_NAMESPACE,
  DEFAULT_CACHE_TTL,
} from './redis.constants';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private buildKey(domain: string, identifier: string): string {
    return `${REDIS_NAMESPACE}:${domain}:${identifier}`;
  }

  async get<T>(
    domain: string,
    identifier: string,
    critical = false,
  ): Promise<T | null> {
    try {
      const key = this.buildKey(domain, identifier);
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      if (critical) throw error;
      this.logger.warn(
        `Cache get failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set<T>(
    domain: string,
    identifier: string,
    value: T,
    ttlSeconds: number = DEFAULT_CACHE_TTL,
  ): Promise<void> {
    try {
      const key = this.buildKey(domain, identifier);
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      this.logger.warn(
        `Cache set failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
    }
  }

  async del(domain: string, identifier: string): Promise<void> {
    try {
      const key = this.buildKey(domain, identifier);
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `Cache del failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
    }
  }

  async exists(domain: string, identifier: string): Promise<boolean> {
    try {
      const key = this.buildKey(domain, identifier);
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(
        `Cache exists failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async setWithNX<T>(
    domain: string,
    identifier: string,
    value: T,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      const key = this.buildKey(domain, identifier);
      const result = await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `Cache setWithNX failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async increment(
    domain: string,
    identifier: string,
    ttlSeconds: number,
  ): Promise<number> {
    try {
      const key = this.buildKey(domain, identifier);
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttlSeconds);
      }
      return count;
    } catch (error) {
      this.logger.warn(
        `Cache increment failed for ${domain}:${identifier}: ${(error as Error).message}`,
      );
      return 0;
    }
  }
}
