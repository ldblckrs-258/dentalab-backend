import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '@modules/config';
import { SOFT_DELETE_MODELS, SOFT_DELETE_AT_MODELS } from '@common/constants';

function addSoftDeleteFilter(model: string, args: Record<string, any>): void {
  const where = (args.where ?? {}) as Record<string, unknown>;

  if (SOFT_DELETE_MODELS.includes(model)) {
    if (where.is_active === undefined) {
      where.is_active = true;
    }
    args.where = where;
  } else if (SOFT_DELETE_AT_MODELS.includes(model)) {
    if (where.deleted_at === undefined) {
      where.deleted_at = null;
    }
    args.where = where;
  }
}

function getDelegate(client: PrismaClient, model: string) {
  return (client as any)[model[0].toLowerCase() + model.slice(1)];
}

function createSoftDeleteExtension(client: PrismaClient) {
  return Prisma.defineExtension({
    name: 'softDelete',
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          addSoftDeleteFilter(model, args as Record<string, any>);
          return query(args);
        },
        async findFirst({ model, args, query }) {
          addSoftDeleteFilter(model, args as Record<string, any>);
          return query(args);
        },
        async findUnique({ model, args, query }) {
          addSoftDeleteFilter(model, args as Record<string, any>);
          return query(args);
        },
        async count({ model, args, query }) {
          addSoftDeleteFilter(model, args as Record<string, any>);
          return query(args);
        },
        delete({ model, args }) {
          if (SOFT_DELETE_MODELS.includes(model)) {
            return getDelegate(client, model).update({
              where: (args as any).where,
              data: { is_active: false },
            });
          }
          if (SOFT_DELETE_AT_MODELS.includes(model)) {
            return getDelegate(client, model).update({
              where: (args as any).where,
              data: { deleted_at: new Date() },
            });
          }
          return getDelegate(client, model).delete(args);
        },
        deleteMany({ model, args }) {
          if (SOFT_DELETE_MODELS.includes(model)) {
            return getDelegate(client, model).updateMany({
              where: (args as any).where,
              data: { is_active: false },
            });
          }
          if (SOFT_DELETE_AT_MODELS.includes(model)) {
            return getDelegate(client, model).updateMany({
              where: (args as any).where,
              data: { deleted_at: new Date() },
            });
          }
          return getDelegate(client, model).deleteMany(args);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private _client: PrismaClient;
  private _extendedClient: ReturnType<typeof this.createExtendedClient>;

  constructor(config: AppConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.database.DATABASE_URL,
    });

    const logLevels: Prisma.LogLevel[] = config.isDevelopment
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'];

    this._client = new PrismaClient({
      adapter,
      log: logLevels.map((level) => ({
        emit: 'event' as const,
        level,
      })),
    });

    this._extendedClient = this.createExtendedClient();
  }

  private createExtendedClient() {
    return this._client.$extends(createSoftDeleteExtension(this._client));
  }

  get client() {
    return this._extendedClient;
  }

  get baseClient(): PrismaClient {
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    await this._client.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.$disconnect();
    this.logger.log('Database disconnected');
  }

  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this._client.$transaction(fn, {
      maxWait: options?.maxWait ?? 5000,
      timeout: options?.timeout ?? 10000,
    });
  }
}
