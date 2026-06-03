import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '@modules/database';
import { DEFAULT_TIMEZONE } from '@common/constants/app.constants';
import { AppointmentEmailProducer } from './appointment-email.producer';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProducer: AppointmentEmailProducer,
  ) {}

  @Cron('0 18 * * *', { timeZone: DEFAULT_TIMEZONE })
  async sendReminders(now?: Date): Promise<void> {
    const ref = now ?? new Date();

    const tomorrowStart = dayjs(ref)
      .tz(DEFAULT_TIMEZONE)
      .add(1, 'day')
      .startOf('day')
      .toDate();

    const tomorrowEnd = dayjs(ref)
      .tz(DEFAULT_TIMEZONE)
      .add(1, 'day')
      .endOf('day')
      .toDate();

    const appointments = await this.prisma.baseClient.appointment.findMany({
      where: {
        startTime: { gte: tomorrowStart, lte: tomorrowEnd },
        status: { in: ['scheduled', 'confirmed'] },
        reminderSentAt: null,
      },
      select: { id: true },
    });

    this.logger.log(
      `Reminder cron: found ${appointments.length} appointment(s) to remind`,
    );

    for (const { id } of appointments) {
      await this.processReminder(id);
    }
  }

  private async processReminder(appointmentId: string): Promise<void> {
    const updated = await this.prisma.baseClient.appointment.updateMany({
      where: { id: appointmentId, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });

    if (updated.count === 0) {
      this.logger.log(
        `Reminder already sent for appointment ${appointmentId}, skipping`,
      );
      return;
    }

    const ok = await this.tryPublish(appointmentId);

    if (!ok) {
      await this.prisma.baseClient.appointment.updateMany({
        where: { id: appointmentId },
        data: { reminderSentAt: null },
      });
      this.logger.warn(
        `Publish failed for appointment ${appointmentId}, marker cleared for retry`,
      );
    }
  }

  private async tryPublish(appointmentId: string): Promise<boolean> {
    try {
      await this.emailProducer.publishReminder(appointmentId);
      return true;
    } catch {
      return false;
    }
  }
}
