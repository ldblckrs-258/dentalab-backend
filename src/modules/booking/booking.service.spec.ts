import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { PrismaService } from '@modules/database';
import { AppointmentService } from '@modules/appointment/appointment.service';
import { BookingSlotService } from './booking-slot.service';
import type { BookingTicketRequest } from './booking-ticket.guard';

const TICKET: BookingTicketRequest = {
  verificationId: 'verif-uuid',
  email: 'patient@example.com',
};

const TYPE_ID = 'type-uuid';
const PROVIDER_ID = 'provider-uuid';

const TOMORROW_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().substring(0, 10);
})();

const START_ISO = `${TOMORROW_DATE}T02:00:00.000Z`;

function makeSlotResult(providerIds: string[] = [PROVIDER_ID]) {
  return {
    date: TOMORROW_DATE,
    slots: [
      { start: START_ISO, end: `${TOMORROW_DATE}T02:30:00.000Z`, providerIds },
    ],
  };
}

function makeCreatedAppt(id = 'appt-uuid') {
  return {
    id,
    providerId: PROVIDER_ID,
    startTime: new Date(START_ISO),
    endTime: new Date(`${TOMORROW_DATE}T02:30:00.000Z`),
  };
}

// An error shaped like the Postgres exclusion violation tryMapConflict detects.
function overlapError() {
  const err = new Error(
    'exclusion constraint appointments_no_overlap',
  ) as Error & {
    meta?: { constraint: string };
  };
  err.meta = { constraint: 'appointments_no_overlap' };
  return err;
}

// Operatory exclusion violation: drives the auto-assign retry-next-operatory path.
function operatoryOverlapError() {
  const err = new Error(
    'exclusion constraint appointments_operatory_no_overlap',
  ) as Error & { meta?: { constraint: string } };
  err.meta = { constraint: 'appointments_operatory_no_overlap' };
  return err;
}

