import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { AuditService } from '@modules/audit';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { RequestContextService } from '@modules/common/context/request-context';
import { t } from '@common/utils';
import {
  CLINICAL_NOTE_FULL_SELECT,
  CLINICAL_NOTE_LIST_SELECT,
} from './constants/clinical-note-select';
import type { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import type { UpdateClinicalNoteDto } from './dto/update-clinical-note.dto';
import type { CreateAddendumDto } from './dto/create-addendum.dto';
import type { ClinicalNoteQueryDto } from './dto/clinical-note-query.dto';

type NoteCore = {
  id: string;
  status: string;
  createdBy: string;
  providerId: string;
  parentNoteId: string | null;
  deletedAt: Date | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
};

const SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'] as const;

@Injectable()
export class ClinicalNoteService {
  private readonly logger = new Logger(ClinicalNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queue: QueueProducerService,
  ) {}

  private publishClinicalNoteEvent(
    action: 'signed' | 'updated',
    sourceId: string,
  ): void {
    const routingKey =
      action === 'signed'
        ? ROUTING_KEY.CLINICAL_NOTE_SIGNED
        : ROUTING_KEY.CLINICAL_NOTE_UPDATED;
    try {
      this.queue.publish(routingKey, {
        sourceType: 'clinical_note',
        sourceId,
        action,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish ${routingKey} for ${sourceId}: ${(err as Error).message}`,
      );
    }
  }

  async findAll(query: ClinicalNoteQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'status', 'updatedAt', 'signedAt'],
      { createdAt: 'desc' },
    );

    const where: Record<string, unknown> = { deletedAt: null };

    if (!query.includeAddendums) {
      where.parentNoteId = null;
    }

    if (query.patientId) where.patientId = query.patientId;
    if (query.appointmentId) where.appointmentId = query.appointmentId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.status) {
      where.status = { in: query.status.split(',').filter(Boolean) };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.clinicalNote.findMany({
        ...prismaArgs,
        where,
        select: CLINICAL_NOTE_LIST_SELECT,
      }),
      this.prisma.baseClient.clinicalNote.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string, includeAddendums = false) {
    const note = await this.prisma.baseClient.clinicalNote.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...CLINICAL_NOTE_FULL_SELECT,
        ...(includeAddendums && {
          addendums: {
            where: { deletedAt: null },
            select: CLINICAL_NOTE_LIST_SELECT,
            orderBy: { version: 'asc' },
          },
        }),
      },
    });

    if (!note) {
      throw new NotFoundException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_NOT_FOUND',
          'Clinical note not found',
        ),
        errorCode: 'CLINICAL_NOTE_NOT_FOUND',
      });
    }

    return note;
  }

  async findByPatient(patientId: string, query: ClinicalNoteQueryDto) {
    return this.findAll({ ...query, patientId });
  }

  async findByAppointment(appointmentId: string, query: ClinicalNoteQueryDto) {
    return this.findAll({ ...query, appointmentId });
  }

  async create(dto: CreateClinicalNoteDto) {
    const currentUserId = this.requireUserId();

    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { userId: currentUserId },
      select: { id: true },
    });

    if (!provider) {
      throw new ForbiddenException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_REQUIRES_PROVIDER',
          'Only providers can create clinical notes',
        ),
        errorCode: 'CLINICAL_NOTE_REQUIRES_PROVIDER',
      });
    }

    const patient = await this.prisma.baseClient.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });

    if (!patient) {
      throw new NotFoundException(t('patient.not_found', 'Patient not found'));
    }

    if (dto.appointmentId) {
      await this.assertAppointmentMatchesPatient(
        dto.appointmentId,
        dto.patientId,
      );
    }

    const note = await this.prisma.baseClient.clinicalNote.create({
      data: {
        patientId: dto.patientId,
        ...(dto.appointmentId ? { appointmentId: dto.appointmentId } : {}),
        providerId: provider.id,
        subjective: dto.subjective,
        objective: dto.objective,
        assessment: dto.assessment,
        plan: dto.plan,
        status: 'draft',
        createdBy: currentUserId,
      },
      select: CLINICAL_NOTE_FULL_SELECT,
    });

    this.auditService.emit({
      code: 'CLINICAL_NOTE_CREATED',
      resource: 'clinical_note',
      resourceId: note.id,
    });

    return note;
  }

  async update(id: string, dto: UpdateClinicalNoteDto) {
    const note = await this.findNoteOrFail(id);

    if (note.status !== 'draft') {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_EDIT_LOCKED',
          'Signed clinical notes cannot be edited',
        ),
        errorCode: 'CLINICAL_NOTE_EDIT_LOCKED',
      });
    }

    this.assertOwnNote(note);

    const before = this.pickSoapFields(note);
    const after = this.pickSoapFields({ ...note, ...dto });
    const diff = this.computeFieldDiff(before, after);

    const updated = await this.prisma.baseClient.clinicalNote.update({
      where: { id },
      data: {
        subjective: dto.subjective,
        objective: dto.objective,
        assessment: dto.assessment,
        plan: dto.plan,
      },
      select: CLINICAL_NOTE_FULL_SELECT,
    });

    this.auditService.emit({
      code: 'CLINICAL_NOTE_UPDATED',
      resource: 'clinical_note',
      resourceId: id,
      before: diff.before,
      after: diff.after,
    });

    return updated;
  }

  async sign(id: string) {
    const note = await this.findNoteOrFail(id);
    const currentUserId = this.requireUserId();

    if (note.status !== 'draft') {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_EDIT_LOCKED',
          'Clinical note is already signed',
        ),
        errorCode: 'CLINICAL_NOTE_EDIT_LOCKED',
      });
    }

    this.assertSignerIsAuthor(note, currentUserId);

    const hasContent = SOAP_FIELDS.some(
      (f) => (note[f] ?? '').trim().length > 0,
    );
    if (!hasContent) {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_EMPTY',
          'Cannot sign an empty clinical note',
        ),
        errorCode: 'CLINICAL_NOTE_EMPTY',
      });
    }

    const signed = await this.prisma.baseClient.clinicalNote.update({
      where: { id },
      data: {
        status: 'signed',
        signedAt: new Date(),
        signedBy: currentUserId,
      },
      select: CLINICAL_NOTE_FULL_SELECT,
    });

    this.auditService.emit({
      code: 'CLINICAL_NOTE_SIGNED',
      resource: 'clinical_note',
      resourceId: id,
    });

    if (signed.parentNoteId) {
      this.publishClinicalNoteEvent('updated', signed.parentNoteId);
    } else {
      this.publishClinicalNoteEvent('signed', signed.id);
    }

    return signed;
  }

  async createAddendum(parentId: string, dto: CreateAddendumDto) {
    const currentUserId = this.requireUserId();

    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { userId: currentUserId },
      select: { id: true },
    });

    if (!provider) {
      throw new ForbiddenException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_REQUIRES_PROVIDER',
          'Only providers can create addendums',
        ),
        errorCode: 'CLINICAL_NOTE_REQUIRES_PROVIDER',
      });
    }

    const parent = await this.prisma.baseClient.clinicalNote.findFirst({
      where: { id: parentId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        patientId: true,
        appointmentId: true,
        providerId: true,
        parentNoteId: true,
      },
    });

    if (!parent) {
      throw new NotFoundException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_NOT_FOUND',
          'Clinical note not found',
        ),
        errorCode: 'CLINICAL_NOTE_NOT_FOUND',
      });
    }

    if (parent.deletedAt !== null) {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_PARENT_DELETED',
          'Cannot add addendum to a deleted note',
        ),
        errorCode: 'CLINICAL_NOTE_PARENT_DELETED',
      });
    }

    if (parent.status !== 'signed') {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_PARENT_NOT_SIGNED',
          'Parent note must be signed before adding an addendum',
        ),
        errorCode: 'CLINICAL_NOTE_PARENT_NOT_SIGNED',
      });
    }

    const rootId = parent.parentNoteId ?? parent.id;

    const maxVersionResult =
      await this.prisma.baseClient.clinicalNote.aggregate({
        where: { OR: [{ id: rootId }, { parentNoteId: rootId }] },
        _max: { version: true },
      });

    const nextVersion = (maxVersionResult._max.version ?? 1) + 1;

    const addendum = await this.prisma.baseClient.clinicalNote.create({
      data: {
        patientId: parent.patientId,
        appointmentId: parent.appointmentId,
        providerId: provider.id,
        parentNoteId: rootId,
        version: nextVersion,
        status: 'draft',
        subjective: dto.subjective,
        objective: dto.objective,
        assessment: dto.assessment,
        plan: dto.plan,
        createdBy: currentUserId,
      },
      select: CLINICAL_NOTE_FULL_SELECT,
    });

    this.auditService.emit({
      code: 'CLINICAL_NOTE_ADDENDUM_CREATED',
      resource: 'clinical_note',
      resourceId: addendum.id,
      parentResource: 'clinical_note',
      parentId: rootId,
    });

    return addendum;
  }

  async softDelete(id: string) {
    const note = await this.findNoteOrFail(id);

    if (note.status !== 'draft') {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_EDIT_LOCKED',
          'Only draft clinical notes can be deleted',
        ),
        errorCode: 'CLINICAL_NOTE_EDIT_LOCKED',
      });
    }

    this.assertOwnNote(note);

    await this.prisma.baseClient.clinicalNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.auditService.emit({
      code: 'CLINICAL_NOTE_DELETED',
      resource: 'clinical_note',
      resourceId: id,
    });

    return { id };
  }

  private requireUserId(): string {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );
    }
    return userId;
  }

  private async findNoteOrFail(id: string): Promise<NoteCore> {
    const note = await this.prisma.baseClient.clinicalNote.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        createdBy: true,
        providerId: true,
        parentNoteId: true,
        deletedAt: true,
        subjective: true,
        objective: true,
        assessment: true,
        plan: true,
      },
    });

    if (!note) {
      throw new NotFoundException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_NOT_FOUND',
          'Clinical note not found',
        ),
        errorCode: 'CLINICAL_NOTE_NOT_FOUND',
      });
    }

    return note;
  }

  private assertOwnNote(note: NoteCore) {
    const currentUserId = this.requireUserId();

    if (note.createdBy !== currentUserId) {
      throw new ForbiddenException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_NOT_OWNER',
          'You can only modify your own clinical notes',
        ),
        errorCode: 'CLINICAL_NOTE_NOT_OWNER',
      });
    }
  }

  private assertSignerIsAuthor(note: NoteCore, currentUserId: string) {
    if (note.createdBy !== currentUserId) {
      throw new ForbiddenException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_SIGNER_NOT_AUTHOR',
          'Only the authoring provider can sign a clinical note',
        ),
        errorCode: 'CLINICAL_NOTE_SIGNER_NOT_AUTHOR',
      });
    }
  }

  private async assertAppointmentMatchesPatient(
    appointmentId: string,
    patientId: string,
  ) {
    const appointment = await this.prisma.baseClient.appointment.findUnique({
      where: { id: appointmentId },
      select: { patientId: true },
    });

    if (!appointment || appointment.patientId !== patientId) {
      throw new ConflictException({
        message: t(
          'clinicalNote.CLINICAL_NOTE_APPOINTMENT_PATIENT_MISMATCH',
          'Appointment does not belong to the specified patient',
        ),
        errorCode: 'CLINICAL_NOTE_APPOINTMENT_PATIENT_MISMATCH',
      });
    }
  }

  private pickSoapFields(
    note: Pick<NoteCore, 'subjective' | 'objective' | 'assessment' | 'plan'>,
  ): Record<string, string> {
    return Object.fromEntries(SOAP_FIELDS.map((f) => [f, note[f] ?? '']));
  }

  private computeFieldDiff(
    before: Record<string, string>,
    after: Record<string, string>,
  ): { before: Record<string, unknown>; after: Record<string, unknown> } {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};

    for (const key of Object.keys(before)) {
      if (before[key] !== after[key]) {
        changedBefore[key] = before[key];
        changedAfter[key] = after[key];
      }
    }

    return { before: changedBefore, after: changedAfter };
  }
}
