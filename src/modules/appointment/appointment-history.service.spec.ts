import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { AppointmentHistoryService } from './appointment-history.service';
import { RequestContextService } from '@modules/common/context/request-context';

type Ctx = ReturnType<typeof RequestContextService.getCurrentContext>;
type Tx = Prisma.TransactionClient;

describe('AppointmentHistoryService', () => {
  let service: AppointmentHistoryService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      baseClient: {
        appointment: { findUnique: jest.fn() },
        appointmentHistory: { findMany: jest.fn() },
        provider: { findMany: jest.fn().mockResolvedValue([]) },
        operatory: { findMany: jest.fn().mockResolvedValue([]) },
        appointmentType: { findMany: jest.fn().mockResolvedValue([]) },
        patientProcedure: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    service = new AppointmentHistoryService(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('record', () => {
    it('writes via the passed tx with actorId from context and default source', async () => {
      jest
        .spyOn(RequestContextService, 'getCurrentContext')
        .mockReturnValue({ userId: 'user-9' } as unknown as Ctx);
      const tx = { appointmentHistory: { create: jest.fn() } };

      await service.record(tx as unknown as Tx, {
        appointmentId: 'appt-1',
        action: 'updated',
        changes: [],
      });

      expect(tx.appointmentHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appointmentId: 'appt-1',
          action: 'updated',
          source: 'staff',
          actorId: 'user-9',
        }),
      });
    });

    it('falls back to null actorId when no request context', async () => {
      jest
        .spyOn(RequestContextService, 'getCurrentContext')
        .mockReturnValue(undefined);
      const tx = { appointmentHistory: { create: jest.fn() } };

      await service.record(tx as unknown as Tx, {
        appointmentId: 'appt-1',
        action: 'created',
        changes: [],
        source: 'patient_portal',
      });

      expect(tx.appointmentHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'patient_portal',
          actorId: null,
        }),
      });
    });
  });

  describe('resolveLabels', () => {
    it('maps provider names via the user relation and skips empty id sets', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([
        { id: 'prov-1', user: { fullName: 'Dr. A' } },
      ]);

      const maps = await service.resolveLabels({
        providerIds: ['prov-1', null],
      });

      expect(maps.providers.get('prov-1')).toBe('Dr. A');
      // No operatory ids passed → that query must not run.
      expect(prisma.baseClient.operatory.findMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('throws 404 when the appointment does not exist', async () => {
      prisma.baseClient.appointment.findUnique.mockResolvedValue(null);
      await expect(service.list('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('orders by createdAt asc then id, and resolves actor names without email', async () => {
      prisma.baseClient.appointment.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.baseClient.appointmentHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          action: 'created',
          changes: [],
          reason: null,
          source: 'staff',
          actorId: 'u1',
          actor: { id: 'u1', fullName: 'Dr. A' },
          createdAt: new Date('2026-06-04T00:00:00Z'),
        },
        {
          id: 'h2',
          action: 'cancelled',
          changes: [],
          reason: 'patient request',
          source: 'patient_portal',
          actorId: null,
          actor: null,
          createdAt: new Date('2026-06-04T01:00:00Z'),
        },
        {
          id: 'h3',
          action: 'updated',
          changes: [],
          reason: null,
          source: 'staff',
          actorId: 'gone',
          actor: null,
          createdAt: new Date('2026-06-04T02:00:00Z'),
        },
      ]);

      const result = await service.list('a1');

      expect(
        prisma.baseClient.appointmentHistory.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result[0].actor).toEqual({ id: 'u1', name: 'Dr. A' });
      // patient_portal with no actor → sentinel 'patient'
      expect(result[1].actor).toEqual({ id: null, name: 'patient' });
      // staff actor row whose user was deleted → sentinel 'deleted_user'
      expect(result[2].actor).toEqual({ id: 'gone', name: 'deleted_user' });
      // No email surfaces anywhere.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('@');
    });
  });
});
