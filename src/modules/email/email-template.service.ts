import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
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
    const prismaArgs = buildPrismaQuery(query, ['name', 'type', 'created_at']);

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
          is_system: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          _count: { select: { email_logs: true } },
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
    if (!template) throw new NotFoundException('Email template not found');
    return template;
  }

  async create(dto: CreateEmailTemplateDto) {
    const bodyHtml = this.templateService.compileMjmlToHtml(dto.body_mjml);

    return this.prisma.baseClient.emailTemplate.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        body_mjml: dto.body_mjml,
        body_html: bodyHtml,
        type: dto.type,
        variables: dto.variables as any,
        is_system: false,
      },
    });
  }

  async update(id: string, dto: UpdateEmailTemplateDto) {
    const template = await this.prisma.baseClient.emailTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('Email template not found');

    const data: Record<string, unknown> = {};

    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.variables !== undefined) data.variables = dto.variables;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    if (dto.body_mjml !== undefined) {
      data.body_mjml = dto.body_mjml;
      data.body_html = this.templateService.compileMjmlToHtml(dto.body_mjml);
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
    if (!template) throw new NotFoundException('Email template not found');

    if (template.is_system) {
      throw new BadRequestException('System templates cannot be deleted');
    }

    await this.prisma.baseClient.emailTemplate.delete({ where: { id } });

    return { message: 'Email template deleted' };
  }
}
