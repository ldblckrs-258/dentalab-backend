import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '@modules/config';
import {
  S3_CLIENT,
  DEFAULT_PRESIGNED_EXPIRY,
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DIMENSION,
  AVATAR_MAX_SIZE,
} from './storage.constants';
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

  private readonly publicBaseUrl: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: AppConfigService,
  ) {
    this.bucket = config.storage.S3_BUCKET;
    const base = config.storage.S3_PUBLIC_URL || config.storage.S3_ENDPOINT;
    this.publicBaseUrl = `${base.replace(/\/+$/, '')}/${this.bucket}`;
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
          'original-filename': encodeURIComponent(options.originalFilename),
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

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  isStorageKey(value: string): boolean {
    return !value.startsWith('http://') && !value.startsWith('https://');
  }

  resolveAvatarUrl(avatarUrl: string | null): string | null {
    if (!avatarUrl) return null;
    return this.isStorageKey(avatarUrl)
      ? this.getPublicUrl(avatarUrl)
      : avatarUrl;
  }

  async processAvatar(file: Buffer): Promise<Buffer> {
    validateFileSize(file.length, AVATAR_MAX_SIZE);

    const metadata = await sharp(file).metadata();
    const detectedMime = metadata.format
      ? `image/${metadata.format}`
      : 'unknown';
    validateMimeType(detectedMime, AVATAR_ALLOWED_MIME_TYPES);

    return sharp(file)
      .resize(AVATAR_DIMENSION, AVATAR_DIMENSION, {
        fit: 'cover',
        position: 'centre',
      })
      .webp({ quality: 85 })
      .toBuffer();
  }
}
