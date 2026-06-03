import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentEmailProducer } from './appointment-email.producer';
import { QueueProducerService } from '@modules/queue';
import { PrismaService } from '@modules/database';
import { ROUTING_KEY } from '@modules/queue/queue.constants';

const APPT_ID = 'appt-uuid-001';
const PATIENT_EMAIL = 'patient@test.com';
const PROVIDER_EMAIL = 'provider@test.com';

const mockAppointment = {
  id: APPT_ID,
  startTime: new Date('2026-06-15T03:00:00.000Z'),
  patient: {
    id: 'patient-001',
    firstName: 'A',
    lastName: 'Nguyễn Văn',
    email: PATIENT_EMAIL,
  },
  provider: {
    id: 'provider-001',
    user: {
      id: 'user-001',
      fullName: 'BS. Trần B',
      email: PROVIDER_EMAIL,
      preferredLanguage: 'vi',
    },
  },
  appointmentType: { id: 'type-001', name: 'Khám tổng quát' },
};

const mockQueue = { publish: jest.fn().mockReturnValue(true) };
const mockPrisma = {
  baseClient: {
    appointment: {
      findUnique: jest.fn(),
    },
  },
};

describe('AppointmentEmailProducer', () => {
  let producer: AppointmentEmailProducer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentEmailProducer,
        { provide: QueueProducerService, useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    producer = module.get<AppointmentEmailProducer>(AppointmentEmailProducer);
    jest.clearAllMocks();
    mockQueue.publish.mockReturnValue(true);
    mockPrisma.baseClient.appointment.findUnique.mockResolvedValue(
      mockAppointment,
    );
  });

  describe('publishCreated', () => {
    it('publishes APPT_CREATED to both patient and provider', async () => {
      await producer.publishCreated(APPT_ID);

      const calls = mockQueue.publish.mock.calls;
      expect(calls).toHaveLength(2);

      const patientCall = calls.find(
        ([, payload]) => payload.recipientRole === 'patient',
      );
      const providerCall = calls.find(
        ([, payload]) => payload.recipientRole === 'provider',
      );

      expect(patientCall![0]).toBe(ROUTING_KEY.EMAIL_SEND_APPT_CREATED);
      expect(patientCall![1].to).toBe(PATIENT_EMAIL);
      expect(patientCall![1].appointmentId).toBe(APPT_ID);

      expect(providerCall![0]).toBe(ROUTING_KEY.EMAIL_SEND_APPT_CREATED);
      expect(providerCall![1].to).toBe(PROVIDER_EMAIL);
      expect(providerCall![1].recipientRole).toBe('provider');
    });

    it('skips patient and only sends to provider when patient email is null', async () => {
      mockPrisma.baseClient.appointment.findUnique.mockResolvedValue({
        ...mockAppointment,
        patient: { ...mockAppointment.patient, email: null },
      });

      await producer.publishCreated(APPT_ID);

      expect(mockQueue.publish).toHaveBeenCalledTimes(1);
      expect(mockQueue.publish.mock.calls[0][1].recipientRole).toBe('provider');
    });

    it('formats date in Asia/Ho_Chi_Minh timezone, not UTC', async () => {
      await producer.publishCreated(APPT_ID);

      const patientCall = mockQueue.publish.mock.calls.find(
        ([, p]) => p.recipientRole === 'patient',
      );
      const vars = patientCall![1].variables;

      expect(vars.appointmentDate).toContain('15/06/2026');
      expect(vars.appointmentTime).toBe('10:00');
    });

    it('includes all required base variables', async () => {
      await producer.publishCreated(APPT_ID);

      const patientCall = mockQueue.publish.mock.calls.find(
        ([, p]) => p.recipientRole === 'patient',
      );
      const vars = patientCall![1].variables;

      expect(vars.patientName).toBe('Nguyễn Văn A');
      expect(vars.providerName).toBe('BS. Trần B');
      expect(vars.serviceName).toBe('Khám tổng quát');
      expect(vars.clinicName).toBe('DentaLab');
      expect(vars.referenceId).toBe(APPT_ID);
    });
  });

  describe('publishConfirmed', () => {
    it('publishes APPT_CONFIRMED to patient only', async () => {
      await producer.publishConfirmed(APPT_ID);

      expect(mockQueue.publish).toHaveBeenCalledTimes(1);
      expect(mockQueue.publish).toHaveBeenCalledWith(
        ROUTING_KEY.EMAIL_SEND_APPT_CONFIRMED,
        expect.objectContaining({
          to: PATIENT_EMAIL,
          recipientRole: 'patient',
          appointmentId: APPT_ID,
        }),
      );
    });

    it('does not send to provider', async () => {
      await producer.publishConfirmed(APPT_ID);

      const providerCall = mockQueue.publish.mock.calls.find(
        ([, p]) => p.recipientRole === 'provider',
      );
      expect(providerCall).toBeUndefined();
    });
  });

  describe('publishCompleted', () => {
    it('publishes APPT_COMPLETED to both patient and provider', async () => {
      await producer.publishCompleted(APPT_ID);

      const keys = mockQueue.publish.mock.calls.map(([key]) => key);
      expect(keys).toHaveLength(2);
      expect(
        keys.every((k) => k === ROUTING_KEY.EMAIL_SEND_APPT_COMPLETED),
      ).toBe(true);

      const roles = mockQueue.publish.mock.calls.map(
        ([, p]) => p.recipientRole,
      );
      expect(roles).toContain('patient');
      expect(roles).toContain('provider');
    });
  });

  describe('publishCancelled', () => {
    it('publishes APPT_CANCELLED to both patient and provider', async () => {
      await producer.publishCancelled(APPT_ID, 'Patient request');

      expect(mockQueue.publish).toHaveBeenCalledTimes(2);
      const keys = mockQueue.publish.mock.calls.map(([k]) => k);
      expect(
        keys.every((k) => k === ROUTING_KEY.EMAIL_SEND_APPT_CANCELLED),
      ).toBe(true);
    });

    it('includes cancellationReason in variables', async () => {
      await producer.publishCancelled(APPT_ID, 'Patient request');

      mockQueue.publish.mock.calls.forEach(([, p]) => {
        expect(p.variables.cancellationReason).toBe('Patient request');
      });
    });

    it('uses empty string when reason is null', async () => {
      await producer.publishCancelled(APPT_ID, null);

      mockQueue.publish.mock.calls.forEach(([, p]) => {
        expect(p.variables.cancellationReason).toBe('');
      });
    });

    it('skips patient send when patient email is null but sends to provider', async () => {
      mockPrisma.baseClient.appointment.findUnique.mockResolvedValue({
        ...mockAppointment,
        patient: { ...mockAppointment.patient, email: null },
      });

      await producer.publishCancelled(APPT_ID, 'reason');

      expect(mockQueue.publish).toHaveBeenCalledTimes(1);
      expect(mockQueue.publish.mock.calls[0][1].recipientRole).toBe('provider');
    });
  });

  describe('publishReminder', () => {
    it('publishes EMAIL_SEND_REMINDER to both patient and provider', async () => {
      await producer.publishReminder(APPT_ID);

      expect(mockQueue.publish).toHaveBeenCalledTimes(2);
      const keys = mockQueue.publish.mock.calls.map(([k]) => k);
      expect(keys.every((k) => k === ROUTING_KEY.EMAIL_SEND_REMINDER)).toBe(
        true,
      );

      const roles = mockQueue.publish.mock.calls.map(
        ([, p]) => p.recipientRole,
      );
      expect(roles).toContain('patient');
      expect(roles).toContain('provider');
    });
  });

  describe('edge cases', () => {
    it('does nothing when appointment not found', async () => {
      mockPrisma.baseClient.appointment.findUnique.mockResolvedValue(null);

      await producer.publishCreated(APPT_ID);

      expect(mockQueue.publish).not.toHaveBeenCalled();
    });

    it('uses provider preferredLanguage for provider payload lang', async () => {
      mockPrisma.baseClient.appointment.findUnique.mockResolvedValue({
        ...mockAppointment,
        provider: {
          ...mockAppointment.provider,
          user: { ...mockAppointment.provider.user, preferredLanguage: 'en' },
        },
      });

      await producer.publishCreated(APPT_ID);

      const providerCall = mockQueue.publish.mock.calls.find(
        ([, p]) => p.recipientRole === 'provider',
      );
      expect(providerCall![1].lang).toBe('en');

      const patientCall = mockQueue.publish.mock.calls.find(
        ([, p]) => p.recipientRole === 'patient',
      );
      expect(patientCall![1].lang).toBe('vi');
    });
  });
});
