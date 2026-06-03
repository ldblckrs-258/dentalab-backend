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
import { PatientModule } from '@modules/patient';
import { EmailModule } from '@modules/email';
import { RealtimeModule } from '@modules/realtime';
import { ProcedureModule } from '@modules/procedure/procedure.module';
import { AppointmentTypeModule } from '@modules/appointment-type/appointment-type.module';
import { TreatmentPlanModule } from '@modules/treatment-plan/treatment-plan.module';
import { SchedulingModule } from '@modules/scheduling/scheduling.module';
import { PatientProcedureModule } from '@modules/patient-procedure';
import { AppointmentModule } from '@modules/appointment';
import { DocumentModule } from '@modules/document';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { ClinicalNoteModule } from '@modules/clinical-note';
import { RagModule } from '@modules/rag/rag.module';
import { AiConfigModule } from '@modules/ai-config/ai-config.module';
import { ChatModule } from '@modules/chat/chat.module';
import { BookingModule } from '@modules/booking/booking.module';
import { DEFAULT_LANGUAGE } from '@common/constants';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    RealtimeModule,
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
    PatientModule,
    ProcedureModule,
    AppointmentTypeModule,
    TreatmentPlanModule,
    SchedulingModule,
    PatientProcedureModule,
    AppointmentModule,
    DocumentModule,
    InventoryModule,
    ClinicalNoteModule,
    RagModule,
    AiConfigModule,
    ChatModule,
    BookingModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