describe('BookingService', () => {
  let service: BookingService;
  let prisma: any;
  let txMock: any;
  let slotService: {
    getBookableSlots: jest.Mock;
    getFreeOperatoryIds: jest.Mock;
  };
  let appointmentService: { createAppointmentCore: jest.Mock };

  beforeEach(async () => {
    // The transaction client used INSIDE prisma.transaction(fn). Patient resolve,
    // ticket consume, and the appointment insert all run on this client now.
    txMock = {
      patient: { findMany: jest.fn(), create: jest.fn() },
      bookingVerification: { updateMany: jest.fn() },
    };

    prisma = {
      baseClient: {
        appointmentType: { findUnique: jest.fn() },
        // Used by tryMapConflict AFTER rollback to list conflicting ids.
        appointment: { findMany: jest.fn().mockResolvedValue([]) },
      },
      // Interactive transaction: invoke the callback with txMock, rethrow on error.
      transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(txMock)),
    };

    slotService = {
      getBookableSlots: jest.fn(),
      getFreeOperatoryIds: jest.fn().mockResolvedValue(['op-1']),
    } as any;
    appointmentService = { createAppointmentCore: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: PrismaService, useValue: prisma },
        { provide: BookingSlotService, useValue: slotService },
        { provide: AppointmentService, useValue: appointmentService },
      ],
    }).compile();

    service = module.get(BookingService);
  });

  afterEach(() => jest.restoreAllMocks());

  function setupType(active = true) {
    prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
      id: TYPE_ID,
      durationMinutes: 30,
      isActive: active,
    });
  }

  // createAppointmentCore now returns { appt, emit } and is called with the tx.
  function mockCoreResolves(id?: string) {
    appointmentService.createAppointmentCore.mockResolvedValue({
      appt: makeCreatedAppt(id),
      emit: jest.fn(),
    });
  }

  function ticketConsumes() {
    txMock.bookingVerification.updateMany.mockResolvedValue({ count: 1 });
  }

  const validDto = {
    typeId: TYPE_ID,
    providerId: PROVIDER_ID,
    startTime: START_ISO,
    patient: { firstName: 'Jane', lastName: 'Doe', phone: '0901000001' },
  };

  it('throws 400 when appointment type is inactive', async () => {
    setupType(false);
    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws 400 when startTime does not match any bookable slot', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue({
      date: TOMORROW_DATE,
      slots: [],
    });
    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resolves the patient INSIDE the transaction with soft-delete guards', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(txMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'patient@example.com', mode: 'insensitive' },
          deletedAt: null,
          isActive: true,
        }),
      }),
    );
    // Never resolved on the (extension-less) baseClient.
    expect(prisma.baseClient).not.toHaveProperty('patient');
  });

  it('creates a new patient ON THE TX when no existing patient matches email', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([]);
    txMock.patient.create.mockResolvedValue({ id: 'new-patient-uuid' });
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(txMock.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'patient@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      }),
    );
    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'new-patient-uuid' }),
      null,
      txMock,
    );
  });

  it('reuses existing patient when exactly one matches email', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([
      { id: 'existing-patient-uuid' },
    ]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(txMock.patient.create).not.toHaveBeenCalled();
    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'existing-patient-uuid' }),
      null,
      txMock,
    );
  });

  it('creates new patient when more than one patient matches (ambiguous)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    txMock.patient.create.mockResolvedValue({ id: 'new-p-uuid' });
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(txMock.patient.create).toHaveBeenCalled();
  });

  it('calls createAppointmentCore with bookingSource=patient_portal, createdById=null, and the tx', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingSource: 'patient_portal',
        status: 'scheduled',
      }),
      null,
      txMock,
    );
  });

  it('consumes BookingVerification on the tx guarded by consumedAt: null', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(txMock.bookingVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'verif-uuid', consumedAt: null },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('throws 409 and does NOT create an appointment when the ticket was already consumed', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    txMock.bookingVerification.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
    expect(appointmentService.createAppointmentCore).not.toHaveBeenCalled();
    // The TICKET_ALREADY_USED 409 must pass through tryMapConflict unchanged —
    // it must NOT be re-mapped as an appointment overlap (no conflict re-query).
    expect(prisma.baseClient.appointment.findMany).not.toHaveBeenCalled();
  });

  it('maps a raw slot-overlap (23P01) thrown from createAppointmentCore to a 409', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    // createAppointmentCore (mocked) rejects with the raw exclusion error,
    // standing in for an external-tx propagation; booking's outer catch must map
    // it to a 409 via tryMapConflict. (Real raw-propagation is covered in
    // appointment.service.spec.ts.)
    appointmentService.createAppointmentCore.mockRejectedValue(overlapError());

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
    // tryMapConflict re-queries conflicts via baseClient AFTER rollback.
    expect(prisma.baseClient.appointment.findMany).toHaveBeenCalled();
  });

  it('rethrows a non-overlap error unchanged (no false 409)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    appointmentService.createAppointmentCore.mockRejectedValue(
      new Error('db connection lost'),
    );

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      'db connection lost',
    );
  });

  it('fires the post-commit emit exactly once on success', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    const emit = jest.fn();
    appointmentService.createAppointmentCore.mockResolvedValue({
      appt: makeCreatedAppt(),
      emit,
    });

    await service.createBooking(TICKET, validDto);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when the post-commit emit throws', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    appointmentService.createAppointmentCore.mockResolvedValue({
      appt: makeCreatedAppt('abcd1234-5678-90ab-cdef-000000000000'),
      emit: () => {
        throw new Error('gateway down');
      },
    });

    const result = await service.createBooking(TICKET, validDto);

    expect(result.appointmentId).toBe('abcd1234-5678-90ab-cdef-000000000000');
  });

  it('returns appointmentId, reference and startTime on success', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves('abcd1234-5678-90ab-cdef-000000000000');

    const result = await service.createBooking(TICKET, validDto);

    expect(result.appointmentId).toBe('abcd1234-5678-90ab-cdef-000000000000');
    expect(result.reference).toHaveLength(8);
    expect(result.startTime).toBe(START_ISO);
  });

  it('uses client providerId when it is in the slot providerIds', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(
      makeSlotResult([PROVIDER_ID, 'other-provider']),
    );
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, {
      ...validDto,
      providerId: PROVIDER_ID,
    });

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: PROVIDER_ID }),
      null,
      txMock,
    );
  });

  it('falls back to first slot providerId when client providerId is not in slot', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(
      makeSlotResult(['first-provider', 'second-provider']),
    );
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, {
      ...validDto,
      providerId: 'nonexistent-provider',
    });

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'first-provider' }),
      null,
      txMock,
    );
  });

  it('lowercases email from ticket when querying/creating patient', async () => {
    const upperTicket = { ...TICKET, email: 'PATIENT@EXAMPLE.COM' };
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    txMock.patient.findMany.mockResolvedValue([]);
    txMock.patient.create.mockResolvedValue({ id: 'new-p' });
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(upperTicket, validDto);

    expect(txMock.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'patient@example.com' }),
      }),
    );
  });

  it('auto-assigns the highest-priority (first) free operatory', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    slotService.getFreeOperatoryIds.mockResolvedValue(['op-A', 'op-B']);
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    mockCoreResolves();

    await service.createBooking(TICKET, validDto);

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledTimes(1);
    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ operatoryId: 'op-A' }),
      null,
      txMock,
    );
  });

  it('retries the next free operatory in a fresh tx on an operatory conflict', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    slotService.getFreeOperatoryIds.mockResolvedValue(['op-A', 'op-B']);
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    appointmentService.createAppointmentCore
      .mockRejectedValueOnce(operatoryOverlapError())
      .mockResolvedValueOnce({ appt: makeCreatedAppt(), emit: jest.fn() });

    await service.createBooking(TICKET, validDto);

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledTimes(2);
    expect(appointmentService.createAppointmentCore).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ operatoryId: 'op-A' }),
      null,
      txMock,
    );
    expect(appointmentService.createAppointmentCore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operatoryId: 'op-B' }),
      null,
      txMock,
    );
    // Each attempt is its own transaction.
    expect(prisma.transaction).toHaveBeenCalledTimes(2);
  });

  it('throws 409 SLOT_UNAVAILABLE when no operatory is free (e.g. none configured)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    slotService.getFreeOperatoryIds.mockResolvedValue([]);

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
    expect(appointmentService.createAppointmentCore).not.toHaveBeenCalled();
  });

  it('throws 409 SLOT_UNAVAILABLE when every free operatory is taken in the race', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    slotService.getFreeOperatoryIds.mockResolvedValue(['op-A', 'op-B']);
    txMock.patient.findMany.mockResolvedValue([{ id: 'patient-uuid' }]);
    ticketConsumes();
    appointmentService.createAppointmentCore.mockRejectedValue(
      operatoryOverlapError(),
    );

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
    expect(appointmentService.createAppointmentCore).toHaveBeenCalledTimes(2);
  });
});
