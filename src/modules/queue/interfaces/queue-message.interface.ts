export interface QueueMessage<T = unknown> {
  messageId: string;
  timestamp: string;
  correlationId?: string;
  routingKey: string;
  payload: T;
}

export interface PublishOptions {
  correlationId?: string;
}
