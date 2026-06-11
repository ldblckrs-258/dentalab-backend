import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EmailWebhookController } from './email-webhook.controller';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';

jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({
    verify: jest.fn(),
  })),
}));

const mockPrisma = {
  baseClient: {
    emailLog: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
};

const mockConfig = {
  email: { RESEND_WEBHOOK_SECRET: 'whsec_test' },
};

describe('EmailWebhookController', () => {
  let controller: EmailWebhookController;
  let webhookInstance: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailWebhookController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    controller = module.get<EmailWebhookController>(EmailWebhookController);
    webhookInstance = (controller as any).wh;
    jest.clearAllMocks();
  });

  const makeEvent = (type: string, emailId: string) =>
    JSON.stringify({
      type,
      data: { email_id: emailId },
    });

  const defaultHeaders = {
    'svix-id': 'msg_123',
    'svix-timestamp': '1234567890',
    'svix-signature': 'v1,signature',
  };

  it('should process email.delivered event', async () => {
    webhookInstance.verify.mockReturnValue(undefined);
    mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue({
      id: 'log-1',
      status: 'sent',
      webhookEvents: [],
    });
    mockPrisma.baseClient.emailLog.update.mockResolvedValue({});

    const body = Buffer.from(makeEvent('email.delivered', 'resend-1'));
    const result = await controller.handleResendWebhook(body, defaultHeaders);

    expect(result).toEqual({ received: true });
    expect(mockPrisma.baseClient.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'delivered',
          deliveredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should process email.bounced event', async () => {
    webhookInstance.verify.mockReturnValue(undefined);
    mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue({
      id: 'log-1',
      status: 'sent',
      webhookEvents: [],
    });
    mockPrisma.baseClient.emailLog.update.mockResolvedValue({});

    const body = Buffer.from(
      JSON.stringify({
        type: 'email.bounced',
        data: { email_id: 'resend-1', bounce: { message: 'Mailbox full' } },
      }),
    );

    await controller.handleResendWebhook(body, defaultHeaders);

    expect(mockPrisma.baseClient.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'bounced',
          bouncedAt: expect.any(Date),
          errorMessage: 'Mailbox full',
        }),
      }),
    );
  });

  it('should throw ForbiddenException for invalid signature', async () => {
    webhookInstance.verify.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const body = Buffer.from(makeEvent('email.delivered', 'resend-1'));

    await expect(
      controller.handleResendWebhook(body, defaultHeaders),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should return 200 for unknown resend_id', async () => {
    webhookInstance.verify.mockReturnValue(undefined);
    mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue(null);

    const body = Buffer.from(makeEvent('email.delivered', 'unknown-id'));
    const result = await controller.handleResendWebhook(body, defaultHeaders);

    expect(result).toEqual({ received: true });
    expect(mockPrisma.baseClient.emailLog.update).not.toHaveBeenCalled();
  });

  // Regression: prod 500 — @RawBody() was undefined (custom express.json
  // stripped req.rawBody) → rawBody.toString() threw → Resend retried the 5xx.
  it('returns 200 (no crash) when rawBody is undefined', async () => {
    const result = await controller.handleResendWebhook(
      undefined as unknown as Buffer,
      defaultHeaders,
    );

    expect(result).toEqual({ received: true });
    expect(webhookInstance.verify).not.toHaveBeenCalled();
    expect(mockPrisma.baseClient.emailLog.findUnique).not.toHaveBeenCalled();
  });

  it('returns 200 for an empty body', async () => {
    const result = await controller.handleResendWebhook(
      Buffer.from(''),
      defaultHeaders,
    );

    expect(result).toEqual({ received: true });
    expect(mockPrisma.baseClient.emailLog.findUnique).not.toHaveBeenCalled();
  });

  it('returns 200 for invalid JSON', async () => {
    webhookInstance.verify.mockReturnValue(undefined);

    const result = await controller.handleResendWebhook(
      Buffer.from('not-json{'),
      defaultHeaders,
    );

    expect(result).toEqual({ received: true });
    expect(mockPrisma.baseClient.emailLog.findUnique).not.toHaveBeenCalled();
  });

  it('returns 200 when payload has no email_id', async () => {
    webhookInstance.verify.mockReturnValue(undefined);

    const body = Buffer.from(JSON.stringify({ type: 'email.sent', data: {} }));
    const result = await controller.handleResendWebhook(body, defaultHeaders);

    expect(result).toEqual({ received: true });
    expect(mockPrisma.baseClient.emailLog.findUnique).not.toHaveBeenCalled();
  });

  it('handles email.delivery_delayed without status change', async () => {
    webhookInstance.verify.mockReturnValue(undefined);
    mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue({
      id: 'log-1',
      status: 'sent',
      webhookEvents: [],
    });
    mockPrisma.baseClient.emailLog.update.mockResolvedValue({});

    const body = Buffer.from(makeEvent('email.delivery_delayed', 'resend-1'));
    const result = await controller.handleResendWebhook(body, defaultHeaders);

    expect(result).toEqual({ received: true });
    // Unrecognized event type: only the raw event is appended, no status flip.
    const updateArg = mockPrisma.baseClient.emailLog.update.mock.calls[0][0];
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.webhookEvents).toHaveLength(1);
  });
});
