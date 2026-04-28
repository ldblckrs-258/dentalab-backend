import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';
import { TemplateService } from './template/template.service';
import { EMAIL_PROVIDER } from './email.constants';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { S3_CLIENT } from '@modules/storage/storage.constants';
import { mockI18nContext } from '@common/test/i18n-mock';

const mockProvider = {
  send: jest.fn(),
  sendBatch: jest.fn(),
};

const mockTemplateService = {
  render: jest.fn(),
};

const mockPrisma = {
  baseClient: {
    emailLog: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  },
};

const mockConfig = {
  email: {
    EMAIL_FROM_ADDRESS: 'test@dentalab.com',
    EMAIL_FROM_NAME: 'DentaLab',
  },
  storage: { S3_BUCKET: 'test-bucket' },
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    mockI18nContext();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: EMAIL_PROVIDER, useValue: mockProvider },
        { provide: TemplateService, useValue: mockTemplateService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: S3_CLIENT, useValue: {} },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  describe('sendTemplatedEmail', () => {
    it('should create log, send, and update log on success', async () => {
      mockTemplateService.render.mockReturnValue({
        html: '<p>Hello</p>',
        subject: 'Test Subject',
      });
      mockPrisma.baseClient.emailLog.create.mockResolvedValue({
        id: 'log-1',
      });
      mockProvider.send.mockResolvedValue({ id: 'resend-1' });
      mockPrisma.baseClient.emailLog.update.mockResolvedValue({
        id: 'log-1',
        status: 'sent',
      });

      const result = await service.sendTemplatedEmail({
        to: 'user@test.com',
        templateName: 'welcome',
        variables: { userName: 'John' },
      });

      expect(mockPrisma.baseClient.emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateName: 'welcome',
            status: 'pending',
          }),
        }),
      );
      expect(mockProvider.send).toHaveBeenCalled();
      expect(mockPrisma.baseClient.emailLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resendId: 'resend-1',
            status: 'sent',
          }),
        }),
      );
      expect(result.status).toBe('sent');
    });

    it('should update log with error and re-throw on failure', async () => {
      mockTemplateService.render.mockReturnValue({
        html: '<p>Hello</p>',
        subject: 'Test',
      });
      mockPrisma.baseClient.emailLog.create.mockResolvedValue({
        id: 'log-1',
      });
      mockProvider.send.mockRejectedValue(new Error('API error'));
      mockPrisma.baseClient.emailLog.update.mockResolvedValue({});

      await expect(
        service.sendTemplatedEmail({
          to: 'user@test.com',
          templateName: 'welcome',
          variables: {},
        }),
      ).rejects.toThrow('API error');

      expect(mockPrisma.baseClient.emailLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'API error',
          }),
        }),
      );
    });
  });

  describe('resendEmail', () => {
    it('should resend a failed email', async () => {
      mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue({
        id: 'log-1',
        recipientEmail: 'user@test.com',
        status: 'failed',
        variables: { userName: 'John' },
        entityType: 'user',
        entityId: 'user-1',
        templateName: 'welcome',
      });
      mockTemplateService.render.mockReturnValue({
        html: '<p>Hello</p>',
        subject: 'Test',
      });
      mockPrisma.baseClient.emailLog.create.mockResolvedValue({
        id: 'log-2',
      });
      mockProvider.send.mockResolvedValue({ id: 'resend-2' });
      mockPrisma.baseClient.emailLog.update.mockResolvedValue({
        id: 'log-2',
        status: 'sent',
      });

      await service.resendEmail('log-1');
      expect(mockTemplateService.render).toHaveBeenCalledWith(
        'welcome',
        { userName: 'John' },
        'vi',
      );
    });

    it('should throw for non-failed emails', async () => {
      mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue({
        id: 'log-1',
        status: 'delivered',
        templateName: 'welcome',
      });

      await expect(service.resendEmail('log-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for missing log', async () => {
      mockPrisma.baseClient.emailLog.findUnique.mockResolvedValue(null);

      await expect(service.resendEmail('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats', async () => {
      mockPrisma.baseClient.emailLog.groupBy.mockResolvedValue([
        { status: 'sent', _count: 10 },
        { status: 'delivered', _count: 8 },
        { status: 'failed', _count: 2 },
      ]);

      const stats = await service.getStats();

      expect(stats.total).toBe(20);
      expect(stats.sent).toBe(10);
      expect(stats.delivered).toBe(8);
      expect(stats.failed).toBe(2);
      expect(stats.pending).toBe(0);
    });
  });
});
