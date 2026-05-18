import { Injectable, UsePipes } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import {
  AuthenticatedGateway,
  WsAuthService,
  WsMetricsService,
  WsLoggerService,
  WsRateLimitService,
  WsValidationPipe,
} from '@modules/realtime';
import type { AuthenticatedSocket } from '@modules/realtime';
import { AppConfigService } from '@modules/config';
import { PrismaService } from '@modules/database';
import { RagRooms } from './rag.rooms';
import { SubscribeDocDto } from './dto/subscribe-doc.dto';
import type { RagEvents, RagStatusEvent } from './rag.events';

const RAG_STATUS_VALUES = ['processing', 'completed', 'failed'] as const;
type RagStatusValue = (typeof RAG_STATUS_VALUES)[number];

function isRagStatusValue(value: string): value is RagStatusValue {
  return (RAG_STATUS_VALUES as readonly string[]).includes(value);
}

@WebSocketGateway({ namespace: '/documents' })
@Injectable()
export class RagGateway extends AuthenticatedGateway<RagEvents> {
  protected readonly namespace = '/documents';
  protected readonly requiredPermissions = ['internal_documents:update'];
  protected readonly logger = new WsLoggerService(RagGateway.name);

  constructor(
    wsAuth: WsAuthService,
    metrics: WsMetricsService,
    wsRateLimit: WsRateLimitService,
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super(wsAuth, metrics, wsRateLimit, config);
  }

  @SubscribeMessage('subscribe-doc')
  @UsePipes(new WsValidationPipe())
  async onSubscribeDoc(
    client: AuthenticatedSocket,
    dto: SubscribeDocDto,
  ): Promise<{ ok: true }> {
    await client.join(RagRooms.doc(dto.docId));
    await this.sendCurrentStatus(client, dto.docId);
    return { ok: true };
  }

  private async sendCurrentStatus(
    client: AuthenticatedSocket,
    docId: string,
  ): Promise<void> {
    try {
      const row = await this.prisma.baseClient.ragDocument.findFirst({
        where: { sourceType: 'internal_document', sourceId: docId },
        orderBy: { createdAt: 'desc' },
      });
      if (!row || !isRagStatusValue(row.status)) return;

      const event: RagStatusEvent = {
        sourceType: 'internal_document',
        sourceId: row.sourceId,
        ragDocumentId: row.id,
        status: row.status,
        occurredAt: row.updatedAt.toISOString(),
        ...(row.errorMessage != null && { errorMessage: row.errorMessage }),
        ...(row.totalParentChunks != null && {
          totalParentChunks: row.totalParentChunks,
        }),
        ...(row.totalChildChunks != null && {
          totalChildChunks: row.totalChildChunks,
        }),
        ...(row.ingestionTimeMs != null && {
          ingestionTimeMs: row.ingestionTimeMs,
        }),
        ...(row.contentHash != null && { contentHash: row.contentHash }),
      };
      client.emit('rag.status', event);
    } catch (err) {
      this.logger.warn(
        `ws.subscribe.catchup_failed docId=${docId}: ${(err as Error).message}`,
        {
          namespace: this.namespace,
          clientId: client.id,
        },
      );
    }
  }

  @SubscribeMessage('unsubscribe-doc')
  @UsePipes(new WsValidationPipe())
  async onUnsubscribeDoc(
    client: AuthenticatedSocket,
    dto: SubscribeDocDto,
  ): Promise<{ ok: true }> {
    await client.leave(RagRooms.doc(dto.docId));
    return { ok: true };
  }

  emitStatus(event: RagStatusEvent): void {
    this.emit(RagRooms.doc(event.sourceId), 'rag.status', event);
  }
}
