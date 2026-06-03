import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { AppointmentService } from '@modules/appointment';
import { tryMapConflict } from '@modules/appointment/appointment-conflict.mapper';
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

    // Resolve patient, consume the single-use ticket, and create the appointment
    // in ONE transaction. A slot-overlap (23P01) at insert time rolls the whole
    // unit back, so the ticket stays unconsumed (retryable) and no orphan patient
    // row is left behind.
    let result: { appt: { id: string; startTime: Date }; emit: () => void };
    try {
      result = await this.prisma.transaction(async (tx) => {
        // The transaction client is unextended, so the soft-delete filter is NOT
        // auto-applied — carry deletedAt/isActive explicitly.
        const existingPatients = await tx.patient.findMany({
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
          const newPatient = await tx.patient.create({
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

        // Atomically consume the single-use ticket. Concurrent requests with the
        // same ticket race here; only the one that flips consumedAt (count === 1)
        // proceeds — the rest get a 409.
        const consumed = await tx.bookingVerification.updateMany({
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

        // Raw 23P01 propagates out of the transaction; mapped below after rollback.
        return this.appointmentService.createAppointmentCore(
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
          tx,
        );
      });
    } catch (err) {
      // After rollback: map slot-overlap to a 409 using baseClient (not the tx
      // client). Non-overlap errors (incl. TICKET_ALREADY_USED) rethrow unchanged.
      await tryMapConflict(err, {
        db: this.prisma.baseClient,
        providerId: chosenProviderId,
        startTime,
        endTime,
      });
      throw err;
    }

    // Side-effects only after commit; a failure here must not fail the booking.
    try {
      result.emit();
    } catch (emitErr) {
      this.logger.error('post-commit booking emit failed', emitErr as Error);
    }

    return {
      appointmentId: result.appt.id,
      reference: result.appt.id.replace(/-/g, '').substring(0, 8).toUpperCase(),
      startTime: result.appt.startTime.toISOString(),
    };
  }
}
