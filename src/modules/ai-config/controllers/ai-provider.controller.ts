import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  AuditMutation,
  CurrentUser,
  RequirePermissions,
} from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { AiProviderService } from '../services/ai-provider.service';
import { AiModelService } from '../services/ai-model.service';
import { ProviderModelDiscoveryService } from '../services/provider-model-discovery.service';
import { CreateProviderDto } from '../dto/create-provider.dto';
import { UpdateProviderDto } from '../dto/update-provider.dto';
import { ImportModelsDto } from '../dto/import-models.dto';

@Controller('ai-config/providers')
export class AiProviderController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly models: AiModelService,
    private readonly discovery: ProviderModelDiscoveryService,
  ) {}

  @Get()
  @RequirePermissions('ai_config:read')
  async list() {
    return this.providers.findAll();
  }

  @Get(':id')
  @RequirePermissions('ai_config:read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.findOne(id);
  }

  @Post()
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_PROVIDER_CREATED', resource: 'ai_config' })
  async create(
    @Body() dto: CreateProviderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.providers.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_PROVIDER_UPDATED', resource: 'ai_config' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providers.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_PROVIDER_DELETED', resource: 'ai_config' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.remove(id);
  }

  @Get(':id/available-models')
  @RequirePermissions('ai_config:manage')
  async availableModels(@Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.listAvailableModels(id);
  }

  @Post(':id/import-models')
  @RequirePermissions('ai_config:manage')
  @AuditMutation({ code: 'AI_MODEL_CREATED', resource: 'ai_config' })
  async importModels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportModelsDto,
  ) {
    const existing = await this.models.findAll({});
    const taken = new Set(
      existing
        .filter((m) => m.providerId === id)
        .map((m) => m.modelName.toLowerCase()),
    );
    const fresh = dto.modelIds.filter((m) => !taken.has(m.toLowerCase()));
    const created: Array<{ id: string; modelName: string }> = [];
    for (const modelId of fresh) {
      const row = await this.models.create({
        providerId: id,
        role: 'answer',
        modelName: modelId,
        displayName: modelId,
        userInstruction: dto.userInstruction ?? null,
        temperature: dto.temperature ?? 0.4,
        isActive: true,
        isDefault: false,
      });
      created.push({ id: row.id, modelName: row.modelName });
    }
    return {
      created: created.length,
      skipped: dto.modelIds.length - created.length,
      models: created,
    };
  }
}
