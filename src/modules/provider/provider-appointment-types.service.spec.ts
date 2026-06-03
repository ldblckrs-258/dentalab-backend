import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProviderService } from './provider.service';
import { PrismaService } from '@modules/database';
import { StorageService } from '@modules/storage';

const PROVIDER_ID = 'prov-uuid';
const TYPE_A = 'type-a-uuid';
const TYPE_B = 'type-b-uuid';

describe('ProviderService — appointment-type assignment', () => {
  let service: ProviderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        provider: { findUnique: jest.fn() },
        providerAppointmentType: {
          findMany: jest.fn(),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      },
      transaction: jest.fn((fn: (tx: any) => Promise<unknown>) =>
        fn({
          providerAppointmentType: {
            deleteMany: prisma.baseClient.providerAppointmentType.deleteMany,
            createMany: prisma.baseClient.providerAppointmentType.createMany,
          },
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProviderService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { resolveAvatarUrl: (v: string | null) => v },
        },
      ],
    }).compile();

    service = module.get(ProviderService);
  });

  afterEach(() => jest.restoreAllMocks());

  function setupProvider(exists = true) {
    prisma.baseClient.provider.findUnique.mockResolvedValue(
      exists ? { id: PROVIDER_ID } : null,
    );
  }

  describe('getAppointmentTypes()', () => {
    it('returns list of assigned type ids', async () => {
      setupProvider();
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([
        { appointmentTypeId: TYPE_A },
        { appointmentTypeId: TYPE_B },
      ]);

      const result = await service.getAppointmentTypes(PROVIDER_ID);

      expect(result).toEqual([TYPE_A, TYPE_B]);
    });

    it('throws NotFoundException when provider does not exist', async () => {
      setupProvider(false);
      await expect(service.getAppointmentTypes('no-exist')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns empty array when no types assigned', async () => {
      setupProvider();
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([]);

      const result = await service.getAppointmentTypes(PROVIDER_ID);

      expect(result).toEqual([]);
    });
  });

  describe('setAppointmentTypes()', () => {
    it('deletes existing rows then inserts new set (replace semantics)', async () => {
      setupProvider();
      prisma.baseClient.providerAppointmentType.deleteMany.mockResolvedValue({
        count: 1,
      });
      prisma.baseClient.providerAppointmentType.createMany.mockResolvedValue({
        count: 2,
      });
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([
        { appointmentTypeId: TYPE_A },
        { appointmentTypeId: TYPE_B },
      ]);

      await service.setAppointmentTypes(PROVIDER_ID, {
        typeIds: [TYPE_A, TYPE_B],
      });

      expect(
        prisma.baseClient.providerAppointmentType.deleteMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { providerId: PROVIDER_ID } }),
      );
      expect(
        prisma.baseClient.providerAppointmentType.createMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            { providerId: PROVIDER_ID, appointmentTypeId: TYPE_A },
            { providerId: PROVIDER_ID, appointmentTypeId: TYPE_B },
          ]),
        }),
      );
    });

    it('deduplicates typeIds before inserting', async () => {
      setupProvider();
      prisma.baseClient.providerAppointmentType.deleteMany.mockResolvedValue({
        count: 0,
      });
      prisma.baseClient.providerAppointmentType.createMany.mockResolvedValue({
        count: 1,
      });
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([
        { appointmentTypeId: TYPE_A },
      ]);

      await service.setAppointmentTypes(PROVIDER_ID, {
        typeIds: [TYPE_A, TYPE_A],
      });

      const createCall =
        prisma.baseClient.providerAppointmentType.createMany.mock.calls[0][0];
      const insertedTypeIds = createCall.data.map(
        (d: any) => d.appointmentTypeId,
      );
      expect(insertedTypeIds).toEqual([TYPE_A]);
    });

    it('clears all types when empty array provided', async () => {
      setupProvider();
      prisma.baseClient.providerAppointmentType.deleteMany.mockResolvedValue({
        count: 2,
      });
      prisma.baseClient.providerAppointmentType.findMany.mockResolvedValue([]);

      const result = await service.setAppointmentTypes(PROVIDER_ID, {
        typeIds: [],
      });

      expect(
        prisma.baseClient.providerAppointmentType.createMany,
      ).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when provider does not exist', async () => {
      setupProvider(false);
      await expect(
        service.setAppointmentTypes('no-exist', { typeIds: [TYPE_A] }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
