import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalNoteService } from './clinical-note.service';
import { PrismaService } from '@modules/database';
import { AuditService } from '@modules/audit';
import { RequestContextService } from '@modules/common/context/request-context';
import { mockI18nContext } from '@common/test/i18n-mock';

const CURRENT_USER_ID = 'user-1';
const PROVIDER_ID = 'provider-1';

const mockNote = {
  id: 'note-1',
  status: 'draft',
  createdBy: CURRENT_USER_ID,
  providerId: PROVIDER_ID,
  parentNoteId: null,
  deletedAt: null,
  subjective: 'Patient reports pain',
  objective: null,
  assessment: null,
  plan: null,
};

function setupMocks() {
  jest
    .spyOn(RequestContextService, 'getUserId')
    .mockReturnValue(CURRENT_USER_ID);
}

describe('ClinicalNoteService', () => {
  let service: ClinicalNoteService;
  let prisma: any;
  let auditService: any;

  beforeEach(async () => {
    mockI18nContext();
    setupMocks();

    prisma = {
      baseClient: {
        clinicalNote: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
        },
        provider: {
          findUnique: jest.fn().mockResolvedValue({ id: PROVIDER_ID }),
        },
        patient: {
          findFirst: jest.fn().mockResolvedValue({ id: 'patient-1' }),
        },
        appointment: {
          findUnique: jest.fn().mockResolvedValue({ patientId: 'patient-1' }),
        },
      },
    };

    auditService = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ClinicalNoteService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ClinicalNoteService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('creates a draft note and emits audit event', async () => {
      prisma.baseClient.clinicalNote.create.mockResolvedValue(mockNote);

      const result = await service.create({
        patientId: 'patient-1',
        subjective: 'Pain',
      });

      expect(result.status).toBe('draft');
      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CLINICAL_NOTE_CREATED' }),
      );
    });

    it('blocks create when user has no provider record', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue(null);

      await expect(service.create({ patientId: 'patient-1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks create when patient does not exist or is deleted', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ patientId: 'unknown-patient' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks create when appointmentId does not belong to patient', async () => {
      prisma.baseClient.appointment.findUnique.mockResolvedValue({
        patientId: 'other-patient',
      });

      await expect(
        service.create({
          patientId: 'patient-1',
          appointmentId: 'appt-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates note without appointmentId when not provided', async () => {
      prisma.baseClient.clinicalNote.create.mockResolvedValue(mockNote);

      await service.create({ patientId: 'patient-1' });

      expect(prisma.baseClient.appointment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a draft note and emits field-diff audit event', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(mockNote);
      const updated = { ...mockNote, subjective: 'Updated pain' };
      prisma.baseClient.clinicalNote.update.mockResolvedValue(updated);

      const result = await service.update('note-1', {
        subjective: 'Updated pain',
      });

      expect(result.subjective).toBe('Updated pain');
      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CLINICAL_NOTE_UPDATED',
          before: expect.any(Object),
          after: expect.any(Object),
        }),
      );
    });

    it('blocks update on signed note with CLINICAL_NOTE_EDIT_LOCKED', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        status: 'signed',
      });

      await expect(
        service.update('note-1', { subjective: 'New' }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks update when current user is not the creator', async () => {
      jest
        .spyOn(RequestContextService, 'getUserId')
        .mockReturnValue('other-user');
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        createdBy: CURRENT_USER_ID,
      });

      await expect(
        service.update('note-1', { subjective: 'New' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when note not found', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { subjective: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sign', () => {
    it('signs a draft note and emits audit event', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(mockNote);
      const signed = { ...mockNote, status: 'signed', signedAt: new Date() };
      prisma.baseClient.clinicalNote.update.mockResolvedValue(signed);

      const result = await service.sign('note-1');

      expect(result.status).toBe('signed');
      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CLINICAL_NOTE_SIGNED' }),
      );
    });

    it('blocks sign when note is already signed', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        status: 'signed',
      });

      await expect(service.sign('note-1')).rejects.toThrow(ConflictException);
    });

    it('blocks sign when current user is not the author', async () => {
      jest
        .spyOn(RequestContextService, 'getUserId')
        .mockReturnValue('other-user');
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        createdBy: CURRENT_USER_ID,
      });

      await expect(service.sign('note-1')).rejects.toThrow(ForbiddenException);
    });

    it('blocks sign when all SOAP fields are empty', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        subjective: '',
        objective: '',
        assessment: '',
        plan: '',
      });

      await expect(service.sign('note-1')).rejects.toThrow(ConflictException);
    });

    it('blocks sign when all SOAP fields are whitespace only', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        subjective: '   ',
        objective: '  ',
        assessment: null,
        plan: null,
      });

      await expect(service.sign('note-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('createAddendum', () => {
    const signedParent = {
      id: 'note-1',
      status: 'signed',
      deletedAt: null,
      patientId: 'patient-1',
      appointmentId: null,
      providerId: PROVIDER_ID,
      parentNoteId: null,
    };

    it('creates addendum on signed parent with incremented version', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(signedParent);
      prisma.baseClient.clinicalNote.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });
      const addendum = {
        ...mockNote,
        id: 'note-2',
        parentNoteId: 'note-1',
        version: 2,
      };
      prisma.baseClient.clinicalNote.create.mockResolvedValue(addendum);

      const result = await service.createAddendum('note-1', {
        subjective: 'Addendum content',
      });

      expect(result.version).toBe(2);
      expect(result.parentNoteId).toBe('note-1');
      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CLINICAL_NOTE_ADDENDUM_CREATED' }),
      );
    });

    it('addendum parentNoteId points to root (flat chain)', async () => {
      const chainedParent = {
        ...signedParent,
        id: 'note-2',
        parentNoteId: 'note-1',
      };
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(chainedParent);
      prisma.baseClient.clinicalNote.aggregate.mockResolvedValue({
        _max: { version: 2 },
      });
      const addendum = {
        ...mockNote,
        id: 'note-3',
        parentNoteId: 'note-1',
        version: 3,
      };
      prisma.baseClient.clinicalNote.create.mockResolvedValue(addendum);

      const result = await service.createAddendum('note-2', {
        subjective: 'Chained addendum',
      });

      expect(result.parentNoteId).toBe('note-1');
    });

    it('blocks addendum on draft parent', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...signedParent,
        status: 'draft',
      });

      await expect(
        service.createAddendum('note-1', { subjective: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks addendum on deleted parent', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...signedParent,
        deletedAt: new Date(),
      });

      await expect(
        service.createAddendum('note-1', { subjective: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks addendum when parent not found', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(null);

      await expect(
        service.createAddendum('missing', { subjective: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks addendum when user has no provider record', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue(null);

      await expect(
        service.createAddendum('note-1', { subjective: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('softDelete', () => {
    it('soft-deletes a draft note and emits audit event', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(mockNote);
      prisma.baseClient.clinicalNote.update.mockResolvedValue({
        ...mockNote,
        deletedAt: new Date(),
      });

      const result = await service.softDelete('note-1');

      expect(result).toEqual({ id: 'note-1' });
      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CLINICAL_NOTE_DELETED' }),
      );
    });

    it('blocks deletion of signed note', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        status: 'signed',
      });

      await expect(service.softDelete('note-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks deletion when current user is not the creator', async () => {
      jest
        .spyOn(RequestContextService, 'getUserId')
        .mockReturnValue('other-user');
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue({
        ...mockNote,
        createdBy: CURRENT_USER_ID,
      });

      await expect(service.softDelete('note-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
