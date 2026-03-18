import { of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResponseInterceptor } from './response.interceptor';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    mockI18nContext();
    reflector = new Reflector();
    interceptor = new ResponseInterceptor(reflector);
  });

  function createContext(skipWrap = false) {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(skipWrap);

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should wrap response in ApiResponse envelope', (done) => {
    const context = createContext(false);
    const next = { handle: () => of({ id: 1, name: 'test' }) };

    interceptor
      .intercept(context, next)
      .subscribe((result: Record<string, unknown>) => {
        expect(result.statusCode).toBe(200);
        expect(result.message).toBe('common.success');
        expect(result.data).toEqual({ id: 1, name: 'test' });
        expect(result.lang).toBe('en');
        expect(result.timestamp).toBeDefined();
        done();
      });
  });

  it('should skip wrapping when @SkipResponseWrap is set', (done) => {
    const context = createContext(true);
    const rawData = { custom: 'response' };
    const next = { handle: () => of(rawData) };

    interceptor.intercept(context, next).subscribe((result: unknown) => {
      expect(result).toEqual(rawData);
      done();
    });
  });
});
