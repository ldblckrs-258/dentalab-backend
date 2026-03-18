import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: { url: string; method: string };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    mockI18nContext();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = { url: '/api/v1/test', method: 'GET' };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;
  });

  describe('in development mode', () => {
    beforeEach(() => {
      filter = new GlobalExceptionFilter(false);
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

  describe('in production mode', () => {
    beforeEach(() => {
      filter = new GlobalExceptionFilter(true);
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
