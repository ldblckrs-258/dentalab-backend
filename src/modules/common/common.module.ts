import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigService } from '@modules/config';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { RequestContextInterceptor } from './interceptors/request-context.interceptor';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Global()
@Module({
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (config: AppConfigService) =>
        new GlobalExceptionFilter(config.isProduction),
      inject: [AppConfigService],
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
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class CommonModule {}
