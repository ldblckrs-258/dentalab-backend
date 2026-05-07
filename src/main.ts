import { AppValidationPipe } from '@common/pipes/app-validation.pipe';
import { AppConfigService } from '@modules/config';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '@modules/common/guards/rate-limit.guard';
import { PermissionGuard } from '@modules/rbac/guards/permission.guard';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const config = app.get(AppConfigService);
  const { PORT, NODE_ENV, API_PREFIX, CORS_ORIGINS, APP_NAME } = config.app;

  app.setGlobalPrefix(API_PREFIX, {
    exclude: ['health/live', 'health/ready'],
  });

  app.use(cookieParser());

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.enableCors({
    origin: CORS_ORIGINS === '*' ? true : CORS_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

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
