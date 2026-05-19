import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditMutation, RequirePermissions } from '@common/decorators';
import { AiModelService } from '../services/ai-model.service';
import { CreateModelDto } from '../dto/create-model.dto';
import { UpdateModelDto } from '../dto/update-model.dto';
import { ListModelsQueryDto } from '../dto/list-models-query.dto';

@Controller('ai-config/models')
export class AiModelController {
  constructor(private readonly models: AiModelService) {}

  @Get()
  @RequirePermissions('ai_config:read')
  async list(@Query() query: ListModelsQueryDto) {
    return this.models.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('ai_config:read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.models.findOne(id);
  }

  @Post()
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_MODEL_CREATED', resource: 'ai_config' })
  async create(@Body() dto: CreateModelDto) {
    return this.models.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_MODEL_UPDATED', resource: 'ai_config' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModelDto,
  ) {
    return this.models.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_MODEL_DELETED', resource: 'ai_config' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.models.remove(id);
  }
}
