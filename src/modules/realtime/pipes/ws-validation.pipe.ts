import { Injectable, ValidationPipe } from '@nestjs/common';
import type { ValidationPipeOptions, ValidationError } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsErrorCode } from '../interfaces';

function flattenErrors(errors: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const err of errors) {
    if (err.constraints) {
      messages.push(...Object.values(err.constraints));
    }
    if (err.children?.length) {
      messages.push(...flattenErrors(err.children));
    }
  }
  return messages;
}

@Injectable()
export class WsValidationPipe extends ValidationPipe {
  constructor(options?: ValidationPipeOptions) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const messages = flattenErrors(errors);
        return new WsException({
          code: WsErrorCode.WS_VALIDATION_ERROR,
          message: messages[0] || 'Validation failed',
          details: messages,
        });
      },
      ...options,
    });
  }
}
