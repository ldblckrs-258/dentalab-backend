import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { ChannelModel } from 'amqplib';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { REDIS_CLIENT } from '@modules/redis';
import { RABBITMQ_CONNECTION } from '@modules/queue';
import { S3_CLIENT } from '@modules/storage';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface CheckResult {
  status: 'up' | 'down';
  latencyMs?: number;
}

export interface HealthCheckResponse {
  status: HealthStatus;
  timestamp: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    rabbitmq: CheckResult;
    storage: CheckResult;
  };
}

const CHECK_TIMEOUT = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RABBITMQ_CONNECTION)
    private readonly rabbitConnection: ChannelModel | null,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {
    this.bucket = config.storage.S3_BUCKET;
  }

  async checkReadiness(): Promise<HealthCheckResponse> {
    const rabbitmq = this.checkRabbitmq();
    const [database, redis, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);

    let status: HealthStatus = 'healthy';
    if (database.status === 'down' || redis.status === 'down') {
      status = 'unhealthy';
    } else if (rabbitmq.status === 'down' || storage.status === 'down') {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: { database, redis, rabbitmq, storage },
    };
  }

  private async checkDatabase(): Promise<CheckResult> {
    try {
      const start = Date.now();
      await withTimeout(
        this.prisma.baseClient.$queryRawUnsafe('SELECT 1'),
        CHECK_TIMEOUT,
      );
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      this.logger.warn(
        `Database health check failed: ${(error as Error).message}`,
      );
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    try {
      const start = Date.now();
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT);
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      this.logger.warn(
        `Redis health check failed: ${(error as Error).message}`,
      );
      return { status: 'down' };
    }
  }

  private checkRabbitmq(): CheckResult {
    if (!this.rabbitConnection) {
      return { status: 'down' };
    }
    return { status: 'up' };
  }

  private async checkStorage(): Promise<CheckResult> {
    try {
      const start = Date.now();
      await withTimeout(
        this.s3.send(new HeadBucketCommand({ Bucket: this.bucket })),
        CHECK_TIMEOUT,
      );
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      this.logger.warn(
        `Storage health check failed: ${(error as Error).message}`,
      );
      return { status: 'down' };
    }
  }
}
