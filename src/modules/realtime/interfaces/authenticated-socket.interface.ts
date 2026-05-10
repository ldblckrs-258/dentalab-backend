import type { Socket } from 'socket.io';

export interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    [key: string]: unknown;
  };
}

export interface WsAuthResult {
  userId: string;
  permissions: string[];
}
