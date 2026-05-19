import type { ProviderKind } from '../types';

interface AiProviderRow {
  id: string;
  name: string;
  provider: string;
  apiKeyLast4: string | null;
  baseUrl: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderResponseDto {
  id: string;
  name: string;
  provider: ProviderKind;
  apiKeyMasked: string;
  baseUrl: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toProviderResponse(row: AiProviderRow): ProviderResponseDto {
  const last4 = row.apiKeyLast4 ?? '';
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ProviderKind,
    apiKeyMasked: last4 ? `••••${last4}` : '••••',
    baseUrl: row.baseUrl,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
