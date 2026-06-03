import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { CreatePatientDto } from './dto/create-patient.dto';
import type { UpdatePatientDto } from './dto/update-patient.dto';
import type { PatientQueryDto } from './dto/patient-query.dto';

const PATIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  phone: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PATIENT_DETAIL_SELECT = {
  ...PATIENT_SELECT,
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
} as const;

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueProducer: QueueProducerService,
  ) {}

  async findAll(query: PatientQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'lastName', 'firstName'],
      { createdAt: 'desc' },
    );

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.patient.findMany({
        ...prismaArgs,
        where,
        select: PATIENT_SELECT,
      }),
      this.prisma.baseClient.patient.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string) {
    const patient = await this.prisma.baseClient.patient.findFirst({
      where: { id },
      select: PATIENT_DETAIL_SELECT,
    });
    if (!patient) {
      throw new NotFoundException(t('patient.not_found', 'Patient not found'));
    }
    return patient;
  }

  async create(dto: CreatePatientDto) {
    return this.prisma.baseClient.patient.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
      },
      select: PATIENT_DETAIL_SELECT,
    });
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findPatientOrFail(id);

    return this.prisma.baseClient.patient.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        isActive: dto.isActive,
      },
      select: PATIENT_DETAIL_SELECT,
    });
  }

  async delete(id: string, reason: string) {
    const now = new Date();

    await this.prisma.transaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!patient) {
        throw new NotFoundException(
          t('patient.not_found', 'Patient not found'),
        );
      }

      await Promise.all([
        tx.clinicalNote.updateMany({
          where: { patientId: id, deletedAt: null },
          data: { deletedAt: now },
        }),
        tx.patientFile.updateMany({
          where: { patientId: id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);

      await tx.patient.update({
        where: { id },
        data: { deletedAt: now },
      });
    });

    this.queueProducer.publish(ROUTING_KEY.DOCUMENT_DELETED, {
      sourceType: 'patient',
      sourceId: id,
      action: 'deleted',
    });

    this.logger.log(`Patient ${id} deleted (GDPR cascade). Reason: ${reason}`);
  }

  async findPatientOrFail(id: string) {
    const patient = await this.prisma.baseClient.patient.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException(t('patient.not_found', 'Patient not found'));
    }
    return patient;
  }
}
