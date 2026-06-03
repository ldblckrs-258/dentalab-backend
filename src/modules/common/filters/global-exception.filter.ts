import { DEFAULT_LANGUAGE, ErrorCode } from '@common/constants';
import {
  AUDIT_ACCESS_KEY,
  AUDIT_MUTATION_KEY,
} from '@common/decorators/audit.decorator';
import { getAuditActorContext } from '@modules/audit/audit-context';
import { AuditService } from '@modules/audit/audit.service';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  ValidationError,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { InfrastructureException } from './infrastructure.exception';

// Route segments used to identify auth endpoints in exception-based audit emission.
// Must match the controller path segments (without the global API prefix).
const AUTH_LOGIN_ROUTE_SEGMENT = '/auth/login';
const AUTH_ROUTE_SEGMENT = '/auth/';
const PHI_ROUTE_SEGMENTS = ['/patients', '/clinical-notes', '/patient-files'];

// 403 noise control: dedupe per (actor|ip):path:status within a TTL window so
// frontend speculative probes and stale-token refresh storms don't flood the
// audit log. Cap the map to bound memory; sweep oldest entries when full.
const DENIED_DEBOUNCE_TTL_MS = 60_000;
const DENIED_DEBOUNCE_MAX_SIZE = 10_000;

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
  private readonly deniedDebounce = new Map<string, number>();

  constructor(
    private readonly isProduction: boolean,
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const i18n = I18nContext.current(host);

    const { statusCode, errorCode, message, details } = this.resolveException(
      exception,
      i18n,
    );

    this.maybeAuditHttpFailure(host, request, statusCode, errorCode);

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
      const suffix = this.formatPermissionLogSuffix(statusCode, details);
      this.logger.warn(
        `${request.method} ${request.url} ${statusCode} - ${message}${suffix}`,
      );
    }

    response.status(statusCode).json(errorResponse);
  }

  private maybeAuditHttpFailure(
    host: ArgumentsHost,
    request: Request,
    statusCode: number,
    errorCode: string,
  ): void {
    try {
      const reqCtx = this.extractRequestCtx(request);
      if (statusCode === 403) {
        // Gate denials: only emit when the handler is itself audit-tagged.
        // Frontends often probe endpoints to drive UI rendering; logging every
        // denial floods the table without forensic value. The same actor
        // hitting the same denied path is also de-duped within a short window
        // so stale-token refresh storms don't multiply rows.
        if (!this.isAuditedHandler(host)) return;
        const path = request.originalUrl ?? request.url ?? '';
        if (!this.shouldEmitDenied(request, path)) return;
        this.auditService.emit({
          code: 'AUTH_ACCESS_DENIED',
          outcome: 'denied',
          metadata: { path, method: request.method, errorCode },
          ...reqCtx,
        });
        return;
      }
      if (
        statusCode === 401 &&
        (request.originalUrl ?? request.url).includes(AUTH_LOGIN_ROUTE_SEGMENT)
      ) {
        this.auditService.emit({
          code: 'AUTH_LOGIN_FAILURE',
          outcome: 'failure',
          metadata: { path: request.originalUrl ?? request.url },
          ...reqCtx,
        });
        return;
      }
      if (statusCode === 429) {
        const path = request.originalUrl ?? request.url;
        if (path.includes(AUTH_ROUTE_SEGMENT)) {
          this.auditService.emit({
            code: 'AUTH_RATE_LIMITED',
            outcome: 'denied',
            metadata: { path, method: request.method },
            ...reqCtx,
          });
        }
        return;
      }
      if (statusCode >= 500) {
        const path = request.originalUrl ?? request.url ?? '';
        if (PHI_ROUTE_SEGMENTS.some((seg) => path.includes(seg))) {
          this.auditService.emit({
            code: 'PHI_ACCESS_ERROR',
            outcome: 'failure',
            metadata: { path, statusCode, errorCode },
            ...reqCtx,
          });
        }
      }
    } catch {
      /* never block response */
    }
  }

  private extractRequestCtx(request: Request): {
    ipAddress: string | undefined;
    userAgent: string | undefined;
    requestId: string | undefined;
    sessionId: string | undefined;
  } {
    const sid = request.headers['x-session-id'] as string | undefined;
    return {
      ipAddress: request.ip ?? request.socket?.remoteAddress,
      userAgent: request.headers['user-agent'],
      requestId: request.headers['x-request-id'] as string | undefined,
      sessionId: sid && /^[0-9a-f-]{36}$/i.test(sid) ? sid : undefined,
    };
  }

  private isAuditedHandler(host: ArgumentsHost): boolean {
    const handler = this.tryGetHandler(host);
    if (!handler) return false;
    return Boolean(
      this.reflector.get(AUDIT_MUTATION_KEY, handler) ||
      this.reflector.get(AUDIT_ACCESS_KEY, handler),
    );
  }

  private tryGetHandler(
    host: ArgumentsHost,
  ): ((...args: unknown[]) => unknown) | undefined {
    try {
      const fn = (host as unknown as ExecutionContext).getHandler?.();
      return fn as unknown as ((...args: unknown[]) => unknown) | undefined;
    } catch {
      return undefined;
    }
  }

  private shouldEmitDenied(request: Request, path: string): boolean {
    const actor = getAuditActorContext().actorId ?? request.ip ?? 'anon';
    const key = `${actor}:${path}:403`;
    const now = Date.now();
    const last = this.deniedDebounce.get(key);
    if (last !== undefined && now - last < DENIED_DEBOUNCE_TTL_MS) return false;
    this.pruneDeniedDebounce(now);
    this.deniedDebounce.set(key, now);
    return true;
  }

  private pruneDeniedDebounce(now: number): void {
    if (this.deniedDebounce.size < DENIED_DEBOUNCE_MAX_SIZE) return;
    const cutoff = now - DENIED_DEBOUNCE_TTL_MS;
    for (const [k, ts] of this.deniedDebounce.entries()) {
      if (ts < cutoff) this.deniedDebounce.delete(k);
    }
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
    // Validation errors from I18nValidationPipe
    if (exception instanceof I18nValidationException) {
      const messages = this.formatValidationErrors(exception.errors, i18n);
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCode.COMMON_BAD_REQUEST,
        message: messages[0] || 'Validation failed',
        details: messages,
      };
    }

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

        const { message: _m, statusCode: _s, error: _e, ...extra } = resp;
        const hasStructuredExtras = Object.keys(extra).length > 0;
        return {
          statusCode: status,
          errorCode,
          message,
          details: Array.isArray(resp.message)
            ? resp.message
            : hasStructuredExtras
              ? extra
              : undefined,
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

    // Raw Postgres exclusion-constraint violation (e.g. appointments_no_overlap)
    // that reached the filter unmapped — surface as a 409, never a 500. Service
    // code maps these to richer conflicts; this is a safety net for any caller
    // that lets the raw error through.
    if (this.isExclusionViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        errorCode: ErrorCode.COMMON_CONFLICT,
        message: 'Resource conflicts with an existing record',
        details: this.isProduction ? undefined : (exception as any).meta,
      };
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

  private formatPermissionLogSuffix(
    statusCode: number,
    details: unknown,
  ): string {
    if (statusCode !== 403) return '';
    if (!details || typeof details !== 'object') return '';
    const d = details as { requiredPermissions?: unknown; mode?: unknown };
    if (
      !Array.isArray(d.requiredPermissions) ||
      d.requiredPermissions.length === 0
    ) {
      return '';
    }
    const mode = typeof d.mode === 'string' ? d.mode : 'all';
    return ` [required ${mode}: ${d.requiredPermissions.join(', ')}]`;
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

  // Postgres exclusion-constraint violation (SQLSTATE 23P01), possibly wrapped by
  // Prisma in a `cause`. Detect via code, wrapped cause, or constraint name.
  private isExclusionViolation(exception: unknown): boolean {
    if (exception === null || typeof exception !== 'object') return false;
    const e = exception as Record<string, unknown>;
    const PG_EXCLUSION_VIOLATION = '23P01';
    if (e['code'] === PG_EXCLUSION_VIOLATION) return true;
    const cause = e['cause'] as Record<string, unknown> | undefined;
    if (cause?.['code'] === PG_EXCLUSION_VIOLATION) return true;
    const meta = e['meta'] as Record<string, unknown> | undefined;
    const constraint = meta?.['constraint'];
    if (typeof constraint === 'string' && constraint.includes('_no_overlap')) {
      return true;
    }
    const msg = typeof e['message'] === 'string' ? e['message'] : '';
    return msg.includes('exclusion constraint') || msg.includes('_no_overlap');
  }

  private httpStatusToErrorCode(status: number): string {
    return HTTP_STATUS_ERROR_CODES[status] ?? ErrorCode.COMMON_UNKNOWN_ERROR;
  }

  private formatValidationErrors(
    errors: ValidationError[],
    i18n?: I18nContext,
  ): string[] {
    const messages: string[] = [];
    for (const error of errors) {
      if (error.constraints) {
        for (const [constraint, defaultMessage] of Object.entries(
          error.constraints,
        )) {
          const key = `validation.${constraint}`;
          const args = {
            property: error.property,
            value: error.value,
            ...this.extractConstraintArgs(constraint, defaultMessage),
          };
          const translated = i18n?.t(key, { args });
          messages.push(
            translated && translated !== key
              ? (translated as string)
              : defaultMessage,
          );
        }
      }
      if (error.children?.length) {
        messages.push(...this.formatValidationErrors(error.children, i18n));
      }
    }
    return messages;
  }

  private extractConstraintArgs(
    constraint: string,
    defaultMessage: string,
  ): Record<string, string> {
    switch (constraint) {
      case 'isIn': {
        const idx = defaultMessage.lastIndexOf(': ');
        return idx !== -1 ? { values: defaultMessage.substring(idx + 2) } : {};
      }
      case 'min':
      case 'max':
      case 'minLength':
      case 'maxLength': {
        const match = defaultMessage.match(/\d+/);
        return match ? { [constraint]: match[0] } : {};
      }
      default:
        return {};
    }
  }
}
