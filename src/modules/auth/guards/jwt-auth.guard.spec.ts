import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

jest.mock('@nestjs/passport', () => {
  class MockAuthGuard {
    canActivate() {
      return Promise.resolve(true);
    }
  }
  return {
    AuthGuard: () => MockAuthGuard,
  };
});

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  function createMockContext(): ExecutionContext {
    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('should return true for @Public() routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should delegate to parent AuthGuard for non-public routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext();
    const result = guard.canActivate(context);
    expect(result).toEqual(expect.any(Promise));
  });
});
