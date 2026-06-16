import { AppConfigService } from '@modules/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalTokenGuard } from './internal-token.guard';

const VALID_TOKEN = 'super-secret-rag-token-1234567890';

describe('InternalTokenGuard', () => {
  let guard: InternalTokenGuard;

  beforeEach(() => {
    const config = {
      ai: { RAG_SERVICE_TOKEN: VALID_TOKEN },
    } as unknown as AppConfigService;
    guard = new InternalTokenGuard(config);
  });

  function contextWith(token: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-internal-token': token } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows a request carrying the exact internal token', () => {
    expect(guard.canActivate(contextWith(VALID_TOKEN))).toBe(true);
  });

  it('rejects a same-length but different token', () => {
    const wrong = 'x'.repeat(VALID_TOKEN.length);
    expect(() => guard.canActivate(contextWith(wrong))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token of different length (no length oracle bypass)', () => {
    expect(() => guard.canActivate(contextWith(VALID_TOKEN + 'extra'))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(contextWith(VALID_TOKEN.slice(0, 5))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a missing token header', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-string (array) token header', () => {
    expect(() => guard.canActivate(contextWith([VALID_TOKEN]))).toThrow(
      UnauthorizedException,
    );
  });
});
