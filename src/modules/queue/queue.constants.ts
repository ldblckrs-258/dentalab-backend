export const RABBITMQ_CONNECTION = 'RABBITMQ_CONNECTION';
export const RABBITMQ_CHANNEL = 'RABBITMQ_CHANNEL';

// Exchanges
export const EXCHANGE_EVENTS = 'dental.events';
export const EXCHANGE_DLX = 'dental.dlx';

// Queues
export const QUEUE_RAG_INDEXING = 'rag.indexing';
export const QUEUE_EMAIL_SEND = 'email.send';
export const QUEUE_NOTIFICATION_INVENTORY = 'notification.inventory';
export const QUEUE_DLQ = 'dental.dlq';

// Routing keys
export const ROUTING_KEY = {
  DOCUMENT_CREATED: 'document.created',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_DELETED: 'document.deleted',
  CLINICAL_NOTE_CREATED: 'clinical_note.created',
  CLINICAL_NOTE_UPDATED: 'clinical_note.updated',
  EMAIL_SEND_REMINDER: 'email.send_reminder',
  EMAIL_SEND_RESET_PASSWORD: 'email.send_reset_password',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',
} as const;

// DLQ
export const MAX_RETRY_COUNT = 3;
