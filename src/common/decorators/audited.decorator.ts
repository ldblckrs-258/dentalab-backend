import { SetMetadata } from '@nestjs/common';
import { AUDITED_KEY } from '@common/constants';

export const Audited = (resourceName: string) =>
  SetMetadata(AUDITED_KEY, resourceName);
