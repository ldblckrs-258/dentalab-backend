import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuditAccess,
  AuditMutation,
  CurrentUser,
  RequirePermissions,
} from '@common/decorators';
import { PatientFileService } from './patient-file.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { FileQueryDto } from './dto/file-query.dto';

@Controller('patients/:patientId/files')
export class PatientFileController {
  constructor(private readonly patientFileService: PatientFileService) {}

  @Post()
  @RequirePermissions('patient_files:create')
  @AuditMutation({ code: 'PATIENT_FILE_CREATED', resource: 'patient_file' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Param('patientId') patientId: string,
    @Body() dto: UploadFileDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.patientFileService.upload(patientId, file, dto, userId);
  }

  @Get()
  @RequirePermissions('patient_files:read')
  async findAll(
    @Param('patientId') patientId: string,
    @Query() query: FileQueryDto,
  ) {
    return this.patientFileService.findAll(patientId, query);
  }

  @Get(':fileId/download')
  @RequirePermissions('patient_files:read')
  @AuditAccess('PATIENT_FILE_DOWNLOADED', { paramKey: 'fileId' })
  async download(
    @Param('patientId') patientId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.patientFileService.getDownloadUrl(patientId, fileId);
  }

  @Patch(':fileId')
  @RequirePermissions('patient_files:update')
  @AuditMutation({ code: 'PATIENT_FILE_UPDATED', resource: 'patient_file' })
  async update(
    @Param('patientId') patientId: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateFileDto,
  ) {
    return this.patientFileService.update(patientId, fileId, dto);
  }

  @Delete(':fileId')
  @RequirePermissions('patient_files:delete')
  @AuditMutation({ code: 'PATIENT_FILE_DELETED', resource: 'patient_file' })
  async delete(
    @Param('patientId') patientId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.patientFileService.delete(patientId, fileId);
  }
}
