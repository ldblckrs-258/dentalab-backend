import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { SKIP_RESPONSE_WRAP_KEY } from '@common/constants';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
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
            message: 'Success',
            data: items,
            meta,
            timestamp: new Date().toISOString(),
          };
        }

        return {
          statusCode: response.statusCode as number,
          message: 'Success',
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
