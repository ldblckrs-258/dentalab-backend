import { Test } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';

describe('CacheService', () => {
  let service: CacheService;
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [CacheService, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    service = module.get(CacheService);
  });

  describe('get', () => {
    it('should return parsed JSON value', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ name: 'test' }));
      const result = await service.get('auth', 'user-1');
      expect(result).toEqual({ name: 'test' });
      expect(redis.get).toHaveBeenCalledWith('dentalab:auth:user-1');
    });

    it('should return null when key does not exist', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.get('auth', 'missing')).toBeNull();
    });

    it('should return null on error (non-critical)', async () => {
      redis.get.mockRejectedValue(new Error('connection lost'));
      expect(await service.get('auth', 'key')).toBeNull();
    });

    it('should throw on error when critical=true', async () => {
      redis.get.mockRejectedValue(new Error('connection lost'));
      await expect(service.get('auth', 'key', true)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('set', () => {
    it('should serialize and set with TTL', async () => {
      await service.set('auth', 'user-1', { data: 'value' }, 600);
      expect(redis.setex).toHaveBeenCalledWith(
        'dentalab:auth:user-1',
        600,
        JSON.stringify({ data: 'value' }),
      );
    });

    it('should use default TTL', async () => {
      await service.set('auth', 'user-1', 'val');
      expect(redis.setex).toHaveBeenCalledWith(
        'dentalab:auth:user-1',
        300,
        JSON.stringify('val'),
      );
    });

    it('should silently handle errors', async () => {
      redis.setex.mockRejectedValue(new Error('write failed'));
      await expect(service.set('auth', 'key', 'val')).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('should delete the correct key', async () => {
      await service.del('auth', 'user-1');
      expect(redis.del).toHaveBeenCalledWith('dentalab:auth:user-1');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      redis.exists.mockResolvedValue(1);
      expect(await service.exists('auth', 'user-1')).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      redis.exists.mockResolvedValue(0);
      expect(await service.exists('auth', 'user-1')).toBe(false);
    });

    it('should return false on error', async () => {
      redis.exists.mockRejectedValue(new Error('fail'));
      expect(await service.exists('auth', 'key')).toBe(false);
    });
  });

  describe('setWithNX', () => {
    it('should return true when key was set', async () => {
      redis.set.mockResolvedValue('OK');
      const result = await service.setWithNX(
        'lock',
        'resource-1',
        'locked',
        30,
      );
      expect(result).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'dentalab:lock:resource-1',
        JSON.stringify('locked'),
        'EX',
        30,
        'NX',
      );
    });

    it('should return false when key already exists', async () => {
      redis.set.mockResolvedValue(null);
      expect(await service.setWithNX('lock', 'r1', 'v', 30)).toBe(false);
    });
  });

  describe('increment', () => {
    it('should increment and set expire on first call', async () => {
      redis.incr.mockResolvedValue(1);
      const result = await service.increment('rate_limit', 'key', 60);
      expect(result).toBe(1);
      expect(redis.expire).toHaveBeenCalledWith('dentalab:rate_limit:key', 60);
    });

    it('should not set expire on subsequent increments', async () => {
      redis.incr.mockResolvedValue(5);
      await service.increment('rate_limit', 'key', 60);
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('should return 0 on error', async () => {
      redis.incr.mockRejectedValue(new Error('fail'));
      expect(await service.increment('rate_limit', 'key', 60)).toBe(0);
    });
  });
});
