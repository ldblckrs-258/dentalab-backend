import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { AppConfigService, parseCorsOrigin } from '@modules/config';
import { REDIS_CLIENT } from '@modules/redis/redis.constants';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private config: AppConfigService | null = null;

  async connectToRedis(app: INestApplicationContext): Promise<void> {
    this.config = app.get(AppConfigService);
    const baseClient = app.get<Redis>(REDIS_CLIENT);

    this.pubClient = baseClient.duplicate();
    this.subClient = baseClient.duplicate();

    await Promise.all([this.pubClient.ping(), this.subClient.ping()]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient, {
      key: 'dentalab:ws',
    });
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const cfg = this.config;
    const corsOrigins = cfg?.app.CORS_ORIGINS;
    const pingInterval = cfg?.ws?.WS_PING_INTERVAL_MS ?? 25000;
    const pingTimeout = cfg?.ws?.WS_PING_TIMEOUT_MS ?? 60000;

    const server = super.createIOServer(port, {
      ...options,
      pingInterval,
      pingTimeout,
      cors: {
        origin: corsOrigins ? parseCorsOrigin(corsOrigins) : false,
        credentials: true,
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }

  async disconnectFromRedis(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
