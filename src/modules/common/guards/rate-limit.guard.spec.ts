import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import type { CacheService } from '@modules/redis';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let cacheService: { increment: jest.Mock };

  beforeEach(() => {
    mockI18nContext();
    reflector = new Reflector();
    cacheService = {
      increment: jest.fn().mockResolvedValue(1),
    };
    guard = new RateLimitGuard(
      reflector,
      cacheService as unknown as CacheService,
    );
  });

  function createContext(
    overrides: {
      limit?: number;
      windowSeconds?: number;
      keyExtractor?: string;
      ip?: string;
      email?: string;
      path?: string;
      method?: string;
    } = {},
  ) {
    const options = overrides.limit
      ? {
          limit: overrides.limit,
          windowSeconds: overrides.windowSeconds ?? 60,
          keyExtractor: overrides.keyExtractor,
        }
      : undefined;

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(options as never);

    const mockResponse = { setHeader: jest.fn() };

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          ip: overrides.ip ?? '127.0.0.1',
          method: overrides.method ?? 'POST',
          route: { path: overrides.path ?? '/auth/login' },
          body: { email: overrides.email },
        }),
        getResponse: () => mockResponse,
      }),
      response: mockResponse,
    } as unknown as ExecutionContext;
  }

  it('should allow requests under the limit', async () => {
    cacheService.increment.mockResolvedValue(1);
    const ctx = createContext({ limit: 5 });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should throw 429 when limit is exceeded', async () => {
    cacheService.increment.mockResolvedValue(6);
    const ctx = createContext({ limit: 5, windowSeconds: 60 });

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const exc = e as HttpException;
      expect(exc.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = exc.getResponse() as Record<string, unknown>;
      expect(response.message).toBe('Rate limit exceeded.');
      expect(response.errorCode).toBe('COMMON_RATE_LIMIT_EXCEEDED');
    }
  });

  it('should use default limits when no decorator options', async () => {
    cacheService.increment.mockResolvedValue(1);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const ctx = createContext();
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(cacheService.increment).toHaveBeenCalledWith(
      'rate_limit',
      expect.any(String),
      60,
    );
  });

  it('should include email in key when keyExtractor is ip+body:email', async () => {
    cacheService.increment.mockResolvedValue(1);
    const ctx = createContext({
      limit: 5,
      keyExtractor: 'ip+body:email',
      ip: '1.2.3.4',
      email: 'user@test.com',
      path: '/auth/login',
    });

    await guard.canActivate(ctx);
    expect(cacheService.increment).toHaveBeenCalledWith(
      'rate_limit',
      '1.2.3.4:user@test.com:POST:/auth/login',
      60,
    );
  });
});
