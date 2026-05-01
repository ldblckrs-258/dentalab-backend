import { Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientFileController } from './patient-file.controller';
import { PatientService } from './patient.service';
import { PatientFileService } from './patient-file.service';
import { StorageModule } from '@modules/storage';

@Module({
  controllers: [PatientController, PatientFileController],
  providers: [PatientService, PatientFileService],
  imports: [StorageModule],
  exports: [PatientService],
})
export class PatientModule {}
