import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { StorageService } from '@modules/storage';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import { PatientService } from './patient.service';
import type { FileQueryDto } from './dto/file-query.dto';
import type { UploadFileDto } from './dto/upload-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';

const FILE_SELECT = {
  id: true,
  patientId: true,
  uploadedBy: true,
  fileName: true,
  fileType: true,
  fileUrl: true,
  fileSize: true,
  category: true,
  title: true,
  description: true,
  createdAt: true,
  uploader: {
    select: { fullName: true },
  },
} as const;

type RawFile = {
  id: string;
  patientId: string;
  uploadedBy: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileSize: bigint | number;
  category: string;
  title: string | null;
  description: string | null;
  createdAt: Date;
  uploader: { fullName: string };
};

function mapFile(file: RawFile) {
  const { uploader, fileSize, ...rest } = file;
  return {
    ...rest,
    fileSize: typeof fileSize === 'bigint' ? Number(fileSize) : fileSize,
    uploaderName: uploader.fullName,
  };
}

@Injectable()
export class PatientFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly patientService: PatientService,
  ) {}

  async upload(
    patientId: string,
    file: Express.Multer.File,
    dto: UploadFileDto,
    userId: string,
  ) {
    await this.patientService.findPatientOrFail(patientId);

    const originalName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );

    const stored = await this.storageService.upload(file.buffer, {
      category: 'patient-files',
      entityId: patientId,
      originalFilename: originalName,
      contentType: file.mimetype,
      uploadedBy: userId,
    });

    const created = await this.prisma.baseClient.patientFile.create({
      data: {
        patientId,
        uploadedBy: userId,
        fileName: originalName,
        fileType: file.mimetype,
        fileUrl: stored.key,
        fileSize: file.size,
        category: dto.category,
        title: dto.title?.trim() || null,
        description: dto.description?.trim() || null,
      },
      select: FILE_SELECT,
    });

    return mapFile(created as unknown as RawFile);
  }

  async findAll(patientId: string, query: FileQueryDto) {
    await this.patientService.findPatientOrFail(patientId);

    const prismaArgs = buildPrismaQuery(query, ['createdAt', 'fileName'], {
      createdAt: 'desc',
    });

    const where: Record<string, unknown> = {
      patientId,
      deletedAt: null,
    };
    if (query.category) {
      where.category = query.category;
    }
    if (query.search) {
      where.fileName = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.patientFile.findMany({
        ...prismaArgs,
        where,
        select: FILE_SELECT,
      }),
      this.prisma.baseClient.patientFile.count({ where }),
    ]);

    return buildPaginatedResponse(
      (data as unknown as RawFile[]).map(mapFile),
      total,
      query,
    );
  }

  async getDownloadUrl(patientId: string, fileId: string) {
    const file = await this.findFileOrFail(patientId, fileId);
    return this.storageService.generatePresignedDownloadUrl(file.fileUrl);
  }

  async update(patientId: string, fileId: string, dto: UpdateFileDto) {
    await this.findFileOrFail(patientId, fileId);

    const data: Record<string, unknown> = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.title !== undefined) data.title = dto.title.trim() || null;
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }

    const updated = await this.prisma.baseClient.patientFile.update({
      where: { id: fileId },
      data,
      select: FILE_SELECT,
    });

    return mapFile(updated as unknown as RawFile);
  }

  async delete(patientId: string, fileId: string) {
    const file = await this.findFileOrFail(patientId, fileId);

    await this.prisma.baseClient.patientFile.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    await this.storageService.delete(file.fileUrl);

    return { id: fileId };
  }

  private async findFileOrFail(patientId: string, fileId: string) {
    const file = await this.prisma.baseClient.patientFile.findFirst({
      where: { id: fileId, patientId, deletedAt: null },
      select: { id: true, fileUrl: true },
    });
    if (!file) {
      throw new NotFoundException(
        t('patient.file_not_found', 'Patient file not found'),
      );
    }
    return file;
  }
}
