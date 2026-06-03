import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { PrismaService } from '@modules/database';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import { SchedulingGateway } from '@modules/scheduling/scheduling.gateway';
import { AppointmentEmailProducer } from './appointment-email.producer';
import { RequestContextService } from '@modules/common/context/request-context';

const PROVIDER_ID = 'provider-uuid';
const START = new Date('2026-06-04T02:00:00.000Z');
const END = new Date('2026-06-04T02:30:00.000Z');

function makeAppt(id = 'appt-uuid') {
  return {
    id,
    providerId: PROVIDER_ID,
    startTime: START,
    endTime: END,
  };
}

function overlapError() {
  const err = new Error(
    'exclusion constraint appointments_no_overlap',
  ) as Error & {
    meta?: { constraint: string };
  };
  err.meta = { constraint: 'appointments_no_overlap' };
  return err;
}

const coreInput = {
  patientId: 'patient-uuid',
  providerId: PROVIDER_ID,
  typeId: 'type-uuid',
  startTime: START,
  endTime: END,
  status: 'scheduled',
  bookingSource: 'staff',
};

describe('AppointmentService', () => {
  let service: AppointmentService;
  let prisma: any;
  let ownTxMock: any;
  let availability: { getAvailability: jest.Mock };
  let gateway: { emitAppointmentCreated: jest.Mock };
  let emailProducer: { publishCreated: jest.Mock };

  beforeEach(async () => {
    ownTxMock = {
      appointment: { create: jest.fn().mockResolvedValue(makeAppt()) },
      patientProcedure: { findMany: jest.fn(), updateMany: jest.fn() },
    };

    prisma = {
      baseClient: {
        appointment: {
          findUnique: jest.fn().mockResolvedValue(makeAppt()),
          findMany: jest.fn().mockResolvedValue([]),
        },
        appointmentType: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'type-uuid',
            durationMinutes: 30,
            isActive: true,
          }),
        },
        patient: {
          findFirst: jest.fn().mockResolvedValue({ id: 'patient-uuid' }),
        },
        provider: {
          findFirst: jest.fn().mockResolvedValue({ id: PROVIDER_ID }),
        },
      },
      transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(ownTxMock)),
    };

    availability = { getAvailability: jest.fn() } as any;
    gateway = { emitAppointmentCreated: jest.fn() } as any;
    emailProducer = { publishCreated: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        AppointmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProviderAvailabilityService, useValue: availability },
        { provide: SchedulingGateway, useValue: gateway },
        { provide: AppointmentEmailProducer, useValue: emailProducer },
      ],
    }).compile();

    service = module.get(AppointmentService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createAppointmentCore', () => {
    it('with an external tx: inserts on that tx and does NOT emit during the call', async () => {
      const externalTx = {
        appointment: { create: jest.fn().mockResolvedValue(makeAppt()) },
        patientProcedure: { findMany: jest.fn(), updateMany: jest.fn() },
      };

      const { appt, emit } = await service.createAppointmentCore(
        coreInput,
        null,
        externalTx as any,
      );

      expect(externalTx.appointment.create).toHaveBeenCalled();
      expect(prisma.transaction).not.toHaveBeenCalled(); // used caller's tx
      expect(gateway.emitAppointmentCreated).not.toHaveBeenCalled();
      expect(emailProducer.publishCreated).not.toHaveBeenCalled();
      expect(appt.id).toBe('appt-uuid');

      // Side-effects only fire when the caller invokes emit() post-commit.
      emit();
      expect(gateway.emitAppointmentCreated).toHaveBeenCalledTimes(1);
      expect(emailProducer.publishCreated).toHaveBeenCalledWith('appt-uuid');
    });

    it('with an external tx: lets a raw 23P01 propagate (no internal mapping)', async () => {
      const externalTx = {
        appointment: { create: jest.fn().mockRejectedValue(overlapError()) },
        patientProcedure: { findMany: jest.fn(), updateMany: jest.fn() },
      };

      await expect(
        service.createAppointmentCore(coreInput, null, externalTx as any),
      ).rejects.toMatchObject({
        meta: { constraint: 'appointments_no_overlap' },
      });
      // Did NOT swallow into a ConflictException — caller maps after rollback.
      expect(prisma.baseClient.appointment.findMany).not.toHaveBeenCalled();
    });

    it('without a tx: opens its own transaction and defers emit', async () => {
      const { appt, emit } = await service.createAppointmentCore(
        coreInput,
        'user-1',
      );

      expect(prisma.transaction).toHaveBeenCalledTimes(1);
      expect(ownTxMock.appointment.create).toHaveBeenCalled();
      expect(gateway.emitAppointmentCreated).not.toHaveBeenCalled();
      expect(appt.id).toBe('appt-uuid');

      emit();
      expect(gateway.emitAppointmentCreated).toHaveBeenCalledTimes(1);
    });

    it('without a tx: maps a slot-overlap (23P01) to a 409 via tryMapConflict', async () => {
      ownTxMock.appointment.create.mockRejectedValue(overlapError());

      await expect(
        service.createAppointmentCore(coreInput, 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.baseClient.appointment.findMany).toHaveBeenCalled();
    });
  });

  describe('create (staff path)', () => {
    it('returns the full appointment (not the {appt, emit} pair) and emits', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue('user-1');
      availability.getAvailability.mockResolvedValue({
        hasApprovedDayOff: false,
        windows: [{ start: '00:00', end: '23:59' }],
      });

      const result = await service.create({
        patientId: 'patient-uuid',
        providerId: PROVIDER_ID,
        typeId: 'type-uuid',
        startTime: START.toISOString(),
      } as any);

      // findById return shape, NOT { appt, emit }.
      expect(result).not.toHaveProperty('emit');
      expect(prisma.baseClient.appointment.findUnique).toHaveBeenCalled();
      expect(gateway.emitAppointmentCreated).toHaveBeenCalledTimes(1);
    });

    it('still returns the appointment when the post-commit emit throws', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue('user-1');
      availability.getAvailability.mockResolvedValue({
        hasApprovedDayOff: false,
        windows: [{ start: '00:00', end: '23:59' }],
      });
      gateway.emitAppointmentCreated.mockImplementation(() => {
        throw new Error('gateway down');
      });

      const result = await service.create({
        patientId: 'patient-uuid',
        providerId: PROVIDER_ID,
        typeId: 'type-uuid',
        startTime: START.toISOString(),
      } as any);

      // The committed appointment is still returned despite the emit failure.
      expect(prisma.baseClient.appointment.findUnique).toHaveBeenCalled();
      expect(result).not.toHaveProperty('emit');
    });
  });
});
