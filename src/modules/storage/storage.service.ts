import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '@modules/config';
import { S3_CLIENT, DEFAULT_PRESIGNED_EXPIRY } from './storage.constants';
import {
  buildObjectKey,
  validateFileSize,
  validateMimeType,
} from './storage.utils';

export interface UploadOptions {
  category: string;
  entityId: string;
  originalFilename: string;
  contentType: string;
  uploadedBy: string;
}

export interface StorageFile {
  url: string;
  key: string;
  size: number;
  contentType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: AppConfigService,
  ) {
    this.bucket = config.storage.S3_BUCKET;
  }

  async upload(file: Buffer, options: UploadOptions): Promise<StorageFile> {
    validateFileSize(file.length, this.config.storage.S3_MAX_FILE_SIZE);
    validateMimeType(options.contentType);

    const key = buildObjectKey(
      options.category,
      options.entityId,
      options.originalFilename,
    );

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: options.contentType,
        Metadata: {
          'uploaded-by': options.uploadedBy,
          'original-filename': options.originalFilename,
          'upload-timestamp': new Date().toISOString(),
          'entity-type': options.category,
        },
      }),
    );

    this.logger.debug(`Uploaded file: ${key}`);

    return {
      url: key,
      key,
      size: file.length,
      contentType: options.contentType,
    };
  }

  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number = DEFAULT_PRESIGNED_EXPIRY,
  ): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: expiresInSeconds,
    });

    return { uploadUrl, key };
  }

  async generatePresignedDownloadUrl(
    key: string,
    expiresInSeconds: number = DEFAULT_PRESIGNED_EXPIRY,
  ): Promise<{ downloadUrl: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: expiresInSeconds,
    });

    return { downloadUrl };
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.debug(`Deleted file: ${key}`);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
