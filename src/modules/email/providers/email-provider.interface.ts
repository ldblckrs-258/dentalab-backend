export interface SendEmailOptions {
  from?: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailResult {
  id: string;
}

export interface SendBatchResult {
  results: SendEmailResult[];
}

export interface EmailProvider {
  send(options: SendEmailOptions): Promise<SendEmailResult>;
  sendBatch(options: SendEmailOptions[]): Promise<SendBatchResult>;
}
