import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { RequestContext } from '@common/interfaces';
import { RequestContextService } from '../context/request-context';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    const ctx: RequestContext = {
      userId: request.user?.id,
      requestId: (request.headers['x-request-id'] as string) ?? uuidv4(),
      ip: request.ip ?? request.connection?.remoteAddress ?? 'unknown',
      timestamp: new Date(),
    };

    // Set request ID header on response
    const response = context.switchToHttp().getResponse();
    response.setHeader('x-request-id', ctx.requestId);

    return new Observable((subscriber) => {
      RequestContextService.run(ctx, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
