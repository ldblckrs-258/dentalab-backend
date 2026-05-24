import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { AuditService } from '@modules/audit';
import { t } from '@common/utils';
import type {
  ExecuteImportDto,
  ResolvedProcedureRowDto,
} from './dto/import-procedure.dto';
import type { CreateProcedureDto } from './dto/create-procedure.dto';
import type { UpdateProcedureDto } from './dto/update-procedure.dto';
import type { ProcedureQueryDto } from './dto/procedure-query.dto';

const PROCEDURE_SELECT = {
  id: true,
  adaCode: true,
  name: true,
  category: true,
  durationMinutes: true,
  defaultFee: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProcedureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: ProcedureQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'name', 'adaCode'],
      { name: 'asc' },
    );

    const where: Record<string, unknown> = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { adaCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.category) {
      where.category = query.category;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.procedure.findMany({
        ...prismaArgs,
        where,
        select: PROCEDURE_SELECT,
      }),
      this.prisma.baseClient.procedure.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findCategories(): Promise<string[]> {
    const rows = await this.prisma.baseClient.procedure.findMany({
      where: { category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows
      .map((r) => r.category)
      .filter((c): c is string => c !== null && c.length > 0);
  }

  async findById(id: string) {
    const procedure = await this.prisma.baseClient.procedure.findUnique({
      where: { id },
      select: PROCEDURE_SELECT,
    });
    if (!procedure) {
      throw new NotFoundException(
        t('procedure.not_found', 'Procedure not found'),
      );
    }
    return procedure;
  }

  async create(dto: CreateProcedureDto) {
    return this.prisma.baseClient.procedure.create({
      data: {
        adaCode: dto.adaCode,
        name: dto.name,
        category: dto.category,
        durationMinutes: dto.durationMinutes,
        defaultFee: dto.defaultFee,
      },
      select: PROCEDURE_SELECT,
    });
  }

  async update(id: string, dto: UpdateProcedureDto) {
    const current = await this.findProcedureOrFail(id);

    if (dto.adaCode !== undefined && dto.adaCode !== current.adaCode) {
      const refCount = await this.prisma.baseClient.patientProcedure.count({
        where: { procedureId: id, deletedAt: null },
      });
      if (refCount > 0) {
        throw new ConflictException({
          errorCode: 'PROCEDURE_ADA_CODE_LOCKED',
          referenceCount: refCount,
        });
      }
    }

    const isActiveChanged =
      dto.isActive !== undefined && dto.isActive !== current.isActive;

    const updated = await this.prisma.baseClient.procedure.update({
      where: { id },
      data: {
        adaCode: dto.adaCode,
        name: dto.name,
        category: dto.category,
        durationMinutes: dto.durationMinutes,
        defaultFee: dto.defaultFee,
        isActive: dto.isActive,
      },
      select: PROCEDURE_SELECT,
    });

    if (isActiveChanged) {
      this.auditService.emit({
        code: dto.isActive ? 'PROCEDURE_ENABLED' : 'PROCEDURE_DISABLED',
        resource: 'procedure',
        resourceId: id,
        before: { isActive: current.isActive },
        after: { isActive: updated.isActive },
      });
    }

    return updated;
  }

  async previewCsvImport(file: Express.Multer.File) {
    const { parse } = await import('csv-parse/sync');

    let records: Record<string, unknown>[];
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new UnprocessableEntityException(
        t('procedure.import.parse_error', 'Could not parse the CSV file'),
      );
    }

    if (records.length > 1000) {
      throw new UnprocessableEntityException(
        t(
          'procedure.import.too_many_rows',
          'CSV file exceeds the 1000-row limit. Split the file and try again.',
        ),
      );
    }

    const errors: Array<{
      rowIndex: number;
      adaCode: string | null;
      message: string;
    }> = [];
    const seenAdaCodes = new Set<string>();
    const potentialRows: Array<{
      rowIndex: number;
      adaCode: string;
      name: string;
      category?: string;
      durationMinutes?: number;
      defaultFee?: number;
      isActive: boolean;
    }> = [];

    for (let i = 0; i < records.length; i++) {
      const rowIndex = i + 1;
      const row = records[i];

      const adaCode = (
        typeof row.adaCode === 'string' ? row.adaCode : ''
      ).trim();
      const name = (typeof row.name === 'string' ? row.name : '').trim();

      if (!adaCode) {
        errors.push({
          rowIndex,
          adaCode: null,
          message: t(
            'procedure.import.row_missing_ada_code',
            `Row ${rowIndex}: adaCode is required`,
            { row: rowIndex },
          ),
        });
        continue;
      }

      if (adaCode.length > 20) {
        errors.push({
          rowIndex,
          adaCode,
          message: t(
            'procedure.import.row_invalid_ada_code_length',
            `Row ${rowIndex}: adaCode must be 1–20 characters`,
            { row: rowIndex },
          ),
        });
        continue;
      }

      if (!name) {
        errors.push({
          rowIndex,
          adaCode,
          message: t(
            'procedure.import.row_missing_name',
            `Row ${rowIndex}: name is required`,
            { row: rowIndex },
          ),
        });
        continue;
      }

      if (seenAdaCodes.has(adaCode)) {
        errors.push({
          rowIndex,
          adaCode,
          message: t(
            'procedure.import.row_intra_duplicate',
            `Row ${rowIndex}: adaCode '${adaCode}' appears more than once in this file`,
            { row: rowIndex, adaCode },
          ),
        });
        continue;
      }

      seenAdaCodes.add(adaCode);

      let durationMinutes: number | undefined;
      if (row.durationMinutes !== undefined && row.durationMinutes !== '') {
        const parsed = Number(row.durationMinutes);
        if (!Number.isInteger(parsed) || parsed < 1) {
          errors.push({
            rowIndex,
            adaCode,
            message: t(
              'procedure.import.row_invalid_duration',
              `Row ${rowIndex}: durationMinutes must be a positive integer`,
              { row: rowIndex },
            ),
          });
          continue;
        }
        durationMinutes = parsed;
      }

      let defaultFee: number | undefined;
      if (row.defaultFee !== undefined && row.defaultFee !== '') {
        const parsed = Number(row.defaultFee);
        if (Number.isNaN(parsed) || parsed < 0) {
          errors.push({
            rowIndex,
            adaCode,
            message: t(
              'procedure.import.row_invalid_fee',
              `Row ${rowIndex}: defaultFee must be a non-negative number`,
              { row: rowIndex },
            ),
          });
          continue;
        }
        defaultFee = parsed;
      }

      let isActive = true;
      if (row.isActive !== undefined && row.isActive !== '') {
        const val = String(row.isActive as string)
          .toLowerCase()
          .trim();
        if (val === 'true') {
          isActive = true;
        } else if (val === 'false') {
          isActive = false;
        } else {
          errors.push({
            rowIndex,
            adaCode,
            message: t(
              'procedure.import.row_invalid_is_active',
              `Row ${rowIndex}: isActive must be 'true' or 'false'`,
              { row: rowIndex },
            ),
          });
          continue;
        }
      }

      potentialRows.push({
        rowIndex,
        adaCode,
        name,
        category:
          typeof row.category === 'string' ? row.category.trim() : undefined,
        durationMinutes,
        defaultFee,
        isActive,
      });
    }

    const adaCodes = potentialRows.map((r) => r.adaCode);
    const existing = await this.prisma.baseClient.procedure.findMany({
      where: { adaCode: { in: adaCodes } },
      select: PROCEDURE_SELECT,
    });

    const existingByAdaCode = new Map(existing.map((p) => [p.adaCode, p]));

    const valid: typeof potentialRows = [];
    const duplicates: Array<{
      existing: (typeof existing)[number];
      incoming: (typeof potentialRows)[number];
    }> = [];

    for (const row of potentialRows) {
      const existingProc = existingByAdaCode.get(row.adaCode);
      if (existingProc) {
        duplicates.push({ existing: existingProc, incoming: row });
      } else {
        valid.push(row);
      }
    }

    return {
      valid,
      duplicates,
      errors,
      totalRows: records.length,
    };
  }

  async executeImport(dto: ExecuteImportDto) {
    const toInsert: ResolvedProcedureRowDto[] = [];
    const toUpdate: ResolvedProcedureRowDto[] = [];
    const toSkip: ResolvedProcedureRowDto[] = [];

    const allAdaCodes = dto.rows.map((r) => r.adaCode);
    const existing = await this.prisma.baseClient.procedure.findMany({
      where: { adaCode: { in: allAdaCodes } },
      select: { adaCode: true },
    });
    const existingAdaCodes = new Set(existing.map((p) => p.adaCode));

    for (const row of dto.rows) {
      if (row.useNew) {
        if (existingAdaCodes.has(row.adaCode)) {
          toUpdate.push(row);
        } else {
          toInsert.push(row);
        }
      } else {
        toSkip.push(row);
      }
    }

    try {
      const BATCH_SIZE = 50;

      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        await this.prisma.baseClient.$transaction(
          batch.map((r) =>
            this.prisma.baseClient.procedure.create({
              data: {
                adaCode: r.adaCode,
                name: r.name,
                category: r.category,
                durationMinutes: r.durationMinutes,
                defaultFee: r.defaultFee,
                isActive: r.isActive ?? true,
              },
            }),
          ),
        );
      }

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);
        await this.prisma.baseClient.$transaction(
          batch.map((r) =>
            this.prisma.baseClient.procedure.update({
              where: { adaCode: r.adaCode },
              data: {
                name: r.name,
                category: r.category,
                durationMinutes: r.durationMinutes,
                defaultFee: r.defaultFee,
                isActive: r.isActive ?? true,
              },
            }),
          ),
        );
      }
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException({
          errorCode: 'IMPORT_ADA_CODE_CONFLICT',
          details: {
            message: 'One or more ADA codes were modified by another user',
          },
        });
      }
      throw err;
    }

    return {
      created: toInsert.length,
      updated: toUpdate.length,
      skipped: toSkip.length,
    };
  }

  private async findProcedureOrFail(id: string) {
    const procedure = await this.prisma.baseClient.procedure.findUnique({
      where: { id },
      select: { id: true, adaCode: true, isActive: true },
    });
    if (!procedure) {
      throw new NotFoundException(
        t('procedure.not_found', 'Procedure not found'),
      );
    }
    return procedure;
  }
}
