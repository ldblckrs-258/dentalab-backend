import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '@common/decorators';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit_logs:read')
  async findAll(@Query() query: AuditQueryDto) {
    return this.auditService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('audit_logs:read')
  async findById(@Param('id') id: string) {
    return this.auditService.findById(id);
  }
}
