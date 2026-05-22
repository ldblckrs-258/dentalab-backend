import { Test } from '@nestjs/testing';
import { ClinicalNoteRagGateway } from './rag.clinical-note.gateway';
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
  sourceType: 'clinical_note',
  sourceId: 'note-1',
  ragDocumentId: 'rag-1',
  status: 'completed',
  occurredAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('ClinicalNoteRagGateway', () => {
  let gateway: ClinicalNoteRagGateway;
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
        ClinicalNoteRagGateway,
        { provide: WsAuthService, useValue: wsAuth },
        { provide: WsMetricsService, useValue: metrics },
        { provide: WsRateLimitService, useValue: wsRateLimit },
        { provide: AppConfigService, useValue: appConfig },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get(ClinicalNoteRagGateway);
    gateway['server'] = mockServer as unknown as Server;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onSubscribeNote', () => {
    it('joins scoped room for clinical_note', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      const result = await gateway.onSubscribeNote(
        client as unknown as AuthenticatedSocket,
        { noteId: 'note-1' },
      );

      expect(result).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith('clinical_note:note-1');
    });

    it('emits catch-up rag.status when row exists', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      const updatedAt = new Date('2024-02-02T03:04:05.000Z');
      prisma.baseClient.ragDocument.findFirst.mockResolvedValueOnce({
        id: 'rag-1',
        sourceType: 'clinical_note',
        sourceId: 'note-1',
        status: 'processing',
        errorMessage: null,
        totalParentChunks: null,
        totalChildChunks: null,
        ingestionTimeMs: null,
        contentHash: 'abc',
        updatedAt,
      });

      await gateway.onSubscribeNote(client as unknown as AuthenticatedSocket, {
        noteId: 'note-1',
      });

      expect(prisma.baseClient.ragDocument.findFirst).toHaveBeenCalledWith({
        where: { sourceType: 'clinical_note', sourceId: 'note-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(client.emit).toHaveBeenCalledWith('rag.status', {
        sourceType: 'clinical_note',
        sourceId: 'note-1',
        ragDocumentId: 'rag-1',
        status: 'processing',
        occurredAt: updatedAt.toISOString(),
        contentHash: 'abc',
      });
    });

    it('skips catch-up when no row exists', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      await gateway.onSubscribeNote(client as unknown as AuthenticatedSocket, {
        noteId: 'note-1',
      });

      expect(client.emit).not.toHaveBeenCalled();
    });

    it('does not throw when catch-up query fails', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.baseClient.ragDocument.findFirst.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        gateway.onSubscribeNote(client as unknown as AuthenticatedSocket, {
          noteId: 'note-1',
        }),
      ).resolves.toEqual({ ok: true });
      expect(client.emit).not.toHaveBeenCalled();
    });
  });

  describe('emitStatus', () => {
    it('broadcasts rag.status to scoped clinical_note room', () => {
      const event = makeStatusEvent({ sourceId: 'note-42' });

      gateway.emitStatus(event);

      expect(mockServer.to).toHaveBeenCalledWith('clinical_note:note-42');
      expect(mockServer.emit).toHaveBeenCalledWith('rag.status', event);
    });
  });

  describe('onUnsubscribeNote', () => {
    it('leaves scoped room and returns ok', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      const result = await gateway.onUnsubscribeNote(
        client as unknown as AuthenticatedSocket,
        { noteId: 'note-1' },
      );

      expect(result).toEqual({ ok: true });
      expect(client.leave).toHaveBeenCalledWith('clinical_note:note-1');
    });
  });

  describe('namespace permission', () => {
    it('requires only clinical_notes:read at handshake', () => {
      expect(gateway['requiredPermissions']).toEqual(['clinical_notes:read']);
    });

    it('uses /clinical-notes namespace', () => {
      expect(gateway['namespace']).toBe('/clinical-notes');
    });
  });
});
