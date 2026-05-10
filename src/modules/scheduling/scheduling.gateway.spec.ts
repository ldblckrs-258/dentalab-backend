import { Test } from '@nestjs/testing';
import { SchedulingGateway } from './scheduling.gateway';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '@modules/config';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import type { Socket } from 'socket.io';

describe('SchedulingGateway', () => {
  let gateway: SchedulingGateway;
  let jwtService: any;
  let permissionResolver: any;
  let mockServer: any;

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    permissionResolver = { hasAnyPermission: jest.fn() };
    mockServer = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };

    const module = await Test.createTestingModule({
      providers: [
        SchedulingGateway,
        { provide: JwtService, useValue: jwtService },
        {
          provide: AppConfigService,
          useValue: { jwt: { JWT_SECRET: 'test-secret' } },
        },
        { provide: PermissionResolverService, useValue: permissionResolver },
      ],
    }).compile();

    gateway = module.get(SchedulingGateway);
    gateway['server'] = mockServer;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleConnection', () => {
    it('should disconnect when no token provided', async () => {
      const mockClient = {
        handshake: { headers: {}, auth: {} },
        disconnect: jest.fn(),
        data: {},
        join: jest.fn(),
      } satisfies Record<string, unknown>;

      await gateway.handleConnection(mockClient as unknown as Socket);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should disconnect when token is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      const mockClient = {
        handshake: {
          headers: { authorization: 'Bearer invalid-token' },
          auth: {},
        },
        disconnect: jest.fn(),
        data: {},
        join: jest.fn(),
      } satisfies Record<string, unknown>;

      await gateway.handleConnection(mockClient as unknown as Socket);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should disconnect when user lacks read permission', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      permissionResolver.hasAnyPermission.mockResolvedValue(false);

      const mockClient = {
        handshake: {
          headers: { authorization: 'Bearer valid-token' },
          auth: {},
        },
        disconnect: jest.fn(),
        data: {},
        join: jest.fn(),
      } satisfies Record<string, unknown>;

      await gateway.handleConnection(mockClient as unknown as Socket);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should join schedule room when authorized', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      permissionResolver.hasAnyPermission.mockResolvedValue(true);

      const mockClient = {
        handshake: {
          headers: { authorization: 'Bearer valid-token' },
          auth: {},
        },
        disconnect: jest.fn(),
        data: {},
        join: jest.fn(),
      } satisfies Record<string, unknown>;

      await gateway.handleConnection(mockClient as unknown as Socket);

      expect(mockClient.join).toHaveBeenCalled();
      expect(mockClient.data.userId).toBe('user-1');
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('emitScheduleUpdated', () => {
    it('should emit to schedule-readers room', () => {
      const event = {
        providerId: 'provider-1',
        effectFrom: '2026-05-10T00:00:00.000Z',
        effectTo: null,
      };
      gateway.emitScheduleUpdated(event);

      expect(mockServer.to).toHaveBeenCalledWith('schedule-readers');
      expect(mockServer.to().emit).toHaveBeenCalledWith(
        'schedule.updated',
        event,
      );
    });
  });

  describe('emitOverrideRequested', () => {
    it('should emit to schedule-readers room', () => {
      const event = {
        id: 'override-1',
        providerId: 'provider-1',
        specificDate: '2026-05-15',
      };
      gateway.emitOverrideRequested(event);

      expect(mockServer.to).toHaveBeenCalledWith('schedule-readers');
      expect(mockServer.to().emit).toHaveBeenCalledWith(
        'override.requested',
        event,
      );
    });
  });

  describe('emitOverrideReviewed', () => {
    it('should emit to schedule-readers room', () => {
      gateway.emitOverrideReviewed({
        id: 'override-1',
        status: 'approved',
        reviewerId: 'user-1',
      });

      expect(mockServer.to).toHaveBeenCalledWith('schedule-readers');
      expect(mockServer.to().emit).toHaveBeenCalledWith('override.reviewed', {
        id: 'override-1',
        status: 'approved',
        reviewerId: 'user-1',
      });
    });
  });
});
