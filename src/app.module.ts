import * as path from 'path';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { I18nModule, AcceptLanguageResolver } from 'nestjs-i18n';
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
import { UserModule } from '@modules/user';
import { ProviderModule } from '@modules/provider';
import { EmailModule } from '@modules/email';
import { KioskModule } from '@modules/kiosk';
import { DEFAULT_LANGUAGE } from '@common/constants';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    I18nModule.forRoot({
      fallbackLanguage: DEFAULT_LANGUAGE,
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: isDev,
      },
      resolvers: [AcceptLanguageResolver],
      ...(isDev && {
        typesOutputPath: path.join(
          process.cwd(),
          'src/generated/i18n.generated.ts',
        ),
      }),
    }),
    CommonModule,
    EmailModule,
    AuthModule,
    RbacModule,
    AuditModule,
    UserModule,
    ProviderModule,
    KioskModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
