import {
  CACHE_ENDPOINT_KEY,
  CACHE_INVALIDATE_KEY,
  type CacheEndpointOptions,
} from '@common/decorators';
import { CacheService, DEFAULT_CACHE_TTL } from '@modules/redis';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, map, mergeMap, of } from 'rxjs';

@Injectable()
export class CacheEndpointInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const cacheOptions = this.reflector.getAllAndOverride<CacheEndpointOptions>(
      CACHE_ENDPOINT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const invalidateDomain = this.reflector.getAllAndOverride<string>(
      CACHE_INVALIDATE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (cacheOptions) {
      const request = context.switchToHttp().getRequest<{
        method: string;
        originalUrl?: string;
        url: string;
      }>();
      const response = context.switchToHttp().getResponse<{
        setHeader: (name: string, value: string) => void;
      }>();
      const cacheKey = `${request.method}:${request.originalUrl ?? request.url}`;

      return from(this.cacheService.get(cacheOptions.domain, cacheKey)).pipe(
        mergeMap((cached) => {
          if (cached !== null) {
            response.setHeader('X-Cache', 'HIT');
            return of(cached);
          }

          response.setHeader('X-Cache', 'MISS');
          return next
            .handle()
            .pipe(
              mergeMap((value) =>
                from(
                  this.cacheService.set(
                    cacheOptions.domain,
                    cacheKey,
                    value,
                    Number(cacheOptions.ttl ?? DEFAULT_CACHE_TTL),
                  ),
                ).pipe(map(() => value)),
              ),
            );
        }),
      );
    }

    if (invalidateDomain) {
      return next
        .handle()
        .pipe(
          mergeMap((value) =>
            from(this.cacheService.invalidateDomain(invalidateDomain)).pipe(
              map(() => value),
            ),
          ),
        );
    }

    return next.handle();
  }
}
