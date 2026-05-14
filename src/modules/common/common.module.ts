import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { AppConfigService } from '@modules/config';
import { AuditModule } from '@modules/audit';
import { AuditService } from '@modules/audit/audit.service';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { RequestContextInterceptor } from './interceptors/request-context.interceptor';
import { CacheEndpointInterceptor } from './interceptors/cache-endpoint.interceptor';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Global()
@Module({
  imports: [forwardRef(() => AuditModule)],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (
        config: AppConfigService,
        audit: AuditService,
        reflector: Reflector,
      ) => new GlobalExceptionFilter(config.isProduction, audit, reflector),
      inject: [AppConfigService, AuditService, Reflector],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheEndpointInterceptor,
    },
    // RateLimitGuard is wired explicitly via main.ts useGlobalGuards()
    // (alongside JwtAuthGuard and PermissionGuard) to lock execution order.
    RateLimitGuard,
  ],
  exports: [RateLimitGuard],
})
export class CommonModule {}
