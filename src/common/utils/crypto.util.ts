import * as crypto from 'crypto';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptSecret(plain: string, keyB64: string): EncryptedSecret {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY must decode to 32 bytes');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decryptSecret(enc: EncryptedSecret, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY must decode to 32 bytes');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, enc.iv);
  decipher.setAuthTag(enc.tag);
  const plain = Buffer.concat([
    decipher.update(enc.ciphertext),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
