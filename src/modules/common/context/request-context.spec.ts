import { RequestContextService } from './request-context';
import type { RequestContext } from '@common/interfaces';

describe('RequestContextService', () => {
  const mockContext: RequestContext = {
    userId: 'user-1',
    requestId: 'req-123',
    ip: '127.0.0.1',
    timestamp: new Date('2024-01-01'),
  };

  it('should return undefined outside of a run context', () => {
    expect(RequestContextService.getCurrentContext()).toBeUndefined();
    expect(RequestContextService.getUserId()).toBeUndefined();
    expect(RequestContextService.getRequestId()).toBeUndefined();
    expect(RequestContextService.getIp()).toBeUndefined();
  });

  it('should provide context within run', (done) => {
    RequestContextService.run(mockContext, () => {
      expect(RequestContextService.getCurrentContext()).toEqual(mockContext);
      expect(RequestContextService.getUserId()).toBe('user-1');
      expect(RequestContextService.getRequestId()).toBe('req-123');
      expect(RequestContextService.getIp()).toBe('127.0.0.1');
      done();
    });
  });

  it('should isolate context between runs', (done) => {
    let innerResult: string | undefined;
    let outerResult: string | undefined;

    RequestContextService.run({ ...mockContext, userId: 'outer' }, () => {
      outerResult = RequestContextService.getUserId();

      RequestContextService.run({ ...mockContext, userId: 'inner' }, () => {
        innerResult = RequestContextService.getUserId();
      });
    });

    setImmediate(() => {
      expect(outerResult).toBe('outer');
      expect(innerResult).toBe('inner');
      done();
    });
  });

  it('should return the AsyncLocalStorage instance', () => {
    const storage = RequestContextService.getStorage();
    expect(storage).toBeDefined();
    expect(typeof storage.run).toBe('function');
  });
});
