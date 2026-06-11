import { Test, TestingModule } from '@nestjs/testing';
import { ResendProvider } from './resend.provider';
import { AppConfigService } from '@modules/config';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn(),
    },
    batch: {
      send: jest.fn(),
    },
  })),
}));

const mockConfig = {
  email: {
    RESEND_API_KEY: 're_test_key',
    EMAIL_ENABLED: true,
    EMAIL_FROM_ADDRESS: 'test@dentalab.com',
    EMAIL_FROM_NAME: 'DentaLab',
  },
};

describe('ResendProvider', () => {
  let provider: ResendProvider;
  let resendInstance: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendProvider,
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    provider = module.get<ResendProvider>(ResendProvider);
    // Access the mocked Resend instance
    resendInstance = (provider as any).resend;
    jest.clearAllMocks();
  });

  describe('send', () => {
    it('should send email and return id', async () => {
      resendInstance.emails.send.mockResolvedValue({
        data: { id: 'email-123' },
        error: null,
      });

      const result = await provider.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result.id).toBe('email-123');
      expect(resendInstance.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'DentaLab <test@dentalab.com>',
          to: ['user@example.com'],
          subject: 'Test',
          html: '<p>Test</p>',
        }),
        undefined,
      );
    });

    it('should throw on Resend error', async () => {
      resendInstance.emails.send.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key' },
      });

      await expect(
        provider.send({ to: 'a@b.com', subject: 'T', html: '' }),
      ).rejects.toThrow('Email send failed: Invalid API key');
    });

    it('should pass idempotency key when provided', async () => {
      resendInstance.emails.send.mockResolvedValue({
        data: { id: 'email-456' },
        error: null,
      });

      await provider.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        idempotencyKey: 'reset/user-123',
      });

      expect(resendInstance.emails.send).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'reset/user-123' },
      );
    });
  });

  describe('when EMAIL_ENABLED is false', () => {
    let disabledProvider: ResendProvider;
    let disabledResend: any;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResendProvider,
          {
            provide: AppConfigService,
            useValue: { email: { ...mockConfig.email, EMAIL_ENABLED: false } },
          },
        ],
      }).compile();
      disabledProvider = module.get<ResendProvider>(ResendProvider);
      disabledResend = (disabledProvider as any).resend;
    });

    it('skips the Resend API and returns a stub id', async () => {
      const result = await disabledProvider.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(disabledResend.emails.send).not.toHaveBeenCalled();
      expect(result.id).toMatch(/^disabled-/);
    });

    it('skips the Resend API for batch sends', async () => {
      const result = await disabledProvider.sendBatch([
        { to: 'a@b.com', subject: 'A', html: '<p>A</p>' },
        { to: 'c@d.com', subject: 'B', html: '<p>B</p>' },
      ]);

      expect(disabledResend.batch.send).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(2);
      expect(result.results[0].id).toMatch(/^disabled-/);
    });
  });

  describe('sendBatch', () => {
    it('should send batch and return results', async () => {
      resendInstance.batch.send.mockResolvedValue({
        data: { data: [{ id: 'b1' }, { id: 'b2' }] },
        error: null,
      });

      const result = await provider.sendBatch([
        { to: 'a@b.com', subject: 'A', html: '<p>A</p>' },
        { to: 'c@d.com', subject: 'B', html: '<p>B</p>' },
      ]);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].id).toBe('b1');
    });

    it('should throw on batch error', async () => {
      resendInstance.batch.send.mockResolvedValue({
        data: null,
        error: { message: 'Rate limited' },
      });

      await expect(
        provider.sendBatch([{ to: 'a@b.com', subject: 'T', html: '' }]),
      ).rejects.toThrow('Batch send failed: Rate limited');
    });
  });
});
