import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { DEFAULT_LANGUAGE, SKIP_RESPONSE_WRAP_KEY } from '@common/constants';
import { I18nContext } from 'nestjs-i18n';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  lang: string;
  data: T | null;
  meta?: unknown;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skipWrap = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_WRAP_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipWrap) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        const i18n = I18nContext.current();
        const lang = i18n?.lang ?? DEFAULT_LANGUAGE;
        const successMessage = i18n?.t('common.success') ?? 'Success';
        const isMessageOnly =
          data &&
          typeof data === 'object' &&
          'message' in data &&
          Object.keys(data as object).length === 1;

        // Flatten paginated responses: { data: [...], meta: {...} } → spread into envelope
        const isPaginated =
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data &&
          Array.isArray(data.data);

        if (isMessageOnly) {
          return {
            statusCode: response.statusCode as number,
            message: (data as { message: string }).message,
            lang,
            data: null,
            timestamp: new Date().toISOString(),
          };
        }

        if (isPaginated) {
          const { data: items, meta } = data as {
            data: unknown[];
            meta: unknown;
          };
          return {
            statusCode: response.statusCode as number,
            message: successMessage,
            lang,
            data: items,
            meta,
            timestamp: new Date().toISOString(),
          };
        }

        return {
          statusCode: response.statusCode as number,
          message: successMessage,
          lang,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
