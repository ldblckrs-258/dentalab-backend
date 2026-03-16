import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { Audited } from '@common/decorators/audited.decorator';
import { EmailService } from './email.service';
import { EmailQueryDto } from './dto/email-query.dto';

@Controller('emails')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get()
  @RequirePermissions('email_logs:read')
  async findAll(@Query() query: EmailQueryDto) {
    return this.emailService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('email_logs:read')
  async getStats() {
    return this.emailService.getStats();
  }

  @Get(':id')
  @RequirePermissions('email_logs:read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.emailService.findOne(id);
  }

  @Post(':id/resend')
  @RequirePermissions('email_logs:manage')
  @Audited('email')
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.emailService.resendEmail(id);
  }
}
