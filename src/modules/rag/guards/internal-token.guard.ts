import { AppConfigService } from '@modules/config';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-internal-token'];
    const expected = this.config.ai.RAG_SERVICE_TOKEN;

    if (typeof provided !== 'string' || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('invalid_internal_token');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const len = Math.max(Buffer.byteLength(a), Buffer.byteLength(b));
    const bufA = Buffer.alloc(len);
    const bufB = Buffer.alloc(len);
    bufA.write(a);
    bufB.write(b);
    return timingSafeEqual(bufA, bufB) && a.length === b.length;
  }
}
