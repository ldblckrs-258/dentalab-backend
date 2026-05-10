import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth';
import { RbacModule } from '@modules/rbac';
import { RedisModule } from '@modules/redis';
import { AppConfigModule } from '@modules/config';
import { WsAuthService } from './services/ws-auth.service';
import { WsMetricsService } from './services/ws-metrics.service';
import { WsRateLimitService } from './services/ws-rate-limit.service';
import { WsEventRateLimitGuard } from './guards/ws-event-rate-limit.guard';
import { RedisIoAdapter } from './adapters/redis-io.adapter';

@Global()
@Module({
  imports: [AuthModule, RbacModule, RedisModule, AppConfigModule],
  providers: [
    WsAuthService,
    WsMetricsService,
    WsRateLimitService,
    WsEventRateLimitGuard,
    RedisIoAdapter,
  ],
  exports: [
    WsAuthService,
    WsMetricsService,
    WsRateLimitService,
    WsEventRateLimitGuard,
    RedisIoAdapter,
  ],
})
export class RealtimeModule {}
