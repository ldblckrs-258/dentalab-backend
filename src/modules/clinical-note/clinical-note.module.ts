import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { RagModule } from '@modules/rag/rag.module';
import {
  ClinicalNoteController,
  PatientClinicalNoteController,
  AppointmentClinicalNoteController,
} from './clinical-note.controller';
import { ClinicalNoteService } from './clinical-note.service';

@Module({
  imports: [AuditModule, RagModule],
  controllers: [
    ClinicalNoteController,
    PatientClinicalNoteController,
    AppointmentClinicalNoteController,
  ],
  providers: [ClinicalNoteService],
  exports: [ClinicalNoteService],
})
export class ClinicalNoteModule {}
