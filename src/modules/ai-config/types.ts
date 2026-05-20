export type ProviderKind = 'openai' | 'gemini' | 'anthropic';

export type ModelRole = 'answer' | 'rewrite';

export interface ResolvedModelMeta {
  modelId: string;
  providerId: string;
  providerKind: ProviderKind;
  baseUrl: string | null;
  modelName: string;
  userInstruction: string | null;
  temperature: number;
  topP: number | null;
  maxTokens: number | null;
  ragTopK: number | null;
  historyWindow: number | null;
}

export interface ResolvedModel {
  meta: ResolvedModelMeta;
  decryptedApiKey: string;
}

export interface AiModelRow {
  id: string;
  providerId: string;
  role: string;
  modelName: string;
  displayName: string;
  userInstruction: string | null;
  temperature: number;
  topP: number | null;
  maxTokens: number | null;
  ragTopK: number | null;
  historyWindow: number | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
