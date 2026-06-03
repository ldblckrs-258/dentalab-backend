import { Test, TestingModule } from '@nestjs/testing';
import { EmailConsumerService } from './email-consumer.service';
import { EmailService } from './email.service';
import { QueueConsumerService } from '@modules/queue';
import { AppConfigService } from '@modules/config';
import { ROUTING_KEY } from '@modules/queue/queue.constants';
import { SYSTEM_TEMPLATES } from './email.constants';

const mockEmailService = {
  sendTemplatedEmail: jest.fn(),
};

const mockQueueConsumer = {
  consume: jest.fn(),
};

const mockConfig = {
  email: { FRONTEND_URL: 'http://localhost:3001' },
};

const APPT_ID = 'appt-uuid-001';
const RECIPIENT_EMAIL = 'patient@test.com';

const makeApptPayload = (
  recipientRole: 'patient' | 'provider' = 'patient',
) => ({
  appointmentId: APPT_ID,
  to: RECIPIENT_EMAIL,
  recipientRole,
  variables: {
    patientName: 'Nguyễn Văn A',
    providerName: 'BS. Trần B',
    serviceName: 'Khám tổng quát',
    appointmentDate: 'Chủ nhật, 15/06/2026',
    appointmentTime: '10:00',
    clinicName: 'DentaLab',
    referenceId: APPT_ID,
  },
  lang: 'vi',
});

describe('EmailConsumerService', () => {
  let service: EmailConsumerService;
  let messageHandler: (message: any) => Promise<void>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailConsumerService,
        { provide: EmailService, useValue: mockEmailService },
        { provide: QueueConsumerService, useValue: mockQueueConsumer },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EmailConsumerService>(EmailConsumerService);
    jest.clearAllMocks();

    mockQueueConsumer.consume.mockImplementation((_queue, handler) => {
      messageHandler = handler;
      return Promise.resolve();
    });

    await service.onModuleInit();
  });

  it('should register consumer on module init', () => {
    expect(mockQueueConsumer.consume).toHaveBeenCalledWith(
      'email.send',
      expect.any(Function),
    );
  });

  it('should dispatch reset password to correct handler', async () => {
    mockEmailService.sendTemplatedEmail.mockResolvedValue({});

    await messageHandler({
      routingKey: ROUTING_KEY.EMAIL_SEND_RESET_PASSWORD,
      messageId: 'msg-1',
      payload: {
        userId: 'user-1',
        email: 'user@test.com',
        resetToken: 'abc123',
        expiresAt: '2026-03-17T00:00:00Z',
      },
    });

    expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: SYSTEM_TEMPLATES.PASSWORD_RESET,
        to: 'user@test.com',
        idempotencyKey: 'reset-password/msg-1',
      }),
    );
  });

  it('should dispatch welcome to correct handler', async () => {
    mockEmailService.sendTemplatedEmail.mockResolvedValue({});

    await messageHandler({
      routingKey: ROUTING_KEY.EMAIL_SEND_WELCOME,
      messageId: 'msg-2',
      payload: {
        userId: 'user-2',
        email: 'new@test.com',
        fullName: 'Jane Doe',
        temporaryPassword: 'Temp@123',
      },
    });

    expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: SYSTEM_TEMPLATES.WELCOME,
        to: 'new@test.com',
        idempotencyKey: 'welcome/msg-2',
        variables: expect.objectContaining({
          email: 'new@test.com',
          temporaryPassword: 'Temp@123',
        }),
      }),
    );
  });

  describe('appointment lifecycle email cases', () => {
    beforeEach(() => {
      mockEmailService.sendTemplatedEmail.mockResolvedValue({});
    });

    it('APPT_CREATED → appointment-created template with appointment entityType', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
        messageId: 'msg-created',
        payload: makeApptPayload('patient'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: SYSTEM_TEMPLATES.APPT_CREATED,
          to: RECIPIENT_EMAIL,
          entityType: 'appointment',
          entityId: APPT_ID,
          idempotencyKey: `${SYSTEM_TEMPLATES.APPT_CREATED}/${APPT_ID}/patient`,
        }),
      );
    });

    it('APPT_CONFIRMED → appointment-confirmed template', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CONFIRMED,
        messageId: 'msg-confirmed',
        payload: makeApptPayload('patient'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: SYSTEM_TEMPLATES.APPT_CONFIRMED,
          entityType: 'appointment',
          idempotencyKey: `${SYSTEM_TEMPLATES.APPT_CONFIRMED}/${APPT_ID}/patient`,
        }),
      );
    });

    it('APPT_COMPLETED → appointment-completed template', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_COMPLETED,
        messageId: 'msg-completed',
        payload: makeApptPayload('provider'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: SYSTEM_TEMPLATES.APPT_COMPLETED,
          entityType: 'appointment',
          idempotencyKey: `${SYSTEM_TEMPLATES.APPT_COMPLETED}/${APPT_ID}/provider`,
        }),
      );
    });

    it('APPT_CANCELLED → appointment-cancelled template', async () => {
      const payload = {
        ...makeApptPayload('patient'),
        variables: {
          ...makeApptPayload('patient').variables,
          cancellationReason: 'Patient request',
        },
      };

      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CANCELLED,
        messageId: 'msg-cancelled',
        payload,
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: SYSTEM_TEMPLATES.APPT_CANCELLED,
          entityType: 'appointment',
          variables: expect.objectContaining({
            cancellationReason: 'Patient request',
          }),
        }),
      );
    });

    it('EMAIL_SEND_REMINDER → appointment-reminder template', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_REMINDER,
        messageId: 'msg-reminder',
        payload: makeApptPayload('patient'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: SYSTEM_TEMPLATES.REMINDER,
          entityType: 'appointment',
          idempotencyKey: `${SYSTEM_TEMPLATES.REMINDER}/${APPT_ID}/patient`,
        }),
      );
    });

    it('sets isUser=true in variables when recipientRole is provider', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
        messageId: 'msg-provider',
        payload: makeApptPayload('provider'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({ isUser: true }),
        }),
      );
    });

    it('sets isUser=false in variables when recipientRole is patient', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
        messageId: 'msg-patient',
        payload: makeApptPayload('patient'),
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({ isUser: false }),
        }),
      );
    });

    it('passes lang from payload to sendTemplatedEmail', async () => {
      await messageHandler({
        routingKey: ROUTING_KEY.EMAIL_SEND_APPT_CREATED,
        messageId: 'msg-lang',
        payload: { ...makeApptPayload('patient'), lang: 'en' },
      });

      expect(mockEmailService.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ lang: 'en' }),
      );
    });
  });

  it('should log warning for unknown routing key', async () => {
    const loggerSpy = jest.spyOn((service as any).logger, 'warn');

    await messageHandler({
      routingKey: 'email.unknown_type',
      messageId: 'msg-3',
      payload: {},
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown email routing key'),
    );
    expect(mockEmailService.sendTemplatedEmail).not.toHaveBeenCalled();
  });
});
