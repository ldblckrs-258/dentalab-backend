import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@modules/database';
import { KIOSK_STATUS_ACTIVE, KIOSK_STATUS_COMPLETED } from '@common/constants';
import { hashToken, t } from '@common/utils';
import type { CreateKioskSessionDto } from './dto/create-kiosk-session.dto';
import type { AuthenticateKioskDto } from './dto/authenticate-kiosk.dto';

interface SessionFormRow {
  form: { id: string; title: string; schema: unknown };
  status: string;
  completed_at: Date | null;
}

function mapSessionForm(sf: SessionFormRow) {
  return {
    id: sf.form.id,
    title: sf.form.title,
    schema: sf.form.schema,
    status: sf.status,
    completedAt: sf.completed_at,
  };
}

@Injectable()
export class KioskService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(createdBy: string, dto: CreateKioskSessionDto) {
    // Validate patient and forms in parallel (appointment is optional)
    const [patient, forms, appointment] = await Promise.all([
      this.prisma.baseClient.patient.findFirst({
        where: { id: dto.patientId, is_active: true },
        select: { id: true },
      }),
      this.prisma.baseClient.form.findMany({
        where: {
          id: { in: dto.formIds },
          is_kiosk_enabled: true,
          is_published: true,
        },
        select: { id: true },
      }),
      dto.appointmentId
        ? this.prisma.baseClient.appointment.findFirst({
            where: { id: dto.appointmentId, patient_id: dto.patientId },
            select: { id: true },
          })
        : Promise.resolve(undefined),
    ]);

    if (!patient) {
      throw new NotFoundException(
        t('kiosk.patient_not_found', 'Patient not found'),
      );
    }
    if (dto.appointmentId && !appointment) {
      throw new BadRequestException(
        t(
          'kiosk.appointment_not_found',
          'Appointment not found for this patient',
        ),
      );
    }
    if (forms.length !== dto.formIds.length) {
      throw new BadRequestException(
        t(
          'kiosk.forms_unavailable',
          'One or more forms are not available for kiosk use',
        ),
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresInMinutes = dto.expiresInMinutes ?? 30;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    const session = await this.prisma.transaction(async (tx) => {
      const created = await tx.kioskSession.create({
        data: {
          patient_id: dto.patientId,
          appointment_id: dto.appointmentId,
          created_by: createdBy,
          token_hash: tokenHash,
          expires_in_minutes: expiresInMinutes,
          expires_at: expiresAt,
          status: KIOSK_STATUS_ACTIVE,
        },
      });

      await tx.kioskSessionForm.createMany({
        data: dto.formIds.map((formId) => ({
          session_id: created.id,
          form_id: formId,
        })),
      });

      return created;
    });

    return {
      sessionId: session.id,
      token,
      expiresAt,
    };
  }

  async authenticate(dto: AuthenticateKioskDto) {
    const tokenHash = hashToken(dto.token);

    const session = await this.prisma.baseClient.kioskSession.findFirst({
      where: {
        token_hash: tokenHash,
        status: KIOSK_STATUS_ACTIVE,
        expires_at: { gt: new Date() },
      },
      include: {
        patient: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
        session_forms: {
          include: {
            form: {
              select: { id: true, title: true, schema: true },
            },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException(
        t('kiosk.token_invalid', 'Invalid or expired kiosk token'),
      );
    }

    return {
      sessionId: session.id,
      expiresAt: session.expires_at,
      patient: session.patient,
      forms: session.session_forms.map(mapSessionForm),
    };
  }

  async getSessionForms(sessionId: string) {
    const forms = await this.prisma.baseClient.kioskSessionForm.findMany({
      where: { session_id: sessionId },
      include: {
        form: { select: { id: true, title: true, schema: true } },
      },
    });

    return forms.map(mapSessionForm);
  }

  async closeSession(sessionId: string) {
    await this.prisma.baseClient.kioskSession.update({
      where: { id: sessionId },
      data: {
        status: KIOSK_STATUS_COMPLETED,
        closed_at: new Date(),
      },
    });

    return { message: t('kiosk.session_closed', 'Session closed') };
  }
}
