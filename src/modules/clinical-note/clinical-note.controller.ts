import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuditAccess,
  AuditMutation,
  RequirePermissions,
} from '@common/decorators';
import { ClinicalNoteService } from './clinical-note.service';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import { UpdateClinicalNoteDto } from './dto/update-clinical-note.dto';
import { SignClinicalNoteDto } from './dto/sign-clinical-note.dto';
import { CreateAddendumDto } from './dto/create-addendum.dto';
import { ClinicalNoteQueryDto } from './dto/clinical-note-query.dto';

@Controller('clinical-notes')
export class ClinicalNoteController {
  constructor(private readonly service: ClinicalNoteService) {}

  @Get()
  @RequirePermissions('clinical_notes:read')
  findAll(@Query() query: ClinicalNoteQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('clinical_notes:read')
  @AuditAccess('CLINICAL_NOTE_VIEWED', {
    paramKey: 'id',
    resource: 'clinical_note',
    debounceSeconds: 60,
  })
  findById(
    @Param('id') id: string,
    @Query('includeAddendums') includeAddendums?: string,
  ) {
    return this.service.findById(id, includeAddendums === 'true');
  }

  @Post()
  @RequirePermissions('clinical_notes:create')
  @AuditMutation({ code: 'CLINICAL_NOTE_CREATED', resource: 'clinical_note' })
  create(@Body() dto: CreateClinicalNoteDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('clinical_notes:update')
  @AuditMutation({ code: 'CLINICAL_NOTE_UPDATED', resource: 'clinical_note' })
  update(@Param('id') id: string, @Body() dto: UpdateClinicalNoteDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/sign')
  @RequirePermissions('clinical_notes:sign')
  @AuditMutation({ code: 'CLINICAL_NOTE_SIGNED', resource: 'clinical_note' })
  sign(@Param('id') id: string, @Body() _dto: SignClinicalNoteDto) {
    return this.service.sign(id);
  }

  @Post(':id/addendums')
  @RequirePermissions('clinical_notes:addendum')
  @AuditMutation({
    code: 'CLINICAL_NOTE_ADDENDUM_CREATED',
    resource: 'clinical_note',
  })
  createAddendum(@Param('id') id: string, @Body() dto: CreateAddendumDto) {
    return this.service.createAddendum(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clinical_notes:delete')
  softDelete(@Param('id') id: string) {
    return this.service.softDelete(id);
  }
}

@Controller('patients/:patientId/clinical-notes')
export class PatientClinicalNoteController {
  constructor(private readonly service: ClinicalNoteService) {}

  @Get()
  @RequirePermissions('clinical_notes:read')
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: ClinicalNoteQueryDto,
  ) {
    return this.service.findByPatient(patientId, query);
  }
}

@Controller('appointments/:appointmentId/clinical-notes')
export class AppointmentClinicalNoteController {
  constructor(private readonly service: ClinicalNoteService) {}

  @Get()
  @RequirePermissions('clinical_notes:read')
  findByAppointment(
    @Param('appointmentId') appointmentId: string,
    @Query() query: ClinicalNoteQueryDto,
  ) {
    return this.service.findByAppointment(appointmentId, query);
  }
}
