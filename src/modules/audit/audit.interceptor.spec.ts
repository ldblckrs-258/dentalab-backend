import { of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditService } from './audit.service';
import type { PrismaService } from '@modules/database';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let reflector: Reflector;
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      baseClient: {
        user: { findUnique: jest.fn() },
      },
    };
    interceptor = new AuditInterceptor(
      reflector,
      auditService as unknown as AuditService,
      prisma as unknown as PrismaService,
    );
  });

  function createContext(overrides: {
    resourceName?: string;
    method?: string;
    params?: Record<string, string>;
    userId?: string;
    ip?: string;
  }) {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue(overrides.resourceName as never);

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          method: overrides.method ?? 'POST',
          params: overrides.params ?? {},
          user: overrides.userId ? { id: overrides.userId } : undefined,
          ip: overrides.ip ?? '127.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should pass through when no @Audited decorator', async () => {
    const context = createContext({});
    const next = { handle: () => of('data') };

    const result = await interceptor.intercept(context, next);
    expect(result).toBeDefined();
  });

  it('should pass through for GET requests (no action mapped)', async () => {
    const context = createContext({ resourceName: 'user', method: 'GET' });
    const next = { handle: () => of('data') };

    const result = await interceptor.intercept(context, next);
    expect(result).toBeDefined();
  });

  it('should capture audit data for POST (create) action', (done) => {
    const context = createContext({
      resourceName: 'user',
      method: 'POST',
      userId: 'u1',
      ip: '1.2.3.4',
    });
    const responseData = { id: 'new-1', name: 'Alice' };
    const next = { handle: () => of(responseData) };

    void interceptor.intercept(context, next).then((obs) => {
      obs.subscribe({
        next: () => {
          setImmediate(() => {
            expect(auditService.log).toHaveBeenCalledWith(
              expect.objectContaining({
                userId: 'u1',
                action: 'create',
                resource: 'user',
                ipAddress: '1.2.3.4',
              }),
            );
            done();
          });
        },
      });
    });
  });
});
