import { Test } from '@nestjs/testing';
import { SchedulingGateway } from './scheduling.gateway';
import {
  WsAuthService,
  WsMetricsService,
  WsRateLimitService,
  createMockSocket,
} from '@modules/realtime';
import type { AuthenticatedSocket } from '@modules/realtime';
import { AppConfigService } from '@modules/config';
import type { Server } from 'socket.io';

describe('SchedulingGateway', () => {
  let gateway: SchedulingGateway;
  let wsAuth: any;
  let metrics: any;
  let wsRateLimit: any;
  let appConfig: any;
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    wsAuth = {
      authenticate: jest.fn(),
    } as any;
    metrics = {
      incrementConnectionsOpened: jest.fn(),
      incrementConnectionsClosed: jest.fn(),
      incrementAuthFailures: jest.fn(),
      incrementRateLimitRejections: jest.fn(),
    } as any;
    wsRateLimit = {
      checkHandshake: jest.fn(),
      checkEvent: jest.fn(),
    } as any;
    appConfig = { ws: { WS_DRAIN_MS: 0 } } as any;
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulingGateway,
        { provide: WsAuthService, useValue: wsAuth },
        { provide: WsMetricsService, useValue: metrics },
        { provide: WsRateLimitService, useValue: wsRateLimit },
        { provide: AppConfigService, useValue: appConfig },
      ],
    }).compile();

    gateway = module.get(SchedulingGateway);
    gateway['server'] = mockServer as unknown as Server;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleConnection', () => {
    function clientWithToken(token: string | null) {
      return createMockSocket({
        handshake: {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          auth: {},
          address: '127.0.0.1',
        },
      });
    }

    it('should disconnect when handshake rate limited', async () => {
      wsRateLimit.checkHandshake.mockResolvedValue(false);
      const mockClient = clientWithToken('valid-token');

      await gateway.handleConnection(
        mockClient as unknown as AuthenticatedSocket,
      );

      expect(wsRateLimit.checkHandshake).toHaveBeenCalled();
      expect(metrics.incrementRateLimitRejections).toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(wsAuth.authenticate).not.toHaveBeenCalled();
    });

    it('should disconnect when no token provided', async () => {
      wsRateLimit.checkHandshake.mockResolvedValue(true);
      const mockClient = clientWithToken(null);
      await gateway.handleConnection(
        mockClient as unknown as AuthenticatedSocket,
      );

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should disconnect when auth fails', async () => {
      wsRateLimit.checkHandshake.mockResolvedValue(true);
      wsAuth.authenticate.mockRejectedValue(new Error('WS_NO_TOKEN'));
      const mockClient = clientWithToken('valid-token');
      await gateway.handleConnection(
        mockClient as unknown as AuthenticatedSocket,
      );

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('should join schedule room and set userId when authorized', async () => {
      wsRateLimit.checkHandshake.mockResolvedValue(true);
      wsAuth.authenticate.mockResolvedValue({
        userId: 'user-1',
        payload: { sub: 'user-1' } as any,
      });
      const mockClient = clientWithToken('valid-token');
      await gateway.handleConnection(
        mockClient as unknown as AuthenticatedSocket,
      );

      expect(mockClient.join).toHaveBeenCalled();
      expect(mockClient.data.userId).toBe('user-1');
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('emitScheduleUpdated', () => {
    it('should emit to schedule:readers room', () => {
      const event = {
        providerId: 'provider-1',
        effectFrom: '2026-05-10T00:00:00.000Z',
        effectTo: null,
      };
      gateway.emitScheduleUpdated(event);

      expect(mockServer.to).toHaveBeenCalledWith('schedule:readers');
      expect(mockServer.emit).toHaveBeenCalledWith('schedule.updated', event);
    });
  });

  describe('emitOverrideRequested', () => {
    it('should emit to schedule:readers room', () => {
      const event = {
        id: 'override-1',
        providerId: 'provider-1',
        specificDate: '2026-05-15',
      };
      gateway.emitOverrideRequested(event);

      expect(mockServer.to).toHaveBeenCalledWith('schedule:readers');
      expect(mockServer.emit).toHaveBeenCalledWith('override.requested', event);
    });
  });

  describe('emitOverrideReviewed', () => {
    it('should emit to schedule:readers room', () => {
      gateway.emitOverrideReviewed({
        id: 'override-1',
        status: 'approved',
        reviewerId: 'user-1',
      });

      expect(mockServer.to).toHaveBeenCalledWith('schedule:readers');
      expect(mockServer.emit).toHaveBeenCalledWith('override.reviewed', {
        id: 'override-1',
        status: 'approved',
        reviewerId: 'user-1',
      });
    });
  });
});
