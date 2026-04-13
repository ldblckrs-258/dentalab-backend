import { ArgumentMetadata } from '@nestjs/common';
import { I18nValidationPipe, I18nValidationPipeOptions } from 'nestjs-i18n';

export class AppValidationPipe extends I18nValidationPipe {
  constructor(options?: I18nValidationPipeOptions) {
    super(options);
  }

  async transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type === 'query' && typeof value === 'object' && value) {
      value = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([, v]) => v !== '',
        ),
      );
    }
    return super.transform(value, metadata);
  }
}
