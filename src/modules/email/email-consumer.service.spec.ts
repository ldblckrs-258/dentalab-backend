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

    // Capture the message handler
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
          userName: 'Jane Doe',
          temporaryPassword: 'Temp@123',
        }),
      }),
    );
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
