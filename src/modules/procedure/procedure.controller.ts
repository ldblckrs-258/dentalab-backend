import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditMutation, RequirePermissions } from '@common/decorators';
import { ProcedureService } from './procedure.service';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { ProcedureQueryDto } from './dto/procedure-query.dto';
import { UpdateProcedureDto } from './dto/update-procedure.dto';
import { ExecuteImportDto } from './dto/import-procedure.dto';

@Controller('procedures')
export class ProcedureController {
  constructor(private readonly procedureService: ProcedureService) {}

  @Get()
  @RequirePermissions('procedures:read')
  async findAll(@Query() query: ProcedureQueryDto) {
    return this.procedureService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('procedures:read')
  async findById(@Param('id') id: string) {
    return this.procedureService.findById(id);
  }

  @Post()
  @RequirePermissions('procedures:create')
  @AuditMutation({ code: 'PROCEDURE_CREATED', resource: 'procedure' })
  async create(@Body() dto: CreateProcedureDto) {
    return this.procedureService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('procedures:update')
  @AuditMutation({ code: 'PROCEDURE_UPDATED', resource: 'procedure' })
  async update(@Param('id') id: string, @Body() dto: UpdateProcedureDto) {
    return this.procedureService.update(id, dto);
  }

  @Post('import/preview')
  @RequirePermissions('procedures:create')
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    return this.procedureService.previewCsvImport(file);
  }

  @Post('import/execute')
  @RequirePermissions('procedures:create')
  @AuditMutation({ code: 'PROCEDURE_BULK_IMPORTED', resource: 'procedure' })
  async executeImport(@Body() dto: ExecuteImportDto) {
    return this.procedureService.executeImport(dto);
  }
}
