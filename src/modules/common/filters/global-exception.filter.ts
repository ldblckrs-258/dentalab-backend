import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { DEFAULT_LANGUAGE, ErrorCode } from '@common/constants';
import { InfrastructureException } from './infrastructure.exception';

const HTTP_STATUS_ERROR_CODES: Record<number, string> = {
  400: ErrorCode.COMMON_BAD_REQUEST,
  401: ErrorCode.COMMON_UNAUTHORIZED,
  403: ErrorCode.COMMON_FORBIDDEN,
  404: ErrorCode.COMMON_NOT_FOUND,
  409: ErrorCode.COMMON_CONFLICT,
  422: ErrorCode.COMMON_UNPROCESSABLE_ENTITY,
  429: ErrorCode.COMMON_RATE_LIMIT_EXCEEDED,
  500: ErrorCode.COMMON_INTERNAL_ERROR,
  503: ErrorCode.COMMON_SERVICE_UNAVAILABLE,
};

// Prisma error codes
const PRISMA_ERROR_MAP: Record<
  string,
  { status: number; errorCode: string; messageKey: string; fallback: string }
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.COMMON_RESOURCE_ALREADY_EXISTS,
    messageKey: 'exception.resource_already_exists',
    fallback: 'Resource already exists',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    errorCode: ErrorCode.COMMON_RESOURCE_NOT_FOUND,
    messageKey: 'exception.resource_not_found',
    fallback: 'Resource not found',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    errorCode: ErrorCode.COMMON_RELATED_RESOURCE_NOT_FOUND,
    messageKey: 'exception.related_resource_not_found',
    fallback: 'Related resource not found',
  },
  P2023: {
    status: HttpStatus.BAD_REQUEST,
    errorCode: ErrorCode.COMMON_INVALID_INPUT,
    messageKey: 'exception.invalid_input',
    fallback: 'Invalid input value',
  },
  P2024: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    errorCode: ErrorCode.COMMON_DATABASE_TIMEOUT,
    messageKey: 'exception.database_timeout',
    fallback: 'Database connection timed out',
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
    const i18n = I18nContext.current(host);

    const { statusCode, errorCode, message, details } = this.resolveException(
      exception,
      i18n,
    );

    const errorResponse = {
      statusCode,
      errorCode,
      message,
      ...(this.isProduction ? {} : { details }),
      lang: i18n?.lang ?? DEFAULT_LANGUAGE,
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

  private resolveException(
    exception: unknown,
    i18n?: I18nContext,
  ): {
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
          message: i18n?.t(mapped.messageKey) ?? mapped.fallback,
          details: this.isProduction ? undefined : (exception as any).meta,
        };
      }
    }

    // Unknown errors
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCode.COMMON_INTERNAL_ERROR,
      message:
        i18n?.t('exception.unexpected_error') ?? 'An unexpected error occurred',
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
    return HTTP_STATUS_ERROR_CODES[status] ?? ErrorCode.COMMON_UNKNOWN_ERROR;
  }
}
