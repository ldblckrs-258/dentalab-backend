import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentEmailProducer } from './appointment-email.producer';
import { PrismaService } from '@modules/database';

const APPT_TOMORROW_1 = 'appt-tomorrow-001';
const APPT_TOMORROW_2 = 'appt-tomorrow-002';
const _APPT_TODAY = 'appt-today-001';
const _APPT_TWO_DAYS = 'appt-two-days-001';
const _APPT_CANCELLED = 'appt-cancelled-001';
const APPT_REMINDED = 'appt-already-reminded';

const mockEmailProducer = { publishReminder: jest.fn() };
const mockUpdateMany = jest.fn();
const mockFindMany = jest.fn();

const mockPrisma = {
  baseClient: {
    appointment: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
};

describe('AppointmentReminderService', () => {
  let service: AppointmentReminderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentReminderService,
        { provide: AppointmentEmailProducer, useValue: mockEmailProducer },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AppointmentReminderService>(
      AppointmentReminderService,
    );
    jest.clearAllMocks();
    mockEmailProducer.publishReminder.mockResolvedValue(undefined);
  });

  describe('sendReminders', () => {
    it('queries only tomorrow-local scheduled/confirmed appointments with null reminderSentAt', async () => {
      mockFindMany.mockResolvedValue([]);

      const now = new Date('2026-06-14T09:00:00.000Z');
      await service.sendReminders(now);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['scheduled', 'confirmed'] },
            reminderSentAt: null,
          }),
        }),
      );

      const { startTime } = mockFindMany.mock.calls[0][0].where;

      const gte = new Date(startTime.gte as string);
      const lte = new Date(startTime.lte as string);

      expect(gte.toISOString()).toBe('2026-06-14T17:00:00.000Z');
      expect(lte.toISOString()).toBe('2026-06-15T16:59:59.999Z');
    });

    it('sets reminderSentAt marker BEFORE publishing', async () => {
      mockFindMany.mockResolvedValue([{ id: APPT_TOMORROW_1 }]);
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const callOrder: string[] = [];
      mockUpdateMany.mockImplementation(() => {
        callOrder.push('updateMany');
        return { count: 1 };
      });
      mockEmailProducer.publishReminder.mockImplementation(() => {
        callOrder.push('publishReminder');
      });

      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));

      expect(callOrder[0]).toBe('updateMany');
      expect(callOrder[1]).toBe('publishReminder');
    });

    it('sends reminders for all matching appointments', async () => {
      mockFindMany.mockResolvedValue([
        { id: APPT_TOMORROW_1 },
        { id: APPT_TOMORROW_2 },
      ]);
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));

      expect(mockEmailProducer.publishReminder).toHaveBeenCalledTimes(2);
      expect(mockEmailProducer.publishReminder).toHaveBeenCalledWith(
        APPT_TOMORROW_1,
      );
      expect(mockEmailProducer.publishReminder).toHaveBeenCalledWith(
        APPT_TOMORROW_2,
      );
    });

    it('is idempotent — second run sends nothing when DB returns empty', async () => {
      mockFindMany.mockResolvedValueOnce([{ id: APPT_TOMORROW_1 }]);
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));
      expect(mockEmailProducer.publishReminder).toHaveBeenCalledTimes(1);

      mockFindMany.mockResolvedValueOnce([]);
      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));

      expect(mockEmailProducer.publishReminder).toHaveBeenCalledTimes(1);
    });

    it('skips appointment when updateMany returns count 0 (already marked)', async () => {
      mockFindMany.mockResolvedValue([{ id: APPT_REMINDED }]);
      mockUpdateMany.mockResolvedValue({ count: 0 });

      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));

      expect(mockEmailProducer.publishReminder).not.toHaveBeenCalled();
    });

    it('clears reminderSentAt and does not publish when publishReminder throws', async () => {
      mockFindMany.mockResolvedValue([{ id: APPT_TOMORROW_1 }]);
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockEmailProducer.publishReminder.mockRejectedValue(
        new Error('broker down'),
      );

      await service.sendReminders(new Date('2026-06-14T09:00:00.000Z'));

      expect(mockUpdateMany).toHaveBeenCalledTimes(2);

      const rollbackCall = mockUpdateMany.mock.calls[1];
      expect(rollbackCall[0].where.id).toBe(APPT_TOMORROW_1);
      expect(rollbackCall[0].data.reminderSentAt).toBeNull();
    });

    it('excludes today and two-days-out — only tomorrow in query result', async () => {
      mockFindMany.mockResolvedValue([]);

      const now = new Date('2026-06-14T09:00:00.000Z');
      await service.sendReminders(now);

      const { startTime } = mockFindMany.mock.calls[0][0].where;

      const gte = new Date(startTime.gte as string).getTime();
      const lte = new Date(startTime.lte as string).getTime();

      const todayMidnightVN = new Date('2026-06-14T17:00:00.000Z').getTime();
      const twoDaysMidnightVN = new Date('2026-06-15T17:00:00.000Z').getTime();

      expect(gte).toBeGreaterThanOrEqual(todayMidnightVN);
      expect(lte).toBeLessThan(twoDaysMidnightVN);
    });

    it('does not throw when findMany returns empty list', async () => {
      mockFindMany.mockResolvedValue([]);
      await expect(
        service.sendReminders(new Date('2026-06-14T09:00:00.000Z')),
      ).resolves.not.toThrow();
      expect(mockEmailProducer.publishReminder).not.toHaveBeenCalled();
    });

    it('uses UTC bounds for Asia/Ho_Chi_Minh tomorrow window (UTC+7)', async () => {
      mockFindMany.mockResolvedValue([]);

      const now = new Date('2026-06-14T00:00:00.000Z');
      await service.sendReminders(now);

      const { startTime } = mockFindMany.mock.calls[0][0].where;

      expect(new Date(startTime.gte as string).toISOString()).toBe(
        '2026-06-14T17:00:00.000Z',
      );
    });
  });
});
