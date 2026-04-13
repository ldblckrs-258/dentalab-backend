import { AppValidationPipe } from '@common/pipes/app-validation.pipe';
import { AppConfigService } from '@modules/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const config = app.get(AppConfigService);
  const { PORT, NODE_ENV, API_PREFIX, CORS_ORIGINS, APP_NAME } = config.app;

  // Global prefix
  app.setGlobalPrefix(API_PREFIX, {
    exclude: ['health/live', 'health/ready'],
  });

  // Cookie parser
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: CORS_ORIGINS === '*' ? true : CORS_ORIGINS.split(','),
    credentials: true,
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

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(PORT);
  Logger.log(
    `${APP_NAME} running on port ${PORT} in ${NODE_ENV} mode`,
    'Bootstrap',
  );
}

void bootstrap();
