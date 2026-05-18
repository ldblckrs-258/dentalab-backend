import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { StorageService } from '@modules/storage';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import {
  INTERNAL_DOC_ALLOWED_MIME_TYPES,
  INTERNAL_DOC_MAX_SIZE,
  INTERNAL_DOC_PRESIGNED_EXPIRY,
  INLINE_DISPLAY_MIME_TYPES,
} from '@modules/storage/storage.constants';
import {
  validateMimeType,
  validateFileSize,
  validateMagicBytes,
} from '@modules/storage/storage.utils';
import { t } from '@common/utils';
import type { AuthenticatedUser } from '@common/interfaces';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { UpdateDocumentDto } from './dto/update-document.dto';
import type { DocumentQueryDto } from './dto/document-query.dto';
import type { SetDocumentAccessDto } from './dto/set-document-access.dto';

const DOC_SOURCE_TYPE = 'internal_document';

const DOCUMENT_SELECT = {
  id: true,
  title: true,
  isPublished: true,
  categoryId: true,
  activeVersionId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  activeVersion: {
    select: {
      id: true,
      versionNumber: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      createdAt: true,
    },
  },
} as const;

const VERSION_SELECT = {
  id: true,
  documentId: true,
  versionNumber: true,
  fileName: true,
  fileSize: true,
  mimeType: true,
  createdAt: true,
  changer: { select: { id: true, fullName: true } },
} as const;

type VersionWithChanger = Prisma.DocumentVersionGetPayload<{
  select: typeof VERSION_SELECT;
}>;

