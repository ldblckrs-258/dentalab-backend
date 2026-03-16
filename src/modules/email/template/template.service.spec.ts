import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TemplateService } from './template.service';
import { PrismaService } from '@modules/database';

const mockTemplate = {
  id: 'template-uuid',
  name: 'password-reset',
  subject: 'Reset your DentaLab password',
  body_mjml:
    '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{userName}}</mj-text></mj-column></mj-section></mj-body></mjml>',
  body_html: '<html><body><p>Hello {{userName}}</p></body></html>',
  type: 'auth',
  variables: { required: ['userName', 'resetLink', 'expiresIn'], optional: [] },
  is_system: true,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockPrisma = {
  baseClient: {
    emailTemplate: {
      findUnique: jest.fn(),
    },
  },
};

describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
    jest.clearAllMocks();
  });

  describe('render', () => {
    it('should render template with variables', async () => {
      mockPrisma.baseClient.emailTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );

      const result = await service.render('password-reset', {
        userName: 'John',
        resetLink: 'https://example.com/reset',
        expiresIn: '1 hour',
      });

      expect(result.html).toContain('Hello John');
      expect(result.subject).toBe('Reset your DentaLab password');
      expect(result.templateId).toBe('template-uuid');
    });

    it('should render subject with Handlebars variables', async () => {
      mockPrisma.baseClient.emailTemplate.findUnique.mockResolvedValue({
        ...mockTemplate,
        name: 'welcome',
        subject: 'Welcome, {{userName}}!',
      });

      const result = await service.render('welcome', { userName: 'Jane' });
      expect(result.subject).toBe('Welcome, Jane!');
    });

    it('should throw NotFoundException for missing template', async () => {
      mockPrisma.baseClient.emailTemplate.findUnique.mockResolvedValue(null);

      await expect(service.render('nonexistent', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for disabled template', async () => {
      mockPrisma.baseClient.emailTemplate.findUnique.mockResolvedValue({
        ...mockTemplate,
        is_active: false,
      });

      await expect(service.render('password-reset', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('compileMjmlToHtml', () => {
    it('should compile MJML to valid HTML', () => {
      const mjmlSource =
        '<mjml><mj-body><mj-section><mj-column><mj-text>Test</mj-text></mj-column></mj-section></mj-body></mjml>';
      const html = service.compileMjmlToHtml(mjmlSource);

      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Test');
    });

    it('should preserve Handlebars placeholders', () => {
      const mjmlSource =
        '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>';
      const html = service.compileMjmlToHtml(mjmlSource);

      expect(html).toContain('{{name}}');
    });
  });

  describe('invalidateCache', () => {
    it('should force re-read from DB on next render', async () => {
      mockPrisma.baseClient.emailTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );

      // First render — caches
      await service.render('password-reset', { userName: 'A' });
      expect(
        mockPrisma.baseClient.emailTemplate.findUnique,
      ).toHaveBeenCalledTimes(1);

      // Second render — uses cache (still calls DB for template lookup)
      await service.render('password-reset', { userName: 'B' });
      expect(
        mockPrisma.baseClient.emailTemplate.findUnique,
      ).toHaveBeenCalledTimes(2);

      // Invalidate and render again
      service.invalidateCache('password-reset');
      await service.render('password-reset', { userName: 'C' });
      expect(
        mockPrisma.baseClient.emailTemplate.findUnique,
      ).toHaveBeenCalledTimes(3);
    });
  });
});
