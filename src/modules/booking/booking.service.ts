import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { AppointmentService } from '@modules/appointment';
import { BookingSlotService } from './booking-slot.service';
import { t } from '@common/utils';
import type { CreateBookingDto } from './dto/create-booking.dto';
import type { BookingTicketRequest } from './booking-ticket.guard';

export interface CreateBookingResult {
  appointmentId: string;
  reference: string;
  startTime: string;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slotService: BookingSlotService,
    private readonly appointmentService: AppointmentService,
  ) {}

  async createBooking(
    ticket: BookingTicketRequest,
    dto: CreateBookingDto,
  ): Promise<CreateBookingResult> {
    const emailLower = ticket.email.toLowerCase();

    const apptType = await this.prisma.baseClient.appointmentType.findUnique({
      where: { id: dto.typeId },
      select: { id: true, durationMinutes: true, isActive: true },
    });
    if (!apptType || !apptType.isActive) {
      throw new BadRequestException(
        t(
          'appointment.TYPE_NOT_FOUND',
          'Appointment type not found or inactive',
        ),
      );
    }

    const startTime = new Date(dto.startTime);
    const dateStr = startTime.toISOString().substring(0, 10);

    const slotsResult = await this.slotService.getBookableSlots({
      typeId: dto.typeId,
      providerId: dto.providerId,
      date: dateStr,
    });

    const matchedSlot = slotsResult.slots.find(
      (s) => new Date(s.start).getTime() === startTime.getTime(),
    );
    if (!matchedSlot) {
      throw new BadRequestException(
        t('booking.INVALID_SLOT', 'Selected time is not a valid bookable slot'),
      );
    }

    const endTime = new Date(
      startTime.getTime() + apptType.durationMinutes * 60_000,
    );

    const chosenProviderId =
      dto.providerId && matchedSlot.providerIds.includes(dto.providerId)
        ? dto.providerId
        : matchedSlot.providerIds[0];

    const existingPatients = await this.prisma.baseClient.patient.findMany({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });

    let patientId: string;

    if (existingPatients.length === 1) {
      patientId = existingPatients[0].id;
    } else {
      if (existingPatients.length > 1) {
        this.logger.warn(
          `Ambiguous patient email on portal booking: ${emailLower} matches ${existingPatients.length} records — creating new patient`,
        );
      }
      const newPatient = await this.prisma.baseClient.patient.create({
        data: {
          firstName: dto.patient.firstName,
          lastName: dto.patient.lastName,
          phone: dto.patient.phone,
          email: emailLower,
          gender: dto.patient.gender,
          address: dto.patient.address,
          dateOfBirth: dto.patient.dateOfBirth
            ? new Date(dto.patient.dateOfBirth)
            : undefined,
        },
        select: { id: true },
      });
      patientId = newPatient.id;
    }

    // Atomically consume the single-use ticket BEFORE creating the appointment.
    // Concurrent requests with the same ticket race here; only the one that
    // flips consumedAt (count === 1) proceeds — the rest get a 409.
    const consumed =
      await this.prisma.baseClient.bookingVerification.updateMany({
        where: { id: ticket.verificationId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    if (consumed.count === 0) {
      throw new ConflictException(
        t(
          'booking.TICKET_ALREADY_USED',
          'This booking session has already been used',
        ),
      );
    }

    const createdAppt = await this.appointmentService.createAppointmentCore(
      {
        patientId,
        providerId: chosenProviderId,
        typeId: dto.typeId,
        startTime,
        endTime,
        status: 'scheduled',
        bookingSource: 'patient_portal',
        chiefComplaint: dto.chiefComplaint,
      },
      null,
    );

    return {
      appointmentId: createdAppt.id,
      reference: createdAppt.id.replace(/-/g, '').substring(0, 8).toUpperCase(),
      startTime: createdAppt.startTime.toISOString(),
    };
  }
}
