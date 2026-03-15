import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '@modules/config';
import { REDIS_CLIENT } from './redis.constants';

const logger = new Logger('RedisProvider');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (config: AppConfigService): Redis => {
    const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB } = config.redis;

    const client = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD || undefined,
      db: REDIS_DB,
      maxRetriesPerRequest: 3,
      commandTimeout: 5000,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('Redis max retry attempts reached');
          return null;
        }
        return Math.min(times * 200, 5000);
      },
    });

    client.on('connect', () => logger.log('Redis connected'));
    client.on('error', (err) => logger.error('Redis error', err.message));
    client.on('reconnecting', () => logger.warn('Redis reconnecting'));

    return client;
  },
  inject: [AppConfigService],
};