function mapVersion(v: VersionWithChanger) {
  const { changer, ...rest } = v;
  return {
    ...rest,
    changedBy: changer ? { id: changer.id, name: changer.fullName } : null,
  };
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly queue: QueueProducerService,
  ) {}

  private publishDocumentEvent(
    action: 'created' | 'updated' | 'deleted',
    sourceId: string,
  ): void {
    const routingKey =
      action === 'created'
        ? ROUTING_KEY.DOCUMENT_CREATED
        : action === 'updated'
          ? ROUTING_KEY.DOCUMENT_UPDATED
          : ROUTING_KEY.DOCUMENT_DELETED;
    try {
      this.queue.publish(routingKey, {
        sourceType: DOC_SOURCE_TYPE,
        sourceId,
        action,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish ${routingKey} for ${sourceId}: ${(err as Error).message}`,
      );
    }
  }

  private isManager(user: AuthenticatedUser): boolean {
    const roleCodes = user.roleCodes ?? [];
    return roleCodes.includes('ADMIN') || roleCodes.includes('MANAGER');
  }

  async getUserPermissionIds(userId: string): Promise<string[]> {
    return this.resolveUserPermissionIds(userId);
  }

  private async resolveUserPermissionIds(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.baseClient.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            rolePermissions: { select: { permissionId: true } },
          },
        },
      },
    });

    const ids = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        ids.add(rp.permissionId);
      }
    }

    const overrides =
      await this.prisma.baseClient.userPermissionOverride.findMany({
        where: {
          userId,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: { permission: { select: { id: true } } },
      });

    for (const ov of overrides) {
      if (ov.grantType === 'grant') ids.add(ov.permission.id);
      else if (ov.grantType === 'deny') ids.delete(ov.permission.id);
    }

    return Array.from(ids);
  }

  private async buildAclFilter(
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<Prisma.InternalDocumentWhereInput | null> {
    if (this.isManager(user)) return null;

    const permissionIds = await this.resolveUserPermissionIds(user.id);

    const restrictedDocIds = await this.prisma.baseClient.documentAccess
      .findMany({
        where: { sourceType: DOC_SOURCE_TYPE },
        select: { sourceId: true },
        distinct: ['sourceId'],
      })
      .then((rows) => rows.map((r) => r.sourceId));

    if (restrictedDocIds.length === 0) return {};

    const allowedDocIds =
      permissionIds.length > 0
        ? await this.prisma.baseClient.documentAccess
            .findMany({
              where: {
                sourceType: DOC_SOURCE_TYPE,
                sourceId: { in: restrictedDocIds },
                permissionId: { in: permissionIds },
              },
              select: { sourceId: true },
              distinct: ['sourceId'],
            })
            .then((rows) => rows.map((r) => r.sourceId))
        : [];

    return {
      OR: [{ id: { notIn: restrictedDocIds } }, { id: { in: allowedDocIds } }],
    };
  }

  private async enforceDocumentAccess(
    documentId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<void> {
    const permissionIds = await this.resolveUserPermissionIds(user.id);

    const accessRows = await this.prisma.baseClient.documentAccess.findMany({
      where: { sourceType: DOC_SOURCE_TYPE, sourceId: documentId },
      select: { permissionId: true },
    });

    if (accessRows.length === 0) return;

    const allowed = accessRows.some((r) =>
      permissionIds.includes(r.permissionId),
    );
    if (!allowed) {
      throw new NotFoundException(
        t('document.not_found', 'Document not found'),
      );
    }
  }

  async findAll(
    query: DocumentQueryDto,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'title', 'updatedAt'],
      {
        createdAt: 'desc',
      },
    );

    const where: Prisma.InternalDocumentWhereInput = {
      deletedAt:
        query.includeDeleted && this.isManager(user) ? undefined : null,
    };

    if (!this.isManager(user)) {
      where.isPublished = true;
    } else if (query.isPublished !== undefined) {
      where.isPublished = query.isPublished;
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    const aclFilter = await this.buildAclFilter(user);
    if (aclFilter && Object.keys(aclFilter).length > 0) {
      Object.assign(where, aclFilter);
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.internalDocument.findMany({
        ...prismaArgs,
        where,
        select: DOCUMENT_SELECT,
      }),
      this.prisma.baseClient.internalDocument.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(
    id: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    const where: Prisma.InternalDocumentWhereInput = {
      id,
      deletedAt: null,
    };

    if (!this.isManager(user)) {
      where.isPublished = true;
    }

    const doc = await this.prisma.baseClient.internalDocument.findFirst({
      where,
      select: DOCUMENT_SELECT,
    });

    if (!doc) {
      throw new NotFoundException(
        t('document.not_found', 'Document not found'),
      );
    }

    await this.enforceDocumentAccess(id, user);

    return doc;
  }

  async create(dto: CreateDocumentDto, userId: string) {
    if (dto.categoryId) {
      const cat = await this.prisma.baseClient.documentCategory.findFirst({
        where: { id: dto.categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException(
          t('document.category_not_found', 'Category not found'),
        );
      }
    }

    return this.prisma.baseClient.internalDocument.create({
      data: {
        title: dto.title.trim(),
        categoryId: dto.categoryId ?? null,
        isPublished: dto.isPublished ?? false,
        createdBy: userId,
      },
      select: DOCUMENT_SELECT,
    });
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(id, user);

    const data: Prisma.InternalDocumentUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;
    if (dto.categoryId !== undefined) {
      if (dto.categoryId) {
        const cat = await this.prisma.baseClient.documentCategory.findFirst({
          where: { id: dto.categoryId, deletedAt: null },
          select: { id: true },
        });
        if (!cat) {
          throw new BadRequestException(
            t('document.category_not_found', 'Category not found'),
          );
        }
      }
      data.categoryId = dto.categoryId ?? null;
    }

    return this.prisma.baseClient.internalDocument.update({
      where: { id },
      data,
      select: DOCUMENT_SELECT,
    });
  }

  async delete(
    id: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(id, user);

    await this.prisma.baseClient.internalDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.publishDocumentEvent('deleted', id);

    return { id };
  }

  async listVersions(
    documentId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(documentId, user);

    const versions = await this.prisma.baseClient.documentVersion.findMany({
      where: { documentId },
      select: VERSION_SELECT,
      orderBy: { versionNumber: 'desc' },
    });

    return versions.map(mapVersion);
  }

  async uploadVersion(
    documentId: string,
    file: Express.Multer.File,
    userId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(documentId, user);

    if (!file) {
      throw new BadRequestException(
        t('document.file_required', 'File is required'),
      );
    }

    const originalName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );

    validateFileSize(file.size, INTERNAL_DOC_MAX_SIZE);
    validateMimeType(file.mimetype, INTERNAL_DOC_ALLOWED_MIME_TYPES);
    await validateMagicBytes(
      file.buffer,
      file.mimetype,
      INTERNAL_DOC_ALLOWED_MIME_TYPES,
    );

    let uploadedKey: string | null = null;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.baseClient.$transaction(async (tx) => {
          const agg = await tx.documentVersion.aggregate({
            where: { documentId },
            _max: { versionNumber: true },
          });

          const nextVersion = (agg._max.versionNumber ?? 0) + 1 + attempt;

          const version = await tx.documentVersion.create({
            data: {
              documentId,
              changedBy: userId,
              versionNumber: nextVersion,
              fileKey: '__placeholder__',
              fileName: originalName,
              mimeType: file.mimetype,
              fileSize: file.size,
            },
            select: VERSION_SELECT,
          });

          const stored = await this.storageService.upload(file.buffer, {
            category: 'internal-documents',
            entityId: documentId,
            originalFilename: originalName,
            contentType: file.mimetype,
            uploadedBy: userId,
          });

          uploadedKey = stored.key;

          await tx.documentVersion.update({
            where: { id: version.id },
            data: { fileKey: stored.key },
          });

          await tx.internalDocument.update({
            where: { id: documentId },
            data: { activeVersionId: version.id },
          });

          return { ...version, fileKey: stored.key };
        });

        const { fileKey: _fileKey, ...versionFields } = result;
        this.publishDocumentEvent('updated', documentId);
        return mapVersion(versionFields);
      } catch (err) {
        const isPrismaUniqueViolation =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002';

        if (uploadedKey) {
          await this.storageService.delete(uploadedKey).catch(() => undefined);
          uploadedKey = null;
        }

        if (isPrismaUniqueViolation && attempt < MAX_RETRIES - 1) {
          continue;
        }

        if (isPrismaUniqueViolation) {
          throw new BadRequestException(
            t(
              'document.version_conflict',
              'Version number conflict, please retry',
            ),
          );
        }

        throw err;
      }
    }

    throw new BadRequestException(
      t('document.version_conflict', 'Version number conflict, please retry'),
    );
  }

  async setActiveVersion(
    documentId: string,
    versionId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(documentId, user);

    const version = await this.prisma.baseClient.documentVersion.findFirst({
      where: { id: versionId, documentId },
      select: { id: true },
    });

    if (!version) {
      throw new NotFoundException(
        t('document.version_not_found', 'Document version not found'),
      );
    }

    const updated = await this.prisma.baseClient.internalDocument.update({
      where: { id: documentId },
      data: { activeVersionId: versionId },
      select: DOCUMENT_SELECT,
    });
    this.publishDocumentEvent('updated', documentId);
    return updated;
  }

  async getDownloadUrl(
    documentId: string,
    versionId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    const where: Prisma.InternalDocumentWhereInput = {
      id: documentId,
      deletedAt: null,
    };

    if (!this.isManager(user)) {
      where.isPublished = true;
    }

    const doc = await this.prisma.baseClient.internalDocument.findFirst({
      where,
      select: { id: true },
    });

    if (!doc) {
      throw new NotFoundException(
        t('document.not_found', 'Document not found'),
      );
    }

    await this.enforceDocumentAccess(documentId, user);

    const version = await this.prisma.baseClient.documentVersion.findFirst({
      where: { id: versionId, documentId },
      select: { id: true, fileKey: true, fileName: true, mimeType: true },
    });

    if (!version) {
      throw new NotFoundException(
        t('document.version_not_found', 'Document version not found'),
      );
    }

    const forceAttachment = !INLINE_DISPLAY_MIME_TYPES.includes(
      version.mimeType,
    );

    const { downloadUrl } =
      await this.storageService.generatePresignedDownloadUrl(
        version.fileKey,
        INTERNAL_DOC_PRESIGNED_EXPIRY,
        { filename: version.fileName, forceAttachment },
      );

    return { downloadUrl, expiresIn: INTERNAL_DOC_PRESIGNED_EXPIRY };
  }

  async getAccess(
    documentId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(documentId, user);

    return this.prisma.baseClient.documentAccess.findMany({
      where: { sourceType: DOC_SOURCE_TYPE, sourceId: documentId },
      select: {
        id: true,
        permissionId: true,
        createdAt: true,
        permission: {
          select: { id: true, resource: true, action: true, scope: true },
        },
      },
    });
  }

  async setAccess(
    documentId: string,
    dto: SetDocumentAccessDto,
    user: AuthenticatedUser & { permissions?: string[] },
  ) {
    await this.findById(documentId, user);

    if (dto.permissionIds.length > 0) {
      const found = await this.prisma.baseClient.permission.findMany({
        where: { id: { in: dto.permissionIds } },
        select: { id: true },
      });

      if (found.length !== dto.permissionIds.length) {
        throw new BadRequestException(
          t(
            'document.invalid_permission_ids',
            'One or more permission IDs are invalid',
          ),
        );
      }
    }

    const [prevRows] = await Promise.all([
      this.prisma.baseClient.documentAccess.findMany({
        where: { sourceType: DOC_SOURCE_TYPE, sourceId: documentId },
        select: { permissionId: true },
      }),
    ]);

    const prevIds: string[] = prevRows.map(
      (r: { permissionId: string }) => r.permissionId,
    );
    const added = dto.permissionIds.filter(
      (id: string) => !prevIds.includes(id),
    );
    const removed = prevIds.filter(
      (id: string) => !dto.permissionIds.includes(id),
    );

    await this.prisma.baseClient.$transaction(async (tx) => {
      await tx.documentAccess.deleteMany({
        where: { sourceType: DOC_SOURCE_TYPE, sourceId: documentId },
      });

      if (dto.permissionIds.length > 0) {
        await tx.documentAccess.createMany({
          data: dto.permissionIds.map((permissionId) => ({
            sourceType: DOC_SOURCE_TYPE,
            sourceId: documentId,
            permissionId,
          })),
        });
      }
    });

    return { documentId, added, removed };
  }
}
