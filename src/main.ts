import { AppValidationPipe } from '@common/pipes/app-validation.pipe';
import { AppConfigService, parseCorsOrigin } from '@modules/config';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '@modules/common/guards/rate-limit.guard';
import { PermissionGuard } from '@modules/rbac/guards/permission.guard';
import { RedisIoAdapter, WsExceptionFilter } from '@modules/realtime';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.set('trust proxy', 1);

  const config = app.get(AppConfigService);
  const { PORT, NODE_ENV, API_PREFIX, CORS_ORIGINS, APP_NAME } = config.app;

  app.setGlobalPrefix(API_PREFIX, {
    exclude: ['health/live', 'health/ready'],
  });

  app.use(cookieParser());

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.enableCors({
    origin: parseCorsOrigin(CORS_ORIGINS),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

  // WebSocket adapter with Redis pub/sub (production) or in-memory (dev)
  const wsAdapter = new RedisIoAdapter(app);
  await wsAdapter.connectToRedis(app);
  app.useWebSocketAdapter(wsAdapter);

  app.useGlobalFilters(new WsExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new AppValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalGuards(
    app.get(RateLimitGuard),
    app.get(JwtAuthGuard),
    app.get(PermissionGuard),
  );

  app.enableShutdownHooks();

  await app.listen(PORT);
  Logger.log(
    `${APP_NAME} running on port ${PORT} in ${NODE_ENV} mode`,
    'Bootstrap',
  );
}

void bootstrap();
