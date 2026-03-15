import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigService } from '@modules/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(AppConfigService);
  const { PORT, NODE_ENV, API_PREFIX, CORS_ORIGINS, APP_NAME } = config.app;

  // Global prefix
  app.setGlobalPrefix(API_PREFIX, {
    exclude: ['health/live', 'health/ready'],
  });

  // CORS
  app.enableCors({
    origin: CORS_ORIGINS === '*' ? true : CORS_ORIGINS.split(','),
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(PORT);
  Logger.log(
    `${APP_NAME} running on port ${PORT} in ${NODE_ENV} mode`,
    'Bootstrap',
  );
}

void bootstrap();
