import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalExceptionFilter } from './global-exception.filter';
import type { AuditService } from '@modules/audit/audit.service';
import {
  AUDIT_ACCESS_KEY,
  AUDIT_MUTATION_KEY,
} from '@common/decorators/audit.decorator';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockAudit: Pick<AuditService, 'emit'>;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: {
    url: string;
    originalUrl?: string;
    method: string;
    ip?: string;
  };
  let mockHost: ArgumentsHost;
  let reflector: Reflector;
  let auditedHandler: () => void;

  beforeEach(() => {
    mockI18nContext();
    mockAudit = { emit: jest.fn() } as unknown as Pick<AuditService, 'emit'>;
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = { url: '/api/v1/test', method: 'GET', ip: '127.0.0.1' };
    auditedHandler = function audited() {};
    reflector = new Reflector();
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
      getHandler: () => auditedHandler,
    } as unknown as ArgumentsHost;
  });

  describe('in development mode', () => {
    beforeEach(() => {
      filter = new GlobalExceptionFilter(
        false,
        mockAudit as unknown as AuditService,
        reflector,
      );
    });

    it('should handle HttpException', () => {
      const exception = new BadRequestException('Bad input');
      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorCode: 'COMMON_BAD_REQUEST',
          lang: 'en',
        }),
      );
    });

    it('should handle NotFoundException', () => {
      filter.catch(new NotFoundException('Not found'), mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'COMMON_NOT_FOUND',
          lang: 'en',
        }),
      );
    });

    it('should map Prisma P2002 to 409 CONFLICT', () => {
      const prismaError = { code: 'P2002', meta: { target: ['email'] } };
      filter.catch(prismaError, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'COMMON_RESOURCE_ALREADY_EXISTS',
          message: 'exception.resource_already_exists',
          details: { target: ['email'] },
          lang: 'en',
        }),
      );
    });

    it('should map Prisma P2025 to 404 NOT_FOUND', () => {
      filter.catch({ code: 'P2025' }, mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'COMMON_RESOURCE_NOT_FOUND',
          message: 'exception.resource_not_found',
          lang: 'en',
        }),
      );
    });

    it('should map Prisma P2003 to 400 BAD_REQUEST', () => {
      filter.catch({ code: 'P2003' }, mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'COMMON_RELATED_RESOURCE_NOT_FOUND',
          lang: 'en',
        }),
      );
    });

    it('should map Prisma P2024 to 503 SERVICE_UNAVAILABLE', () => {
      filter.catch({ code: 'P2024' }, mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(503);
    });

    it('should handle unknown errors as 500', () => {
      filter.catch(new Error('something broke'), mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'COMMON_INTERNAL_ERROR',
          message: 'exception.unexpected_error',
          details: 'something broke',
          lang: 'en',
        }),
      );
    });
  });

  describe('403 audit gating', () => {
    beforeEach(() => {
      filter = new GlobalExceptionFilter(
        false,
        mockAudit as unknown as AuditService,
        reflector,
      );
    });

    it('emits AUTH_ACCESS_DENIED when handler is audit-tagged', () => {
      Reflect.defineMetadata(
        AUDIT_MUTATION_KEY,
        { code: 'PATIENT_DELETED', resource: 'patient' },
        auditedHandler,
      );
      filter.catch(new ForbiddenException('nope'), mockHost);
      expect(mockAudit.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_ACCESS_DENIED',
          outcome: 'denied',
        }),
      );
    });

    it('skips emit when handler has no audit metadata', () => {
      filter.catch(new ForbiddenException('nope'), mockHost);
      expect(mockAudit.emit).not.toHaveBeenCalled();
    });

    it('debounces repeated 403s on the same path within window', () => {
      Reflect.defineMetadata(
        AUDIT_ACCESS_KEY,
        { code: 'CLINICAL_NOTE_VIEWED' },
        auditedHandler,
      );
      filter.catch(new ForbiddenException(), mockHost);
      filter.catch(new ForbiddenException(), mockHost);
      filter.catch(new ForbiddenException(), mockHost);
      expect(mockAudit.emit).toHaveBeenCalledTimes(1);
    });

    it('emits again for a different path even within debounce window', () => {
      Reflect.defineMetadata(
        AUDIT_ACCESS_KEY,
        { code: 'CLINICAL_NOTE_VIEWED' },
        auditedHandler,
      );
      filter.catch(new ForbiddenException(), mockHost);
      mockRequest.url = '/api/v1/other';
      filter.catch(new ForbiddenException(), mockHost);
      expect(mockAudit.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('in production mode', () => {
    beforeEach(() => {
      filter = new GlobalExceptionFilter(
        true,
        mockAudit as unknown as AuditService,
        reflector,
      );
    });

    it('should hide error details for unknown errors', () => {
      filter.catch(new Error('db crashed'), mockHost);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ details: expect.anything() }),
      );
    });

    it('should hide Prisma meta details', () => {
      filter.catch({ code: 'P2002', meta: { target: ['email'] } }, mockHost);
      const jsonArg = mockResponse.json.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(jsonArg.details).toBeUndefined();
    });
  });
});
