import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PatientFileService } from './patient-file.service';
import { PrismaService } from '@modules/database';
import { StorageService } from '@modules/storage';
import { PatientService } from './patient.service';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { FileQueryDto } from './dto/file-query.dto';
import type { FileCategory } from './dto/upload-file.dto';

const makeFile = (overrides: Record<string, unknown> = {}) => ({
  id: 'file-1',
  patientId: 'patient-1',
  uploadedBy: 'user-1',
  fileName: 'test.pdf',
  fileType: 'application/pdf',
  fileUrl: 's3-key-123',
  fileSize: 1024,
  category: 'document',
  title: null,
  description: null,
  createdAt: new Date(),
  uploader: { fullName: 'Test User' },
  ...overrides,
});

describe('PatientFileService', () => {
  let service: PatientFileService;
  let prisma: any;
  let storageService: any;
  let patientService: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        patientFile: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    storageService = {
      upload: jest.fn(),
      generatePresignedDownloadUrl: jest.fn(),
      delete: jest.fn(),
    };

    patientService = {
      findPatientOrFail: jest.fn().mockResolvedValue({ id: 'patient-1' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PatientFileService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: PatientService, useValue: patientService },
      ],
    }).compile();

    service = module.get(PatientFileService);
  });

  describe('upload', () => {
    it('should create file record and upload to storage', async () => {
      storageService.upload.mockResolvedValue({ key: 's3-key-123' });
      prisma.baseClient.patientFile.create.mockResolvedValue(makeFile());

      const file = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('test'),
      } as any;
      const category: FileCategory = 'document';

      const result = await service.upload(
        'patient-1',
        file as Express.Multer.File,
        { category },
        'user-1',
      );

      expect(result.id).toBe('file-1');
      expect(storageService.upload).toHaveBeenCalled();
      expect(prisma.baseClient.patientFile.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if patient does not exist', async () => {
      patientService.findPatientOrFail.mockRejectedValue(
        new NotFoundException('Patient not found'),
      );

      const file = { originalname: 'test.pdf' } as any;
      await expect(
        service.upload(
          'unknown',
          file as Express.Multer.File,
          { category: 'document' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated file list', async () => {
      prisma.baseClient.patientFile.findMany.mockResolvedValue([makeFile()]);
      prisma.baseClient.patientFile.count.mockResolvedValue(1);

      const query: FileQueryDto = { page: 1, limit: 10 };
      const result = await service.findAll('patient-1', query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getDownloadUrl', () => {
    it('should return presigned URL', async () => {
      prisma.baseClient.patientFile.findFirst.mockResolvedValue({
        id: 'file-1',
        fileUrl: 's3-key-123',
      });
      storageService.generatePresignedDownloadUrl.mockResolvedValue(
        'https://presigned.url',
      );

      const result = await service.getDownloadUrl('patient-1', 'file-1');

      expect(result).toBe('https://presigned.url');
      expect(storageService.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        's3-key-123',
      );
    });

    it('should throw NotFoundException if file not found', async () => {
      prisma.baseClient.patientFile.findFirst.mockResolvedValue(null);
      await expect(
        service.getDownloadUrl('patient-1', 'unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should soft-delete file record and delete from storage', async () => {
      prisma.baseClient.patientFile.findFirst.mockResolvedValue({
        id: 'file-1',
        fileUrl: 's3-key-123',
      });
      prisma.baseClient.patientFile.update.mockResolvedValue({ id: 'file-1' });

      const result = await service.delete('patient-1', 'file-1');

      expect(result.id).toBe('file-1');
      expect(prisma.baseClient.patientFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'file-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(storageService.delete).toHaveBeenCalledWith('s3-key-123');
    });
  });
});
