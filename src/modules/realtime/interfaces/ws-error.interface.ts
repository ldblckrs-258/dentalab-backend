export const WsErrorCode = {
  WS_NO_TOKEN: 'WS_NO_TOKEN',
  WS_INVALID_TOKEN: 'WS_INVALID_TOKEN',
  WS_NO_PERMISSION: 'WS_NO_PERMISSION',
  WS_RATE_LIMITED: 'WS_RATE_LIMITED',
  WS_VALIDATION_ERROR: 'WS_VALIDATION_ERROR',
  WS_UNAUTHORIZED: 'WS_UNAUTHORIZED',
  WS_INTERNAL_ERROR: 'WS_INTERNAL_ERROR',
} as const;

export type WsErrorCodeType = (typeof WsErrorCode)[keyof typeof WsErrorCode];

export interface WsErrorFrame {
  event: 'ws:error';
  code: WsErrorCodeType;
  message: string;
  details?: unknown;
}
