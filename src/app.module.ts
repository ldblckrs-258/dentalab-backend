import { Module } from '@nestjs/common';
import { AppConfigModule } from '@modules/config';
import { DatabaseModule } from '@modules/database';
import { RedisModule } from '@modules/redis';
import { QueueModule } from '@modules/queue';
import { StorageModule } from '@modules/storage';
import { CommonModule } from '@modules/common';
import { AuthModule } from '@modules/auth';
import { RbacModule } from '@modules/rbac';
import { AuditModule } from '@modules/audit';
import { HealthModule } from '@modules/health';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    CommonModule,
    AuthModule,
    RbacModule,
    AuditModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
