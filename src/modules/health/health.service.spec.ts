import { HealthService } from './health.service';
import type { PrismaService } from '@modules/database';
import type { AppConfigService } from '@modules/config';
import type Redis from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ChannelModel } from 'amqplib';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { baseClient: { $queryRawUnsafe: jest.Mock } };
  let redis: { ping: jest.Mock };
  let s3: { send: jest.Mock };

  beforeEach(() => {
    prisma = {
      baseClient: {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      },
    };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    s3 = { send: jest.fn().mockResolvedValue({}) };
    const config = { storage: { S3_BUCKET: 'test-bucket' } };
    const rabbitConnection = {};

    service = new HealthService(
      prisma as unknown as PrismaService,
      config as unknown as AppConfigService,
      redis as unknown as Redis,
      rabbitConnection as unknown as ChannelModel,
      s3 as unknown as S3Client,
    );
  });

  it('should return healthy when all services are up', async () => {
    const result = await service.checkReadiness();
    expect(result.status).toBe('healthy');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.rabbitmq.status).toBe('up');
    expect(result.checks.storage.status).toBe('up');
  });

  it('should return unhealthy when database is down', async () => {
    prisma.baseClient.$queryRawUnsafe.mockRejectedValue(new Error('db down'));
    const result = await service.checkReadiness();
    expect(result.status).toBe('unhealthy');
    expect(result.checks.database.status).toBe('down');
  });

  it('should return unhealthy when redis is down', async () => {
    redis.ping.mockRejectedValue(new Error('redis down'));
    const result = await service.checkReadiness();
    expect(result.status).toBe('unhealthy');
    expect(result.checks.redis.status).toBe('down');
  });

  it('should return degraded when rabbitmq is down', async () => {
    const config = { storage: { S3_BUCKET: 'test-bucket' } };
    service = new HealthService(
      prisma as unknown as PrismaService,
      config as unknown as AppConfigService,
      redis as unknown as Redis,
      null,
      s3 as unknown as S3Client,
    );
    const result = await service.checkReadiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.rabbitmq.status).toBe('down');
  });

  it('should return degraded when storage is down', async () => {
    s3.send.mockRejectedValue(new Error('s3 down'));
    const result = await service.checkReadiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.storage.status).toBe('down');
  });

  it('should include latency for successful checks', async () => {
    const result = await service.checkReadiness();
    expect(result.checks.database.latencyMs).toBeDefined();
    expect(typeof result.checks.database.latencyMs).toBe('number');
  });
});
