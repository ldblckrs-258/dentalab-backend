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

describe('BookingService', () => {
  let service: BookingService;
  let prisma: any;
  let slotService: { getBookableSlots: jest.Mock };
  let appointmentService: { createAppointmentCore: jest.Mock };

  beforeEach(async () => {
    prisma = {
      baseClient: {
        appointmentType: { findUnique: jest.fn() },
        patient: { findMany: jest.fn(), create: jest.fn() },
        bookingVerification: { updateMany: jest.fn() },
      },
    };

    slotService = { getBookableSlots: jest.fn() } as any;
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

  it('creates a new patient when no existing patient matches email', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([]);
    prisma.baseClient.patient.create.mockResolvedValue({
      id: 'new-patient-uuid',
    });
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, validDto);

    expect(prisma.baseClient.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'patient@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      }),
    );
  });

  it('reuses existing patient when exactly one matches email', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'existing-patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, validDto);

    expect(prisma.baseClient.patient.create).not.toHaveBeenCalled();
    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'existing-patient-uuid' }),
      null,
    );
  });

  it('creates new patient when more than one patient matches (ambiguous)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
    ]);
    prisma.baseClient.patient.create.mockResolvedValue({ id: 'new-p-uuid' });
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, validDto);

    expect(prisma.baseClient.patient.create).toHaveBeenCalled();
  });

  it('calls createAppointmentCore with bookingSource=patient_portal and createdById=null', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, validDto);

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingSource: 'patient_portal',
        status: 'scheduled',
      }),
      null,
    );
  });

  it('atomically consumes BookingVerification (guarded by consumedAt: null) before creating', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, validDto);

    expect(
      prisma.baseClient.bookingVerification.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'verif-uuid', consumedAt: null },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('throws 409 when the ticket was already consumed (concurrent reuse)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
    expect(appointmentService.createAppointmentCore).not.toHaveBeenCalled();
  });

  it('propagates ConflictException from createAppointmentCore (double-book)', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });
    appointmentService.createAppointmentCore.mockRejectedValue(
      new ConflictException({
        code: 'APPOINTMENT_OVERLAP',
        message: 'Conflict',
      }),
    );

    await expect(service.createBooking(TICKET, validDto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('returns appointmentId, reference and startTime on success', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt('abcd1234-5678-90ab-cdef-000000000000'),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

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
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, {
      ...validDto,
      providerId: PROVIDER_ID,
    });

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: PROVIDER_ID }),
      null,
    );
  });

  it('falls back to first slot providerId when client providerId is not in slot', async () => {
    setupType();
    slotService.getBookableSlots.mockResolvedValue(
      makeSlotResult(['first-provider', 'second-provider']),
    );
    prisma.baseClient.patient.findMany.mockResolvedValue([
      { id: 'patient-uuid' },
    ]);
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(TICKET, {
      ...validDto,
      providerId: 'nonexistent-provider',
    });

    expect(appointmentService.createAppointmentCore).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'first-provider' }),
      null,
    );
  });

  it('lowercases email from ticket when querying/creating patient', async () => {
    const upperTicket = { ...TICKET, email: 'PATIENT@EXAMPLE.COM' };
    setupType();
    slotService.getBookableSlots.mockResolvedValue(makeSlotResult());
    prisma.baseClient.patient.findMany.mockResolvedValue([]);
    prisma.baseClient.patient.create.mockResolvedValue({ id: 'new-p' });
    appointmentService.createAppointmentCore.mockResolvedValue(
      makeCreatedAppt(),
    );
    prisma.baseClient.bookingVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.createBooking(upperTicket, validDto);

    expect(prisma.baseClient.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'patient@example.com' }),
      }),
    );
  });
});
