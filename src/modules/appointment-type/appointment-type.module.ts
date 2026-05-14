import { Module } from '@nestjs/common';
import { AppointmentTypeController } from './appointment-type.controller';
import { AppointmentTypeService } from './appointment-type.service';

@Module({
  controllers: [AppointmentTypeController],
  providers: [AppointmentTypeService],
  exports: [AppointmentTypeService],
})
export class AppointmentTypeModule {}
