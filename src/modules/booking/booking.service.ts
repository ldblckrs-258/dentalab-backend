import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { AppointmentService } from '@modules/appointment';
import {
  isOperatoryConstraint,
  tryMapConflict,
} from '@modules/appointment/appointment-conflict.mapper';
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

    // Auto-assign the highest-priority free operatory. Each attempt runs in its
    // OWN transaction: a 23P01 aborts a Postgres transaction, so retrying inside
    // one transaction is impossible. On an operatory conflict we open a fresh
    // transaction for the next operatory; the single-use ticket is consumed only
    // by the committing attempt (a failed attempt rolls the consume back).
    const freeOperatoryIds = await this.slotService.getFreeOperatoryIds(
      startTime,
      endTime,
    );

    let result: {
      appt: { id: string; startTime: Date };
      emit: () => void;
    } | null = null;

    for (const operatoryId of freeOperatoryIds) {
      try {
        result = await this.prisma.transaction(async (tx) => {
          // Unextended tx client: carry deletedAt/isActive explicitly.
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

          return this.appointmentService.createAppointmentCore(
            {
              patientId,
              providerId: chosenProviderId,
              typeId: dto.typeId,
              operatoryId,
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
        break;
      } catch (err) {
        // Operatory taken between free-list computation and insert: the tx is
        // rolled back (ticket freed) — try the next free operatory.
        if (isOperatoryConstraint(err)) {
          continue;
        }
        // Provider overlap → 409; any other error (incl. TICKET_ALREADY_USED) rethrows.
        await tryMapConflict(err, {
          db: this.prisma.baseClient,
          providerId: chosenProviderId,
          operatoryId,
          startTime,
          endTime,
        });
        throw err;
      }
    }

    if (!result) {
      // No operatory configured, or all free ones were taken in the race.
      throw new ConflictException(
        t(
          'booking.SLOT_UNAVAILABLE',
          'This time slot is no longer available; please choose another',
        ),
      );
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
