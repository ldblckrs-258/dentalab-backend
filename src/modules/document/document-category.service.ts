import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { CategoryQueryDto } from './dto/category-query.dto';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { documents: true } },
} as const;

@Injectable()
export class DocumentCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: CategoryQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['name', 'createdAt'], {
      createdAt: 'desc',
    });

    const where: Prisma.DocumentCategoryWhereInput = { deletedAt: null };

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.documentCategory.findMany({
        ...prismaArgs,
        where,
        select: CATEGORY_SELECT,
      }),
      this.prisma.baseClient.documentCategory.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string) {
    const category = await this.prisma.baseClient.documentCategory.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    });

    if (!category) {
      throw new NotFoundException(
        t('document.category_not_found', 'Category not found'),
      );
    }

    return category;
  }

  async create(dto: CreateCategoryDto, userId: string) {
    try {
      return await this.prisma.baseClient.documentCategory.create({
        data: {
          name: dto.name.trim(),
          description: dto.description ?? null,
          createdBy: userId,
        },
        select: CATEGORY_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          t(
            'document.category_name_conflict',
            'A category with this name already exists',
          ),
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findById(id);

    const data: Prisma.DocumentCategoryUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined)
      data.description = dto.description ?? null;

    try {
      return await this.prisma.baseClient.documentCategory.update({
        where: { id },
        data,
        select: CATEGORY_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          t(
            'document.category_name_conflict',
            'A category with this name already exists',
          ),
        );
      }
      throw err;
    }
  }

  async delete(id: string) {
    await this.findById(id);

    await this.prisma.baseClient.$transaction(async (tx) => {
      await tx.documentCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await tx.internalDocument.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      });
    });

    return { id };
  }
}
