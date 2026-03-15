import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InfrastructureException } from './infrastructure.exception';

const HTTP_STATUS_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

// Prisma error codes
const PRISMA_ERROR_MAP: Record<
  string,
  { status: number; errorCode: string; message: string }
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    errorCode: 'UNIQUE_CONSTRAINT_VIOLATION',
    message: 'Resource already exists',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    errorCode: 'NOT_FOUND',
    message: 'Resource not found',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    errorCode: 'FOREIGN_KEY_CONSTRAINT',
    message: 'Related resource not found',
  },
  P2024: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    errorCode: 'DATABASE_TIMEOUT',
    message: 'Database connection timed out',
  },
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, errorCode, message, details } =
      this.resolveException(exception);

    const errorResponse = {
      statusCode,
      errorCode,
      message,
      ...(this.isProduction ? {} : { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${statusCode} - ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${statusCode} - ${message}`,
      );
    }

    response.status(statusCode).json(errorResponse);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    errorCode: string;
    message: string;
    details?: unknown;
  } {
    // NestJS HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const errorCode =
        exception instanceof InfrastructureException
          ? exception.errorCode
          : this.httpStatusToErrorCode(status);

      if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        const message = Array.isArray(resp.message)
          ? (resp.message[0] as string)
          : ((resp.message as string) ?? exception.message);
        return {
          statusCode: status,
          errorCode,
          message,
          // Only include details for validation errors (message array)
          details: Array.isArray(resp.message) ? resp.message : undefined,
        };
      }

      return {
        statusCode: status,
        errorCode,
        message: typeof response === 'string' ? response : exception.message,
      };
    }

    // Prisma known errors
    if (this.isPrismaError(exception)) {
      const code = (exception as any).code as string;
      const mapped = PRISMA_ERROR_MAP[code];
      if (mapped) {
        return {
          statusCode: mapped.status,
          errorCode: mapped.errorCode,
          message: mapped.message,
          details: this.isProduction ? undefined : (exception as any).meta,
        };
      }
    }

    // Unknown errors
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: exception instanceof Error ? exception.message : undefined,
    };
  }

  private isPrismaError(exception: unknown): boolean {
    return (
      exception !== null &&
      typeof exception === 'object' &&
      'code' in exception &&
      typeof (exception as any).code === 'string' &&
      (exception as any).code.startsWith('P')
    );
  }

  private httpStatusToErrorCode(status: number): string {
    return HTTP_STATUS_ERROR_CODES[status] ?? 'UNKNOWN_ERROR';
  }
}
