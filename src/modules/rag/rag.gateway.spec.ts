import { Test } from '@nestjs/testing';
import { RagGateway } from './rag.gateway';
import {
  WsAuthService,
  WsMetricsService,
  WsRateLimitService,
  createMockSocket,
} from '@modules/realtime';
import type { AuthenticatedSocket } from '@modules/realtime';
import { AppConfigService } from '@modules/config';
import { PrismaService } from '@modules/database';
import type { Server } from 'socket.io';
import type { RagStatusEvent } from './rag.events';

const makeStatusEvent = (
  overrides: Partial<RagStatusEvent> = {},
): RagStatusEvent => ({
  sourceType: 'internal_document',
  sourceId: 'doc-1',
  ragDocumentId: 'rag-1',
  status: 'completed',
  occurredAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('RagGateway', () => {
  let gateway: RagGateway;
  let wsAuth: any;
  let metrics: any;
  let wsRateLimit: any;
  let appConfig: any;
  let prisma: { baseClient: { ragDocument: { findFirst: jest.Mock } } };
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    wsAuth = { authenticate: jest.fn() };
    metrics = {
      incrementConnectionsOpened: jest.fn(),
      incrementConnectionsClosed: jest.fn(),
      incrementAuthFailures: jest.fn(),
      incrementRateLimitRejections: jest.fn(),
    };
    wsRateLimit = { checkHandshake: jest.fn(), checkEvent: jest.fn() };
    appConfig = { ws: { WS_DRAIN_MS: 0 } };
    prisma = {
      baseClient: {
        ragDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    };
    mockServer = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RagGateway,
        { provide: WsAuthService, useValue: wsAuth },
        { provide: WsMetricsService, useValue: metrics },
        { provide: WsRateLimitService, useValue: wsRateLimit },
        { provide: AppConfigService, useValue: appConfig },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get(RagGateway);
    gateway['server'] = mockServer as unknown as Server;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onSubscribeDoc', () => {
    it('joins room and returns ok (handshake perm is the only gate)', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      const result = await gateway.onSubscribeDoc(
        client as unknown as AuthenticatedSocket,
        { docId: 'doc-1' },
      );

      expect(result).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith('doc:doc-1');
    });

    it('emits catch-up rag.status to subscriber when row exists', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      const updatedAt = new Date('2024-02-02T03:04:05.000Z');
      prisma.baseClient.ragDocument.findFirst.mockResolvedValueOnce({
        id: 'rag-1',
        sourceType: 'internal_document',
        sourceId: 'doc-1',
        status: 'processing',
        errorMessage: null,
        totalParentChunks: null,
        totalChildChunks: null,
        ingestionTimeMs: null,
        contentHash: 'abc',
        updatedAt,
      });

      await gateway.onSubscribeDoc(client as unknown as AuthenticatedSocket, {
        docId: 'doc-1',
      });

      expect(prisma.baseClient.ragDocument.findFirst).toHaveBeenCalledWith({
        where: { sourceType: 'internal_document', sourceId: 'doc-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(client.emit).toHaveBeenCalledWith('rag.status', {
        sourceType: 'internal_document',
        sourceId: 'doc-1',
        ragDocumentId: 'rag-1',
        status: 'processing',
        occurredAt: updatedAt.toISOString(),
        contentHash: 'abc',
      });
    });

    it('skips catch-up when no row exists', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      await gateway.onSubscribeDoc(client as unknown as AuthenticatedSocket, {
        docId: 'doc-1',
      });

      expect(client.emit).not.toHaveBeenCalled();
    });

    it('does not throw when catch-up query fails', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.baseClient.ragDocument.findFirst.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        gateway.onSubscribeDoc(client as unknown as AuthenticatedSocket, {
          docId: 'doc-1',
        }),
      ).resolves.toEqual({ ok: true });
      expect(client.emit).not.toHaveBeenCalled();
    });
  });

  describe('emitStatus', () => {
    it('broadcasts rag.status to correct doc room', () => {
      const event = makeStatusEvent({ sourceId: 'doc-42' });

      gateway.emitStatus(event);

      expect(mockServer.to).toHaveBeenCalledWith('doc:doc-42');
      expect(mockServer.emit).toHaveBeenCalledWith('rag.status', event);
    });
  });

  describe('onUnsubscribeDoc', () => {
    it('leaves doc room and returns ok', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      const result = await gateway.onUnsubscribeDoc(
        client as unknown as AuthenticatedSocket,
        { docId: 'doc-1' },
      );

      expect(result).toEqual({ ok: true });
      expect(client.leave).toHaveBeenCalledWith('doc:doc-1');
    });
  });
});
