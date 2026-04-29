import { of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUDIT_MUTATION_KEY } from '@common/decorators/audit.decorator';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditService } from './audit.service';
import type { PrismaService } from '@modules/database';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let reflector: Reflector;
  let auditService: { emit: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    auditService = { emit: jest.fn() };
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
    mutation?: { code: string; resource: string };
    method?: string;
    params?: Record<string, string>;
    user?: { id: string };
    ip?: string;
  }) {
    jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
      if (key === AUDIT_MUTATION_KEY) return overrides.mutation;
      return undefined;
    });

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          method: overrides.method ?? 'POST',
          params: overrides.params ?? {},
          user: overrides.user,
          ip: overrides.ip ?? '127.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should pass through when no @AuditMutation decorator', (done) => {
    const context = createContext({});
    const next = { handle: () => of('data') };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        expect(auditService.emit).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('should emit on POST create with user resource', (done) => {
    const context = createContext({
      mutation: { code: 'USER_CREATED', resource: 'user' },
      method: 'POST',
      user: { id: 'u1' },
      ip: '1.2.3.4',
    });
    const responseData = { id: 'new-1', name: 'Alice' };
    const next = { handle: () => of(responseData) };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        // emit() fires setImmediate internally; wait one tick for it
        setImmediate(() => {
          expect(auditService.emit).toHaveBeenCalledWith(
            expect.objectContaining({
              code: 'USER_CREATED',
              resource: 'user',
              resourceId: 'new-1',
            }),
          );
          done();
        });
      },
    });
  });
});
