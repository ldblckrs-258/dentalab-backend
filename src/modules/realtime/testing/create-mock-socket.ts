import type { Server } from 'socket.io';

export function createMockSocket(
  overrides?: Partial<jest.Mocked<any>>,
): jest.Mocked<any> {
  return {
    id: `mock-${Date.now()}`,
    handshake: {
      headers: {},
      auth: {},
      address: '127.0.0.1',
      time: String(Date.now()),
      issued: undefined as unknown as number,
      url: '/',
      query: {},
      xdomain: false,
      secure: false,
    },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    rooms: new Set(),
    ...overrides,
  };
}

export function createMockServer(): jest.Mocked<Partial<Server>> {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: jest.fn().mockReturnThis(),
    disconnectSockets: jest.fn(),
    adapter: {} as any,
    of: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Partial<Server>>;
}

import { WsAuthService } from '../services';

export function mockWsAuthService(): jest.Mocked<Partial<WsAuthService>> {
  return {
    authenticate: jest.fn(),
  };
}
