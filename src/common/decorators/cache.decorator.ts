import { SetMetadata } from '@nestjs/common';

export const CACHE_ENDPOINT_KEY = 'cache_endpoint';
export const CACHE_INVALIDATE_KEY = 'cache_invalidate';

export interface CacheEndpointOptions {
  domain: string;
  ttl?: number;
}

export function CacheEndpoint(options: CacheEndpointOptions) {
  return SetMetadata(CACHE_ENDPOINT_KEY, options);
}

export function InvalidateCache(domain: string) {
  return SetMetadata(CACHE_INVALIDATE_KEY, domain);
}
