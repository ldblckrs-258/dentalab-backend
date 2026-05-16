import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { INTERNAL_DOC_MAX_SIZE } from '@modules/storage/storage.constants';
import type { AuthenticatedUser } from '@common/interfaces';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentQueryDto } from './dto/document-query.dto';
import { SetActiveVersionDto } from './dto/set-active-version.dto';
import { SetDocumentAccessDto } from './dto/set-document-access.dto';

@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  @RequirePermissions('internal_documents:read')
  @AuditAccess('INTERNAL_DOCUMENT_VIEWED', { debounceSeconds: 60 })
  async findAll(
    @Query() query: DocumentQueryDto,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('internal_documents:read')
  @AuditAccess('INTERNAL_DOCUMENT_VIEWED', { paramKey: 'id' })
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.findById(id, user);
  }

  @Post()
  @RequirePermissions('internal_documents:create')
  @AuditMutation({
    code: 'INTERNAL_DOCUMENT_CREATED',
    resource: 'internal_document',
  })
  async create(
    @Body() dto: CreateDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.documentService.create(dto, userId);
  }

  @Patch(':id')
  @RequirePermissions('internal_documents:update')
  @AuditMutation({
    code: 'INTERNAL_DOCUMENT_UPDATED',
    resource: 'internal_document',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('internal_documents:delete')
  @AuditMutation({
    code: 'INTERNAL_DOCUMENT_DELETED',
    resource: 'internal_document',
  })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.delete(id, user);
  }

  @Get(':id/versions')
  @RequirePermissions('internal_documents:read')
  async listVersions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.listVersions(id, user);
  }

  @Post(':id/versions')
  @RequirePermissions('internal_documents:create')
  @AuditMutation({
    code: 'DOCUMENT_VERSION_UPLOADED',
    resource: 'internal_document',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: INTERNAL_DOC_MAX_SIZE } }),
  )
  async uploadVersion(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.uploadVersion(id, file, userId, user);
  }

  @Patch(':id/active-version')
  @RequirePermissions('internal_documents:update')
  @AuditMutation({
    code: 'DOCUMENT_VERSION_ACTIVATED',
    resource: 'internal_document',
  })
  async setActiveVersion(
    @Param('id') id: string,
    @Body() dto: SetActiveVersionDto,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.setActiveVersion(id, dto.versionId, user);
  }

  @Get(':id/versions/:vid/download')
  @RequirePermissions('internal_documents:read')
  @AuditAccess('DOCUMENT_DOWNLOAD_ISSUED', { paramKey: 'id' })
  async getDownloadUrl(
    @Param('id') id: string,
    @Param('vid') vid: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.getDownloadUrl(id, vid, user);
  }

  @Get(':id/access')
  @RequirePermissions('internal_documents:read')
  async getAccess(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.getAccess(id, user);
  }

  @Put(':id/access')
  @RequirePermissions('internal_documents:update')
  @AuditMutation({
    code: 'DOCUMENT_ACCESS_UPDATED',
    resource: 'internal_document',
  })
  async setAccess(
    @Param('id') id: string,
    @Body() dto: SetDocumentAccessDto,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.documentService.setAccess(id, dto, user);
  }
}
