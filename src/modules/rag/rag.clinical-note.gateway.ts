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
import { SubscribeNoteDto } from './dto/subscribe-note.dto';
import type { RagEvents, RagStatusEvent } from './rag.events';

const RAG_STATUS_VALUES = ['processing', 'completed', 'failed'] as const;
type RagStatusValue = (typeof RAG_STATUS_VALUES)[number];

function isRagStatusValue(value: string): value is RagStatusValue {
  return (RAG_STATUS_VALUES as readonly string[]).includes(value);
}

@WebSocketGateway({ namespace: '/clinical-notes' })
@Injectable()
export class ClinicalNoteRagGateway extends AuthenticatedGateway<RagEvents> {
  protected readonly namespace = '/clinical-notes';
  protected readonly requiredPermissions = ['clinical_notes:read'];
  protected readonly logger = new WsLoggerService(ClinicalNoteRagGateway.name);

  constructor(
    wsAuth: WsAuthService,
    metrics: WsMetricsService,
    wsRateLimit: WsRateLimitService,
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super(wsAuth, metrics, wsRateLimit, config);
  }

  @SubscribeMessage('subscribe-note')
  @UsePipes(new WsValidationPipe())
  async onSubscribeNote(
    client: AuthenticatedSocket,
    dto: SubscribeNoteDto,
  ): Promise<{ ok: true }> {
    await client.join(RagRooms.scoped('clinical_note', dto.noteId));
    await this.sendCurrentStatus(client, dto.noteId);
    return { ok: true };
  }

  private async sendCurrentStatus(
    client: AuthenticatedSocket,
    noteId: string,
  ): Promise<void> {
    try {
      const row = await this.prisma.baseClient.ragDocument.findFirst({
        where: { sourceType: 'clinical_note', sourceId: noteId },
        orderBy: { createdAt: 'desc' },
      });
      if (!row || !isRagStatusValue(row.status)) return;

      const event: RagStatusEvent = {
        sourceType: 'clinical_note',
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
        `ws.subscribe.catchup_failed noteId=${noteId}: ${(err as Error).message}`,
        {
          namespace: this.namespace,
          clientId: client.id,
        },
      );
    }
  }

  @SubscribeMessage('unsubscribe-note')
  @UsePipes(new WsValidationPipe())
  async onUnsubscribeNote(
    client: AuthenticatedSocket,
    dto: SubscribeNoteDto,
  ): Promise<{ ok: true }> {
    await client.leave(RagRooms.scoped('clinical_note', dto.noteId));
    return { ok: true };
  }

  emitStatus(event: RagStatusEvent): void {
    this.emit(
      RagRooms.scoped('clinical_note', event.sourceId),
      'rag.status',
      event,
    );
  }
}
