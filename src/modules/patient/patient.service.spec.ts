import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PrismaService } from '@modules/database';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { PatientQueryDto } from './dto/patient-query.dto';

describe('PatientService', () => {
  let service: PatientService;
  let prisma: any;
  let queueProducer: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        patient: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
      transaction: jest.fn(async (cb) => {
        const tx = {
          patient: {
            findFirst: jest.fn(),
            update: jest.fn(),
          },
          kioskSession: { updateMany: jest.fn() },
          clinicalNote: { updateMany: jest.fn() },
          patientFile: { updateMany: jest.fn() },
          formSubmission: { updateMany: jest.fn() },
        };
        // By default findFirst succeeds so the tx can proceed
        tx.patient.findFirst.mockResolvedValue({ id: 'patient-1' });
        await cb(tx);
        return tx;
      }),
    };

    queueProducer = {
      publish: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PatientService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueProducerService, useValue: queueProducer },
      ],
    }).compile();

    service = module.get(PatientService);
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.baseClient.patient.findMany.mockResolvedValue([
        { id: '1', firstName: 'John' },
      ]);
      prisma.baseClient.patient.count.mockResolvedValue(1);

      const query: PatientQueryDto = { page: 1, limit: 10 };
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.baseClient.patient.findMany).toHaveBeenCalled();
    });

    it('should filter by isActive', async () => {
      const query: PatientQueryDto = { isActive: true, page: 1, limit: 10 };
      await service.findAll(query);

      expect(prisma.baseClient.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, deletedAt: null }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return patient if found', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        firstName: 'John',
      });
      const result = await service.findById('patient-1');
      expect(result.id).toBe('patient-1');
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue(null);
      await expect(service.findById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a new patient', async () => {
      const dto = {
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-01-01',
      };
      prisma.baseClient.patient.create.mockResolvedValue({
        id: 'new-id',
        ...dto,
      });

      const result = await service.create(dto);

      expect(result.id).toBe('new-id');
      expect(prisma.baseClient.patient.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update patient fields if patient exists', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
      });
      prisma.baseClient.patient.update.mockResolvedValue({
        id: 'patient-1',
        firstName: 'Updated',
      });

      const result = await service.update('patient-1', {
        firstName: 'Updated',
      });

      expect(result.firstName).toBe('Updated');
      expect(prisma.baseClient.patient.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if patient does not exist', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue(null);
      await expect(service.update('unknown', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete (GDPR cascade)', () => {
    it('should perform GDPR cascade deletion in transaction', async () => {
      await service.delete('patient-1', 'Patient requested deletion');

      expect(prisma.transaction).toHaveBeenCalled();
      expect(queueProducer.publish).toHaveBeenCalledWith(
        ROUTING_KEY.DOCUMENT_DELETED,
        { documentId: 'patient-1', sourceType: 'patient' },
      );
    });

    it('should throw NotFoundException if patient not found inside transaction', async () => {
      // Override the transaction mock to simulate not finding the patient
      prisma.transaction = jest.fn(async (cb) => {
        const tx = {
          patient: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        await cb(tx);
      });

      await expect(service.delete('unknown', 'reason')).rejects.toThrow(
        NotFoundException,
      );
      expect(queueProducer.publish).not.toHaveBeenCalled();
    });
  });
});
