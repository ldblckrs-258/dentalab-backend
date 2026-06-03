import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import 'dayjs/locale/vi';
import { PrismaService } from '@modules/database';
import { QueueProducerService } from '@modules/queue';
import { ROUTING_KEY } from '@modules/queue/queue.constants';
import type { AppointmentEmailPayload } from '@modules/queue/interfaces/event-payloads.interface';
import { DEFAULT_TIMEZONE } from '@common/constants/app.constants';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLINIC_NAME = 'DentaLab';

@Injectable()
export class AppointmentEmailProducer {
  private readonly logger = new Logger(AppointmentEmailProducer.name);

  constructor(
    private readonly queue: QueueProducerService,
    private readonly prisma: PrismaService,
  ) {}

  async publishCreated(appointmentId: string): Promise<void> {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt) return;

    const patientLang = 'vi';
    const providerLang = appt.provider.user.preferredLanguage ?? 'vi';
    const vars = this.buildBaseVars(appt, patientLang);

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
      appointmentId,
      appt.patient.email,
      'patient',
      vars,
      patientLang,
    );

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
      appointmentId,
      appt.provider.user.email,
      'provider',
      this.buildBaseVars(appt, providerLang),
      providerLang,
    );
  }

  async publishConfirmed(appointmentId: string): Promise<void> {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt) return;

    const patientLang = 'vi';
    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_CONFIRMED,
      appointmentId,
      appt.patient.email,
      'patient',
      this.buildBaseVars(appt, patientLang),
      patientLang,
    );
  }

  async publishCompleted(appointmentId: string): Promise<void> {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt) return;

    const patientLang = 'vi';
    const providerLang = appt.provider.user.preferredLanguage ?? 'vi';

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_COMPLETED,
      appointmentId,
      appt.patient.email,
      'patient',
      this.buildBaseVars(appt, patientLang),
      patientLang,
    );

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_COMPLETED,
      appointmentId,
      appt.provider.user.email,
      'provider',
      this.buildBaseVars(appt, providerLang),
      providerLang,
    );
  }

  async publishCancelled(
    appointmentId: string,
    reason?: string | null,
  ): Promise<void> {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt) return;

    const patientLang = 'vi';
    const providerLang = appt.provider.user.preferredLanguage ?? 'vi';
    const patientVars = {
      ...this.buildBaseVars(appt, patientLang),
      cancellationReason: reason ?? '',
    };
    const providerVars = {
      ...this.buildBaseVars(appt, providerLang),
      cancellationReason: reason ?? '',
    };

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_CANCELLED,
      appointmentId,
      appt.patient.email,
      'patient',
      patientVars,
      patientLang,
    );

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_APPT_CANCELLED,
      appointmentId,
      appt.provider.user.email,
      'provider',
      providerVars,
      providerLang,
    );
  }

  async publishReminder(appointmentId: string): Promise<void> {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt) return;

    const patientLang = 'vi';
    const providerLang = appt.provider.user.preferredLanguage ?? 'vi';

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_REMINDER,
      appointmentId,
      appt.patient.email,
      'patient',
      this.buildBaseVars(appt, patientLang),
      patientLang,
    );

    this.publishIfEmail(
      ROUTING_KEY.EMAIL_SEND_REMINDER,
      appointmentId,
      appt.provider.user.email,
      'provider',
      this.buildBaseVars(appt, providerLang),
      providerLang,
    );
  }

  private publishIfEmail(
    routingKey: string,
    appointmentId: string,
    email: string | null | undefined,
    recipientRole: 'patient' | 'provider',
    variables: Record<string, string>,
    lang: string,
  ): void {
    if (!email) {
      this.logger.log(
        `Skipping ${routingKey} for ${recipientRole} — no email on appointment ${appointmentId}`,
      );
      return;
    }

    const payload: AppointmentEmailPayload = {
      appointmentId,
      to: email,
      recipientRole,
      variables,
      lang,
    };

    const ok = this.queue.publish(routingKey, payload);
    if (!ok) {
      this.logger.warn(
        `Failed to publish ${routingKey} for ${recipientRole} on appointment ${appointmentId}`,
      );
    }
  }

  private buildBaseVars(
    appt: LoadedAppointment,
    lang: string,
  ): Record<string, string> {
    const locale = lang === 'vi' ? 'vi' : 'en';
    const d = dayjs(appt.startTime).tz(DEFAULT_TIMEZONE).locale(locale);
    const dateStr = d.format(
      locale === 'vi' ? 'dddd, DD/MM/YYYY' : 'dddd, MMMM D, YYYY',
    );
    const timeStr = d.format('HH:mm');

    return {
      patientName: `${appt.patient.lastName} ${appt.patient.firstName}`,
      providerName: appt.provider.user.fullName,
      serviceName: appt.appointmentType.name,
      appointmentDate: dateStr,
      appointmentTime: timeStr,
      clinicName: CLINIC_NAME,
      referenceId: appt.id,
    };
  }

  private async loadAppointment(
    appointmentId: string,
  ): Promise<LoadedAppointment | null> {
    const appt = await this.prisma.baseClient.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        provider: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                preferredLanguage: true,
              },
            },
          },
        },
        appointmentType: { select: { id: true, name: true } },
      },
    });

    if (!appt) {
      this.logger.error(
        `AppointmentEmailProducer: appointment ${appointmentId} not found`,
      );
      return null;
    }

    return appt as LoadedAppointment;
  }
}

interface LoadedAppointment {
  id: string;
  startTime: Date;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  };
  provider: {
    id: string;
    user: {
      id: string;
      fullName: string;
      email: string;
      preferredLanguage: string;
    };
  };
  appointmentType: { id: string; name: string };
}
