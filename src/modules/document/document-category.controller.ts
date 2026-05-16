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
  AuditMutation,
  CurrentUser,
  RequirePermissions,
} from '@common/decorators';
import { DocumentCategoryService } from './document-category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryQueryDto } from './dto/category-query.dto';

@Controller('document-categories')
export class DocumentCategoryController {
  constructor(
    private readonly documentCategoryService: DocumentCategoryService,
  ) {}

  @Get()
  @RequirePermissions('internal_documents:read')
  async findAll(@Query() query: CategoryQueryDto) {
    return this.documentCategoryService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('internal_documents:read')
  async findById(@Param('id') id: string) {
    return this.documentCategoryService.findById(id);
  }

  @Post()
  @RequirePermissions('internal_documents:create')
  @AuditMutation({
    code: 'DOCUMENT_CATEGORY_CREATED',
    resource: 'document_category',
  })
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentCategoryService.create(dto, userId);
  }

  @Patch(':id')
  @RequirePermissions('internal_documents:update')
  @AuditMutation({
    code: 'DOCUMENT_CATEGORY_UPDATED',
    resource: 'document_category',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.documentCategoryService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('internal_documents:delete')
  @AuditMutation({
    code: 'DOCUMENT_CATEGORY_DELETED',
    resource: 'document_category',
  })
  async delete(@Param('id') id: string) {
    return this.documentCategoryService.delete(id);
  }
}
