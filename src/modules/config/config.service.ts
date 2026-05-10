import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './schemas/app.schema';
import type { DatabaseConfig } from './schemas/database.schema';
import type { RedisConfig } from './schemas/redis.schema';
import type { QueueConfig } from './schemas/queue.schema';
import type { StorageConfig } from './schemas/storage.schema';
import type { JwtConfig } from './schemas/jwt.schema';
import type { AiConfig } from './schemas/ai.schema';
import type { EmailConfig } from './schemas/email.schema';
import type { WsConfig } from './schemas/ws.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get app(): AppConfig {
    return this.configService.get<AppConfig>('app')!;
  }

  get database(): DatabaseConfig {
    return this.configService.get<DatabaseConfig>('database')!;
  }

  get redis(): RedisConfig {
    return this.configService.get<RedisConfig>('redis')!;
  }

  get queue(): QueueConfig {
    return this.configService.get<QueueConfig>('queue')!;
  }

  get storage(): StorageConfig {
    return this.configService.get<StorageConfig>('storage')!;
  }

  get jwt(): JwtConfig {
    return this.configService.get<JwtConfig>('jwt')!;
  }

  get ai(): AiConfig {
    return this.configService.get<AiConfig>('ai')!;
  }

  get email(): EmailConfig {
    return this.configService.get<EmailConfig>('email')!;
  }

  get ws(): WsConfig {
    return this.configService.get<WsConfig>('ws')!;
  }

  get isDevelopment(): boolean {
    return this.app.NODE_ENV === 'development';
  }

  get isProduction(): boolean {
    return this.app.NODE_ENV === 'production';
  }
}
