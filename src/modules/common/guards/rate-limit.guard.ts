import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_KEY,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW,
} from '@common/constants';
import type { RateLimitOptions } from '@common/decorators';
import { CacheService } from '@modules/redis';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const limit = options?.limit ?? DEFAULT_RATE_LIMIT_MAX;
    const windowSeconds = options?.windowSeconds ?? DEFAULT_RATE_LIMIT_WINDOW;

    /* eslint-disable @typescript-eslint/no-unsafe-argument */
    const request = context.switchToHttp().getRequest();
    const ip: string = request.ip ?? 'unknown';
    const route = `${request.method}:${request.route?.path ?? request.url}`;
    const key = this.buildKey(options, ip, route, request);
    /* eslint-enable @typescript-eslint/no-unsafe-argument */

    const count = await this.cacheService.increment(
      'rate_limit',
      key,
      windowSeconds,
    );

    if (count > limit) {
      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', String(windowSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded. Try again in ${windowSeconds} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private buildKey(
    options: RateLimitOptions | undefined,
    ip: string,
    route: string,
    request: { body?: { email?: string } },
  ): string {
    if (options?.keyExtractor === 'ip+body:email') {
      const email = request.body?.email ?? 'unknown';
      return `${ip}:${email}:${route}`;
    }
    return `${ip}:${route}`;
  }
}
