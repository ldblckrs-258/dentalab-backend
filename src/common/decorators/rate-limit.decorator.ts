import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '@common/constants';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  keyExtractor?: 'ip' | 'ip+body:email';
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
