import { Module } from '@nestjs/common';
import { RbacModule } from '@modules/rbac';
import { SchedulingModule } from '@modules/scheduling/scheduling.module';
import { QueueModule } from '@modules/queue';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { AppointmentHistoryService } from './appointment-history.service';
import { AppointmentEmailProducer } from './appointment-email.producer';
import { AppointmentReminderService } from './appointment-reminder.service';

@Module({
  imports: [RbacModule, SchedulingModule, QueueModule],
  controllers: [AppointmentController],
  providers: [
    AppointmentService,
    AppointmentHistoryService,
    AppointmentEmailProducer,
    AppointmentReminderService,
  ],
  exports: [AppointmentService, AppointmentEmailProducer],
})
export class AppointmentModule {}
