import { AsyncLocalStorage } from 'async_hooks';
import type { RequestContext } from '@common/interfaces';

const storage = new AsyncLocalStorage<RequestContext>();

export class RequestContextService {
  static run(context: RequestContext, fn: () => void): void {
    storage.run(context, fn);
  }

  static getCurrentContext(): RequestContext | undefined {
    return storage.getStore();
  }

  static getUserId(): string | undefined {
    return storage.getStore()?.userId;
  }

  static getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  }

  static getIp(): string | undefined {
    return storage.getStore()?.ip;
  }

  static getStorage(): AsyncLocalStorage<RequestContext> {
    return storage;
  }
}
