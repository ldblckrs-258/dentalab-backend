import {
  Global,
  Inject,
  Module,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { redisProvider } from './redis.provider';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [redisProvider, CacheService],
  exports: [CacheService, redisProvider],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('Redis disconnected');
  }
}
