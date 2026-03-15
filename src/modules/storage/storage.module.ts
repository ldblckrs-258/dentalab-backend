import { Global, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigService } from '@modules/config';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './storage.constants';

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      useFactory: (config: AppConfigService): S3Client => {
        const storageConfig = config.storage;
        return new S3Client({
          endpoint: storageConfig.S3_ENDPOINT,
          region: storageConfig.S3_REGION,
          credentials: {
            accessKeyId: storageConfig.S3_ACCESS_KEY,
            secretAccessKey: storageConfig.S3_SECRET_KEY,
          },
          forcePathStyle: true,
        });
      },
      inject: [AppConfigService],
    },
    StorageService,
  ],
  exports: [StorageService, S3_CLIENT],
})
export class StorageModule {}
