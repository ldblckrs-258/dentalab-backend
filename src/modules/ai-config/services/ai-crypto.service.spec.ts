import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import { AppConfigService } from '@modules/config';
import { AiCryptoService } from './ai-crypto.service';

const VALID_KEY_B64 = crypto.randomBytes(32).toString('base64');

describe('AiCryptoService', () => {
  let service: AiCryptoService;

  beforeEach(async () => {
    const config = {
      ai: { AI_CONFIG_ENCRYPTION_KEY: VALID_KEY_B64 },
    } as unknown as AppConfigService;
    const module = await Test.createTestingModule({
      providers: [
        AiCryptoService,
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(AiCryptoService);
  });

  it('round-trips ASCII plaintext', () => {
    const enc = service.encrypt('hello-world');
    expect(service.decrypt(enc)).toBe('hello-world');
  });

  it('round-trips UTF-8 plaintext', () => {
    const enc = service.encrypt('Xin chào — 안녕');
    expect(service.decrypt(enc)).toBe('Xin chào — 안녕');
  });

  it('round-trips 4KB plaintext', () => {
    const plain = crypto.randomBytes(4096).toString('hex').slice(0, 4096);
    const enc = service.encrypt(plain);
    expect(service.decrypt(enc)).toBe(plain);
  });

  it('uses a fresh IV per call', () => {
    const a = service.encrypt('same-input');
    const b = service.encrypt('same-input');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects tampered ciphertext (auth tag failure)', () => {
    const enc = service.encrypt('payload');
    enc.ciphertext[0] = enc.ciphertext[0] ^ 0xff;
    expect(() => service.decrypt(enc)).toThrow();
  });

  it('rejects tampered IV', () => {
    const enc = service.encrypt('payload');
    enc.iv[0] = enc.iv[0] ^ 0xff;
    expect(() => service.decrypt(enc)).toThrow();
  });

  it('throws on malformed key length', async () => {
    const badConfig = {
      ai: { AI_CONFIG_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') },
    } as unknown as AppConfigService;
    const module = await Test.createTestingModule({
      providers: [
        AiCryptoService,
        { provide: AppConfigService, useValue: badConfig },
      ],
    }).compile();
    const bad = module.get(AiCryptoService);
    expect(() => bad.encrypt('x')).toThrow(/32 bytes/);
  });
});
