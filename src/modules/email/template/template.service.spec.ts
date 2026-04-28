import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TemplateService } from './template.service';
import { I18nService } from 'nestjs-i18n';
import * as fs from 'fs';

jest.mock('fs');
jest.mock('mjml', () => {
  const fn = jest.fn(() => ({
    html: '<html><body>{{userName}}</body></html>',
    errors: [],
  }));
  return { __esModule: true, default: fn };
});

const mockI18n = {
  translate: jest.fn(),
};

describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: I18nService, useValue: mockI18n },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
    jest.clearAllMocks();
  });

  describe('render', () => {
    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        '<mjml>{{{content}}}</mjml>',
      );
      mockI18n.translate.mockReturnValue('Reset your DentaLab password');
    });

    it('should return html and subject with variables interpolated', () => {
      const result = service.render(
        'password-reset',
        { userName: 'John' },
        'en',
      );

      expect(result.html).toContain('John');
      expect(result.subject).toBe('Reset your DentaLab password');
    });

    it('should use default lang vi when lang not specified', () => {
      service.render('password-reset', { userName: 'John' });

      expect(mockI18n.translate).toHaveBeenCalledWith(
        'email.templates.password-reset.subject',
        expect.objectContaining({ lang: 'vi' }),
      );
    });

    it('should cache compiled template on second render', () => {
      service.render('password-reset', { userName: 'A' }, 'en');
      service.render('password-reset', { userName: 'B' }, 'en');

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    });

    it('should fall back to vi when lang file missing', () => {
      (fs.existsSync as jest.Mock).mockImplementation(
        (p: string) => !p.includes('.fr.mjml'),
      );

      service.render('password-reset', { userName: 'Jean' }, 'fr');

      expect(mockI18n.translate).toHaveBeenCalledWith(
        'email.templates.password-reset.subject',
        expect.objectContaining({ lang: 'vi' }),
      );
    });

    it('should throw NotFoundException when both lang and fallback file missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => service.render('nonexistent', {}, 'en')).toThrow(
        NotFoundException,
      );
    });

    it('should reject unsafe template names', () => {
      expect(() => service.render('../../etc/passwd', {}, 'vi')).toThrow(
        NotFoundException,
      );
    });

    it('should normalize unsupported lang to default lang', () => {
      service.render('password-reset', { userName: 'X' }, 'fr');

      expect(mockI18n.translate).toHaveBeenCalledWith(
        'email.templates.password-reset.subject',
        expect.objectContaining({ lang: 'vi' }),
      );
    });
  });

  describe('invalidateCache', () => {
    it('should clear cache for all langs of given template name', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        '<mjml>{{{content}}}</mjml>',
      );
      mockI18n.translate.mockReturnValue('subject');

      service.render('welcome', { userName: 'A' }, 'vi');
      service.render('welcome', { userName: 'B' }, 'en');

      service.invalidateCache('welcome');

      service.render('welcome', { userName: 'C' }, 'vi');

      expect(fs.readFileSync).toHaveBeenCalledTimes(6);
    });
  });
});
