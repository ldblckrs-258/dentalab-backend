import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions, Audited } from '@common/decorators';
import { ProviderService } from './provider.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpdateProviderStatusDto } from './dto/update-provider-status.dto';
import { ProviderQueryDto } from './dto/provider-query.dto';

@Controller('providers')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  @Get()
  @RequirePermissions('providers:read')
  async findAll(@Query() query: ProviderQueryDto) {
    return this.providerService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('providers:read')
  async findById(@Param('id') id: string) {
    return this.providerService.findById(id);
  }

  @Post()
  @RequirePermissions('providers:create')
  @Audited('provider')
  async create(@Body() dto: CreateProviderDto) {
    return this.providerService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('providers:update')
  @Audited('provider')
  async update(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providerService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('providers:update')
  @Audited('provider')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProviderStatusDto,
  ) {
    return this.providerService.updateStatus(id, dto);
  }
}
