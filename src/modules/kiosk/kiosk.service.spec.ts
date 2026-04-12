import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { KioskService } from './kiosk.service';
import { PrismaService } from '@modules/database';
import { KIOSK_STATUS_COMPLETED, KIOSK_STATUS_CLOSED } from '@common/constants';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('KioskService', () => {
  let service: KioskService;
  let prisma: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        patient: { findFirst: jest.fn() },
        appointment: { findFirst: jest.fn() },
        form: { findMany: jest.fn() },
        kioskSession: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        kioskSessionForm: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      transaction: jest.fn((fn: (tx: any) => unknown) =>
        fn({
          kioskSession: {
            create: jest.fn().mockResolvedValue({
              id: 'session-1',
              token_hash: 'hash',
              expires_at: new Date(Date.now() + 1800000),
            }),
          },
          kioskSessionForm: {
            createMany: jest.fn().mockResolvedValue({}),
          },
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [KioskService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(KioskService);
  });

  describe('createSession', () => {
    it('should throw NotFoundException for inactive patient', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.createSession('admin-1', {
          patientId: 'missing',
          formIds: ['f1'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if form is not kiosk-enabled', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.baseClient.form.findMany.mockResolvedValue([]); // no valid forms

      await expect(
        service.createSession('admin-1', {
          patientId: 'p1',
          formIds: ['f1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create session and return raw token', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.baseClient.form.findMany.mockResolvedValue([{ id: 'f1' }]);

      const result = await service.createSession('admin-1', {
        patientId: 'p1',
        formIds: ['f1'],
        expiresInMinutes: 30,
      });

      expect(result.sessionId).toBe('session-1');
      expect(result.token).toBeDefined();
      expect(result.token.length).toBe(64); // 32 bytes hex
      expect(result.expiresAt).toBeDefined();
      expect(prisma.transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid appointment', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.baseClient.appointment.findFirst.mockResolvedValue(null);

      await expect(
        service.createSession('admin-1', {
          patientId: 'p1',
          appointmentId: 'bad-appt',
          formIds: ['f1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('authenticate', () => {
    it('should throw UnauthorizedException for expired/missing session', async () => {
      prisma.baseClient.kioskSession.findFirst.mockResolvedValue(null);

      await expect(
        service.authenticate({ token: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return patient and forms for valid token', async () => {
      prisma.baseClient.kioskSession.findFirst.mockResolvedValue({
        id: 'session-1',
        expires_at: new Date(Date.now() + 1800000),
        patient: { id: 'p1', first_name: 'John', last_name: 'Doe' },
        session_forms: [
          {
            form: { id: 'f1', title: 'Intake Form', schema: {} },
            status: 'pending',
            completed_at: null,
          },
        ],
      });

      const result = await service.authenticate({ token: 'valid-token' });

      expect(result.sessionId).toBe('session-1');
      expect(result.patient.first_name).toBe('John');
      expect(result.forms).toHaveLength(1);
      expect(result.forms[0].title).toBe('Intake Form');
    });
  });

  describe('closeSession', () => {
    it('should close the session without staff user', async () => {
      prisma.baseClient.kioskSession.update.mockResolvedValue({});

      const result = await service.closeSession('session-1');
      expect(result.message).toBe('kiosk.session_closed');
      expect(prisma.baseClient.kioskSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          status: KIOSK_STATUS_COMPLETED,
          closed_at: expect.any(Date),
          closed_reason: null,
        },
      });
    });

    it('should close the session with staff user and reason', async () => {
      prisma.baseClient.kioskSession.update.mockResolvedValue({});

      const result = await service.closeSession(
        'session-1',
        'staff-user-1',
        'Patient left',
      );
      expect(result.message).toBe('kiosk.session_closed');
      expect(prisma.baseClient.kioskSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          status: KIOSK_STATUS_CLOSED,
          closed_at: expect.any(Date),
          closed_reason: 'Patient left',
          closer: { connect: { id: 'staff-user-1' } },
        },
      });
    });
  });
});
