import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { WsErrorCode } from '../interfaces';

@Catch(WsException)
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: WsException, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const error = exception.getError();

    let code: string = WsErrorCode.WS_INTERNAL_ERROR;
    let message = 'An error occurred';
    let details: unknown;

    if (typeof error === 'string') {
      code = error;
      message = error;
    } else if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      if (typeof obj.code === 'string') code = obj.code;
      if (typeof obj.message === 'string') message = obj.message;
      details = obj.details;
    }

    this.logger.warn(`ws.event.rejected [client=${client.id}, reason=${code}]`);

    client.emit('ws:error', {
      event: 'ws:error',
      code,
      message,
      details,
    });
  }
}
