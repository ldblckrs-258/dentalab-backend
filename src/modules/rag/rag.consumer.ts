import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueConsumerService, ROUTING_KEY } from '@modules/queue';
import { QUEUE_RAG_STATUS_EVENTS } from '@modules/queue/queue.constants';
import type { QueueMessage } from '@modules/queue/interfaces';
import { ragStatusEventSchema } from './rag.events';
import { RagGateway } from './rag.gateway';
import { ClinicalNoteRagGateway } from './rag.clinical-note.gateway';

@Injectable()
export class RagConsumer implements OnModuleInit {
  private readonly logger = new Logger(RagConsumer.name);

  constructor(
    private readonly queueConsumer: QueueConsumerService,
    private readonly ragGateway: RagGateway,
    private readonly clinicalNoteRagGateway: ClinicalNoteRagGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueConsumer.consume(QUEUE_RAG_STATUS_EVENTS, (message) =>
      this.handleMessage(message),
    );
  }

  private handleMessage(message: QueueMessage): void {
    if (message.routingKey !== ROUTING_KEY.RAG_DOCUMENT_STATUS_CHANGED) {
      return;
    }

    const result = ragStatusEventSchema.safeParse(message.payload);
    if (!result.success) {
      this.logger.warn(
        `Malformed rag.document.status_changed payload: ${result.error.message}`,
      );
      return;
    }

    if (result.data.sourceType === 'clinical_note') {
      this.clinicalNoteRagGateway.emitStatus(result.data);
    } else {
      this.ragGateway.emitStatus(result.data);
    }
  }
}
