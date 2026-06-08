import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { AppointmentHistoryService } from './appointment-history.service';
import { PrismaService } from '@modules/database';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import { SchedulingGateway } from '@modules/scheduling/scheduling.gateway';
import { AppointmentEmailProducer } from './appointment-email.producer';
import { RequestContextService } from '@modules/common/context/request-context';

function emptyLabelMaps() {
  return {
    providers: new Map<string, string>(),
    operatories: new Map<string, string>(),
    types: new Map<string, string>(),
    procedures: new Map<string, string>(),
  };
}

type ExternalTx = Parameters<AppointmentService['createAppointmentCore']>[2];
type CreateApptArg = Parameters<AppointmentService['create']>[0];

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

function operatoryOverlapError() {
  const err = new Error(
    'exclusion constraint appointments_operatory_no_overlap',
  ) as Error & { meta?: { constraint: string } };
  err.meta = { constraint: 'appointments_operatory_no_overlap' };
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
  let history: { record: jest.Mock; resolveLabels: jest.Mock };

  beforeEach(async () => {
    ownTxMock = {
      appointment: { create: jest.fn().mockResolvedValue(makeAppt()) },
      patientProcedure: { findMany: jest.fn(), updateMany: jest.fn() },
      appointmentHistory: { create: jest.fn() },
      $queryRaw: jest.fn(),
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
        operatory: {
          findFirst: jest.fn().mockResolvedValue({ id: 'operatory-uuid' }),
        },
      },
      transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(ownTxMock)),
    };

    availability = { getAvailability: jest.fn() } as any;
    gateway = { emitAppointmentCreated: jest.fn() } as any;
    emailProducer = { publishCreated: jest.fn() } as any;
    history = {
      record: jest.fn().mockResolvedValue(undefined),
      resolveLabels: jest.fn().mockResolvedValue(emptyLabelMaps()),
    };

    const module = await Test.createTestingModule({
      providers: [
        AppointmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProviderAvailabilityService, useValue: availability },
        { provide: SchedulingGateway, useValue: gateway },
        { provide: AppointmentEmailProducer, useValue: emailProducer },
        { provide: AppointmentHistoryService, useValue: history },
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
        externalTx as unknown as ExternalTx,
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
        service.createAppointmentCore(
          coreInput,
          null,
          externalTx as unknown as ExternalTx,
        ),
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

    it('without a tx: maps an operatory overlap to OPERATORY_OVERLAP', async () => {
      ownTxMock.appointment.create.mockRejectedValue(operatoryOverlapError());

      await expect(
        service.createAppointmentCore(
          { ...coreInput, operatoryId: 'operatory-uuid' },
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'OPERATORY_OVERLAP' },
      });
    });

    it('records a created history entry on the same tx, source=staff', async () => {
      await service.createAppointmentCore(coreInput, 'user-1');
      expect(history.record).toHaveBeenCalledWith(
        ownTxMock,
        expect.objectContaining({ action: 'created', source: 'staff' }),
      );
    });

    it('records source=patient_portal for a portal booking on the external tx', async () => {
      const externalTx = {
        appointment: { create: jest.fn().mockResolvedValue(makeAppt()) },
        patientProcedure: { findMany: jest.fn(), updateMany: jest.fn() },
        appointmentHistory: { create: jest.fn() },
        $queryRaw: jest.fn(),
      };
      await service.createAppointmentCore(
        { ...coreInput, bookingSource: 'patient_portal' },
        null,
        externalTx as unknown as ExternalTx,
      );
      expect(history.record).toHaveBeenCalledWith(
        externalTx,
        expect.objectContaining({
          action: 'created',
          source: 'patient_portal',
        }),
      );
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
        operatoryId: 'operatory-uuid',
        startTime: START.toISOString(),
      } as unknown as CreateApptArg);

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
        operatoryId: 'operatory-uuid',
        startTime: START.toISOString(),
      } as unknown as CreateApptArg);

      // The committed appointment is still returned despite the emit failure.
      expect(prisma.baseClient.appointment.findUnique).toHaveBeenCalled();
      expect(result).not.toHaveProperty('emit');
    });

    it('rejects when the operatory is not found or inactive', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue('user-1');
      availability.getAvailability.mockResolvedValue({
        hasApprovedDayOff: false,
        windows: [{ start: '00:00', end: '23:59' }],
      });
      prisma.baseClient.operatory.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          patientId: 'patient-uuid',
          providerId: PROVIDER_ID,
          typeId: 'type-uuid',
          operatoryId: 'missing-operatory',
          startTime: START.toISOString(),
        } as unknown as CreateApptArg),
      ).rejects.toThrow();
    });

    it('passes operatoryId through to createAppointmentCore', async () => {
      jest.spyOn(RequestContextService, 'getUserId').mockReturnValue('user-1');
      availability.getAvailability.mockResolvedValue({
        hasApprovedDayOff: false,
        windows: [{ start: '00:00', end: '23:59' }],
      });
      const coreSpy = jest.spyOn(service, 'createAppointmentCore');

      await service.create({
        patientId: 'patient-uuid',
        providerId: PROVIDER_ID,
        typeId: 'type-uuid',
        operatoryId: 'operatory-uuid',
        startTime: START.toISOString(),
      } as unknown as CreateApptArg);

      expect(coreSpy).toHaveBeenCalledWith(
        expect.objectContaining({ operatoryId: 'operatory-uuid' }),
        'user-1',
      );
    });
  });
});
