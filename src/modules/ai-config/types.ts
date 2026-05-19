export type ProviderKind = 'openai' | 'gemini' | 'anthropic';

export type ModelRole = 'answer' | 'rewrite';

export interface ResolvedModelMeta {
  modelId: string;
  providerId: string;
  providerKind: ProviderKind;
  baseUrl: string | null;
  modelName: string;
  systemPrompt: string;
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
  systemPrompt: string;
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
