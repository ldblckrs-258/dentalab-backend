import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions, CurrentUser } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit_logs:read')
  async findAll(
    @Query() query: AuditQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditService.findAll(query, user.id);
  }

  @Get(':id')
  @RequirePermissions('audit_logs:read')
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditService.findById(id, user.id);
  }
}
