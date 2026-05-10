import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { AppConfigService } from './config.service';
import { appSchema } from './schemas/app.schema';
import { databaseSchema } from './schemas/database.schema';
import { redisSchema } from './schemas/redis.schema';
import { queueSchema } from './schemas/queue.schema';
import { storageSchema } from './schemas/storage.schema';
import { jwtSchema } from './schemas/jwt.schema';
import { aiSchema } from './schemas/ai.schema';
import { emailSchema } from './schemas/email.schema';
import { wsSchema } from './schemas/ws.schema';
import { maskSensitiveValues } from './config.utils';

const logger = new Logger('ConfigModule');

function validateAndLoad<T>(
  schema: { parse: (data: unknown) => T },
  env: Record<string, unknown>,
): T {
  return schema.parse(env);
}

const appConfig = registerAs('app', () =>
  validateAndLoad(appSchema, process.env),
);
const databaseConfig = registerAs('database', () =>
  validateAndLoad(databaseSchema, process.env),
);
const redisConfig = registerAs('redis', () =>
  validateAndLoad(redisSchema, process.env),
);
const queueConfig = registerAs('queue', () =>
  validateAndLoad(queueSchema, process.env),
);
const storageConfig = registerAs('storage', () =>
  validateAndLoad(storageSchema, process.env),
);
const jwtConfig = registerAs('jwt', () =>
  validateAndLoad(jwtSchema, process.env),
);
const aiConfig = registerAs('ai', () => validateAndLoad(aiSchema, process.env));
const emailConfig = registerAs('email', () =>
  validateAndLoad(emailSchema, process.env),
);
const wsConfig = registerAs('ws', () => validateAndLoad(wsSchema, process.env));

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        queueConfig,
        storageConfig,
        jwtConfig,
        aiConfig,
        emailConfig,
        wsConfig,
      ],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {
  constructor(configService: AppConfigService) {
    logger.log('Configuration loaded successfully');

    if (configService.isDevelopment) {
      const allConfig = {
        app: configService.app,
        database: configService.database,
        redis: configService.redis,
        queue: configService.queue,
        storage: configService.storage,
        jwt: configService.jwt,
        ai: configService.ai,
        email: configService.email,
        ws: configService.ws,
      };
      logger.debug(
        `Config: ${JSON.stringify(maskSensitiveValues(allConfig as Record<string, unknown>), null, 2)}`,
      );
    }
  }
}
