import { Module } from '@nestjs/common';
import { RbacModule } from '@modules/rbac';
import { SchedulingModule } from '@modules/scheduling/scheduling.module';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';

@Module({
  imports: [RbacModule, SchedulingModule],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
