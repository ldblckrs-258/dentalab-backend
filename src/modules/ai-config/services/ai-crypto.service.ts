import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@modules/config';
import {
  encryptSecret,
  decryptSecret,
  type EncryptedSecret,
} from '@common/utils';

@Injectable()
export class AiCryptoService {
  private readonly key: string;

  constructor(config: AppConfigService) {
    this.key = config.ai.AI_CONFIG_ENCRYPTION_KEY;
  }

  encrypt(plain: string): EncryptedSecret {
    return encryptSecret(plain, this.key);
  }

  decrypt(enc: EncryptedSecret): string {
    return decryptSecret(enc, this.key);
  }
}
