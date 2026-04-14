import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { t } from '@common/utils';
import {
  PaginationQueryDto,
  buildPrismaQuery,
  buildPaginatedResponse,
} from '@modules/pagination';
import { TemplateService } from './template/template.service';
import type { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import type { UpdateEmailTemplateDto } from './dto/update-email-template.dto';

@Injectable()
export class EmailTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: TemplateService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['name', 'type', 'createdAt']);

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { subject: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.emailTemplate.findMany({
        ...prismaArgs,
        where,
        select: {
          id: true,
          name: true,
          subject: true,
          type: true,
          variables: true,
          isSystem: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { emailLogs: true } },
        },
      }),
      this.prisma.baseClient.emailTemplate.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findOne(id: string) {
    const template = await this.prisma.baseClient.emailTemplate.findUnique({
      where: { id },
    });
    if (!template)
      throw new NotFoundException(
        t('email.template_not_found', 'Email template not found'),
      );
    return template;
  }

  async create(dto: CreateEmailTemplateDto) {
    const bodyHtml = this.templateService.compileMjmlToHtml(dto.bodyMjml);

    return this.prisma.baseClient.emailTemplate.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        bodyMjml: dto.bodyMjml,
        bodyHtml: bodyHtml,
        type: dto.type,
        variables: dto.variables as any,
        isSystem: false,
      },
    });
  }

  async update(id: string, dto: UpdateEmailTemplateDto) {
    const template = await this.prisma.baseClient.emailTemplate.findUnique({
      where: { id },
    });
    if (!template)
      throw new NotFoundException(
        t('email.template_not_found', 'Email template not found'),
      );

    const data: Record<string, unknown> = {};

    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.variables !== undefined) data.variables = dto.variables;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.bodyMjml !== undefined) {
      data.bodyMjml = dto.bodyMjml;
      data.bodyHtml = this.templateService.compileMjmlToHtml(dto.bodyMjml);
    }

    // Invalidate compiled cache so next render picks up changes
    this.templateService.invalidateCache(template.name);

    return this.prisma.baseClient.emailTemplate.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const template = await this.prisma.baseClient.emailTemplate.findUnique({
      where: { id },
    });
    if (!template)
      throw new NotFoundException(
        t('email.template_not_found', 'Email template not found'),
      );

    if (template.isSystem) {
      throw new BadRequestException(
        t(
          'email.cannot_delete_system_template',
          'System templates cannot be deleted',
        ),
      );
    }

    await this.prisma.baseClient.emailTemplate.delete({ where: { id } });

    return {
      message: t('email.template_deleted', 'Email template deleted'),
    };
  }
}
