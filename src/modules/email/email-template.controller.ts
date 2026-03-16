import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { Audited } from '@common/decorators/audited.decorator';
import { PaginationQueryDto } from '@modules/pagination';
import { EmailTemplateService } from './email-template.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';

@Controller('email-templates')
export class EmailTemplateController {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  @Get()
  @RequirePermissions('email_templates:read')
  async findAll(@Query() query: PaginationQueryDto) {
    return this.emailTemplateService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('email_templates:read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.emailTemplateService.findOne(id);
  }

  @Post()
  @RequirePermissions('email_templates:create')
  @Audited('email_template')
  async create(@Body() dto: CreateEmailTemplateDto) {
    return this.emailTemplateService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('email_templates:update')
  @Audited('email_template')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplateService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('email_templates:delete')
  @Audited('email_template')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.emailTemplateService.remove(id);
  }
}
