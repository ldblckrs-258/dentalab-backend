import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { buildPaginatedResponse, buildPrismaQuery } from '@modules/pagination';
import { CacheService } from '@modules/redis/cache.service';
import { t } from '@common/utils';
import type { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import type { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import type { ListItemsQueryDto } from './dto/list-items-query.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { RecordTransactionDto } from './dto/record-transaction.dto';
import { InventoryRepository } from './repositories/inventory.repository';
import { LowStockPublisher } from './low-stock.publisher';
import { signedDelta } from './inventory.types';

const ITEM_SORT_FIELDS = ['name', 'sku', 'quantity', 'createdAt', 'updatedAt'];
const TX_SORT_FIELDS = ['createdAt', 'type', 'quantityChange'];

const CATEGORIES_CACHE_DOMAIN = 'inventory';
const CATEGORIES_CACHE_KEY = 'categories';
const CATEGORIES_CACHE_TTL = 600;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InventoryRepository,
    private readonly lowStockPublisher: LowStockPublisher,
    private readonly cache: CacheService,
  ) {}

  async listCategories(): Promise<string[]> {
    return this.cache.remember(
      CATEGORIES_CACHE_DOMAIN,
      CATEGORIES_CACHE_KEY,
      CATEGORIES_CACHE_TTL,
      async () => {
        const rows = await this.prisma.baseClient.inventoryItem.findMany({
          where: { category: { not: null } },
          distinct: ['category'],
          select: { category: true },
          orderBy: { category: 'asc' },
        });
        return rows
          .map((r) => r.category)
          .filter((c): c is string => c !== null && c.length > 0);
      },
    );
  }

  private async invalidateCategories(): Promise<void> {
    await this.cache.del(CATEGORIES_CACHE_DOMAIN, CATEGORIES_CACHE_KEY);
  }

  // ──────────────────────────────────────────────────────────────────
  // Items
  // ──────────────────────────────────────────────────────────────────

  async createItem(dto: CreateInventoryItemDto) {
    try {
      const item = await this.prisma.baseClient.inventoryItem.create({
        data: {
          name: dto.name,
          sku: dto.sku,
          category: dto.category,
          unit: dto.unit,
          minQuantity: dto.minQuantity ?? 0,
          costPerUnit:
            dto.costPerUnit !== undefined
              ? new Prisma.Decimal(dto.costPerUnit)
              : null,
        },
      });
      if (dto.category) await this.invalidateCategories();
      return item;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          t('inventory.sku_duplicate', 'SKU already exists'),
        );
      }
      throw error;
    }
  }

  async updateItem(id: string, dto: UpdateInventoryItemDto) {
    await this.getActiveItemOrThrow(id);
    const updated = await this.prisma.baseClient.inventoryItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.minQuantity !== undefined && { minQuantity: dto.minQuantity }),
        ...(dto.costPerUnit !== undefined && {
          costPerUnit: new Prisma.Decimal(dto.costPerUnit),
        }),
      },
    });
    if (dto.category !== undefined) await this.invalidateCategories();
    return updated;
  }

  async archiveItem(id: string) {
    const item = await this.prisma.baseClient.inventoryItem.findUnique({
      where: { id },
    });
    if (!item)
      throw new NotFoundException(
        t('inventory.item_not_found', 'Inventory item not found'),
      );
    if (!item.isActive) return item;
    const archived = await this.prisma.baseClient.inventoryItem.update({
      where: { id },
      data: { isActive: false },
    });
    if (item.category) await this.invalidateCategories();
    return archived;
  }

  async restoreItem(id: string) {
    const item = await this.prisma.baseClient.inventoryItem.findUnique({
      where: { id },
    });
    if (!item)
      throw new NotFoundException(
        t('inventory.item_not_found', 'Inventory item not found'),
      );
    if (item.isActive) return item;
    const restored = await this.prisma.baseClient.inventoryItem.update({
      where: { id },
      data: { isActive: true },
    });
    if (item.category) await this.invalidateCategories();
    return restored;
  }

  async getItem(id: string) {
    const item = await this.prisma.baseClient.inventoryItem.findUnique({
      where: { id },
    });
    if (!item)
      throw new NotFoundException(
        t('inventory.item_not_found', 'Inventory item not found'),
      );
    return item;
  }

  async listItems(query: ListItemsQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ITEM_SORT_FIELDS, {
      createdAt: 'desc',
    });

    const where: Prisma.InventoryItemWhereInput = {};
    if (query.isActive !== undefined) where.isActive = query.isActive;
    else where.isActive = true;
    if (query.category) where.category = query.category;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.lowStock) {
      // Filter qty <= min_quantity via raw expression
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []),
        { quantity: { lte: 0 } } as Prisma.InventoryItemWhereInput,
      ];
    }

    let data: Awaited<
      ReturnType<typeof this.prisma.baseClient.inventoryItem.findMany>
    >;
    let total: number;
    if (query.lowStock) {
      // Prisma cannot compare two columns directly via standard filter,
      // fetch with raw filtering using $queryRaw for count + ids, then hydrate.
      const lowIds = await this.prisma.baseClient.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT id FROM inventory_items
        WHERE quantity <= min_quantity
          ${query.isActive === undefined ? Prisma.sql`AND is_active = true` : query.isActive ? Prisma.sql`AND is_active = true` : Prisma.sql`AND is_active = false`}
          ${query.category ? Prisma.sql`AND category = ${query.category}` : Prisma.empty}
          ${query.search ? Prisma.sql`AND (name ILIKE ${`%${query.search}%`} OR sku ILIKE ${`%${query.search}%`})` : Prisma.empty}
      `;
      const idList = lowIds.map((r) => r.id);
      total = idList.length;
      data = idList.length
        ? await this.prisma.baseClient.inventoryItem.findMany({
            ...prismaArgs,
            where: { id: { in: idList } },
          })
        : [];
    } else {
      [data, total] = await Promise.all([
        this.prisma.baseClient.inventoryItem.findMany({ ...prismaArgs, where }),
        this.prisma.baseClient.inventoryItem.count({ where }),
      ]);
    }

    return buildPaginatedResponse(data, total, query);
  }

  // ──────────────────────────────────────────────────────────────────
  // Transactions
  // ──────────────────────────────────────────────────────────────────

  async recordTransaction(
    itemId: string,
    dto: RecordTransactionDto,
    performedBy: string,
  ) {
    const delta = signedDelta(dto.type, dto.subType, dto.quantity);

    if (dto.referenceType && !dto.referenceId) {
      throw new BadRequestException(
        t(
          'inventory.reference_id_required',
          'referenceId is required when referenceType is provided',
        ),
      );
    }

    if (dto.referenceType && dto.referenceId) {
      await this.assertReferenceExists(dto.referenceType, dto.referenceId);
    }

    const result = await this.prisma.transaction(async (tx) => {
      const change = await this.repo.applyStockChange(tx, { itemId, delta });

      if (!change) {
        const exists = await tx.inventoryItem.findUnique({
          where: { id: itemId },
          select: { id: true, isActive: true, quantity: true },
        });
        if (!exists)
          throw new NotFoundException(
            t('inventory.item_not_found', 'Inventory item not found'),
          );
        if (!exists.isActive)
          throw new BadRequestException(
            t('inventory.item_archived', 'Inventory item is archived'),
          );
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          currentQuantity: exists.quantity,
          message: t(
            'inventory.insufficient_stock',
            'Insufficient stock for this operation',
          ),
        });
      }

      const txn = await tx.inventoryTransaction.create({
        data: {
          itemId,
          quantityChange: delta,
          quantityBefore: change.quantityBefore,
          quantityAfter: change.quantityAfter,
          type: dto.type,
          referenceType: dto.referenceType ?? null,
          referenceId: dto.referenceId ?? null,
          performedBy,
          notes: dto.notes ?? null,
        },
      });

      const crossed =
        change.quantityBefore > change.minQuantity &&
        change.quantityAfter <= change.minQuantity;

      return {
        txn,
        crossed,
        snapshot: change,
      };
    });

    if (result.crossed) {
      this.lowStockPublisher.publish({
        itemId,
        itemName: result.snapshot.name,
        sku: result.snapshot.sku,
        currentQuantity: result.snapshot.quantityAfter,
        minQuantity: result.snapshot.minQuantity,
      });
    }

    return result.txn;
  }

  async listTransactions(itemId: string, query: ListTransactionsQueryDto) {
    await this.getItem(itemId); // 404 on missing
    const prismaArgs = buildPrismaQuery(query, TX_SORT_FIELDS, {
      createdAt: 'desc',
    });
    const where: Prisma.InventoryTransactionWhereInput = { itemId };
    if (query.type) where.type = query.type;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.inventoryTransaction.findMany({
        ...prismaArgs,
        where,
        include: {
          performer: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.baseClient.inventoryTransaction.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  private async getActiveItemOrThrow(id: string) {
    const item = await this.prisma.baseClient.inventoryItem.findUnique({
      where: { id },
    });
    if (!item)
      throw new NotFoundException(
        t('inventory.item_not_found', 'Inventory item not found'),
      );
    if (!item.isActive)
      throw new BadRequestException(
        t('inventory.item_archived', 'Inventory item is archived'),
      );
    return item;
  }

  private async assertReferenceExists(
    referenceType: 'appointment' | 'patient_procedure',
    referenceId: string,
  ): Promise<void> {
    if (referenceType === 'appointment') {
      const found = await this.prisma.baseClient.appointment.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
      if (!found)
        throw new BadRequestException(
          t('inventory.reference_not_found', 'Referenced entity not found'),
        );
    } else {
      const found = await this.prisma.baseClient.patientProcedure.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
      if (!found)
        throw new BadRequestException(
          t('inventory.reference_not_found', 'Referenced entity not found'),
        );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // CSV import
  // ──────────────────────────────────────────────────────────────────

  async importFromCsv(
    file: Express.Multer.File | undefined,
    performedBy: string,
  ): Promise<{
    created: Array<{ row: number; sku: string; id: string; quantity: number }>;
    updated: Array<{
      row: number;
      sku: string;
      id: string;
      quantityBefore: number;
      quantityAfter: number;
    }>;
    errors: Array<{ row: number; sku: string | null; message: string }>;
  }> {
    if (!file?.buffer) {
      throw new BadRequestException(
        t('inventory.import.file_required', 'CSV file is required'),
      );
    }

    const { parse } = await import('csv-parse/sync');
    let records: Array<Record<string, unknown>>;
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new UnprocessableEntityException(
        t('inventory.import.parse_error', 'Could not parse the CSV file'),
      );
    }

    if (records.length === 0) {
      throw new UnprocessableEntityException(
        t('inventory.import.empty_file', 'CSV file has no rows'),
      );
    }
    if (records.length > 1000) {
      throw new UnprocessableEntityException(
        t(
          'inventory.import.too_many_rows',
          'CSV file exceeds the 1000-row limit. Split the file and try again.',
        ),
      );
    }

    const created: Array<{
      row: number;
      sku: string;
      id: string;
      quantity: number;
    }> = [];
    const updated: Array<{
      row: number;
      sku: string;
      id: string;
      quantityBefore: number;
      quantityAfter: number;
    }> = [];
    const errors: Array<{
      row: number;
      sku: string | null;
      message: string;
    }> = [];
    const seenSkus = new Set<string>();

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // header counts as row 1 in 1-based humanized index

      const sku = pickString(row.sku);
      const name = pickString(row.name);
      const quantityRaw = pickString(row.quantity);
      const category = pickString(row.category) || undefined;
      const unit = pickString(row.unit) || undefined;
      const minQuantityRaw = pickString(row.minQuantity);
      const costPerUnitRaw = pickString(row.costPerUnit);
      const notes = pickString(row.notes) || undefined;

      if (!sku) {
        errors.push({
          row: rowNum,
          sku: null,
          message: t('inventory.import.row_missing_sku', 'sku is required'),
        });
        continue;
      }
      if (sku.length > 64 || !/^[A-Za-z0-9._-]+$/.test(sku)) {
        errors.push({
          row: rowNum,
          sku,
          message: t(
            'inventory.import.row_invalid_sku',
            'sku must be 1-64 chars of [A-Za-z0-9._-]',
          ),
        });
        continue;
      }
      if (seenSkus.has(sku)) {
        errors.push({
          row: rowNum,
          sku,
          message: t(
            'inventory.import.row_duplicate_sku',
            'sku appears more than once in the CSV',
          ),
        });
        continue;
      }
      seenSkus.add(sku);

      const quantity = Number(quantityRaw);
      if (
        !quantityRaw ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 1_000_000
      ) {
        errors.push({
          row: rowNum,
          sku,
          message: t(
            'inventory.import.row_invalid_quantity',
            'quantity must be an integer between 1 and 1,000,000',
          ),
        });
        continue;
      }

      let minQuantity = 0;
      if (minQuantityRaw) {
        const v = Number(minQuantityRaw);
        if (!Number.isInteger(v) || v < 0) {
          errors.push({
            row: rowNum,
            sku,
            message: t(
              'inventory.import.row_invalid_min_quantity',
              'minQuantity must be a non-negative integer',
            ),
          });
          continue;
        }
        minQuantity = v;
      }

      let costPerUnit: Prisma.Decimal | null = null;
      if (costPerUnitRaw) {
        const v = Number(costPerUnitRaw);
        if (Number.isNaN(v) || v < 0) {
          errors.push({
            row: rowNum,
            sku,
            message: t(
              'inventory.import.row_invalid_cost',
              'costPerUnit must be a non-negative number',
            ),
          });
          continue;
        }
        costPerUnit = new Prisma.Decimal(v.toFixed(2));
      }

      // Look up existing item by SKU (any active state) — match on the SKU
      // unique index. If archived, treat as create-failure rather than
      // implicitly restoring.
      const existing = await this.prisma.baseClient.inventoryItem.findUnique({
        where: { sku },
      });

      try {
        if (existing) {
          if (!existing.isActive) {
            errors.push({
              row: rowNum,
              sku,
              message: t(
                'inventory.item_archived',
                'Inventory item is archived',
              ),
            });
            continue;
          }
          // Record purchase txn that adds the CSV quantity.
          const txn = await this.recordTransaction(
            existing.id,
            {
              type: 'purchase',
              quantity,
              ...(notes !== undefined ? { notes } : {}),
            } as RecordTransactionDto,
            performedBy,
          );
          updated.push({
            row: rowNum,
            sku,
            id: existing.id,
            quantityBefore: txn.quantityBefore,
            quantityAfter: txn.quantityAfter,
          });
        } else {
          if (!name) {
            errors.push({
              row: rowNum,
              sku,
              message: t(
                'inventory.import.row_missing_name',
                'name is required for new items',
              ),
            });
            continue;
          }
          if (name.length > 255) {
            errors.push({
              row: rowNum,
              sku,
              message: t(
                'inventory.import.row_invalid_name',
                'name must be at most 255 characters',
              ),
            });
            continue;
          }
          const item = await this.prisma.baseClient.inventoryItem.create({
            data: {
              name,
              sku,
              category,
              unit,
              minQuantity,
              costPerUnit,
            },
          });
          // Seed initial stock via purchase txn (atomic + ledger).
          const txn = await this.recordTransaction(
            item.id,
            {
              type: 'purchase',
              quantity,
              ...(notes !== undefined ? { notes } : {}),
            } as RecordTransactionDto,
            performedBy,
          );
          created.push({
            row: rowNum,
            sku,
            id: item.id,
            quantity: txn.quantityAfter,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push({ row: rowNum, sku, message });
      }
    }

    if (created.length > 0) await this.invalidateCategories();
    return { created, updated, errors };
  }
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
