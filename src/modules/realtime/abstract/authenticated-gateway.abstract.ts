import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { OnApplicationShutdown } from '@nestjs/common';
import type { Server } from 'socket.io';
import { Rooms } from '../utils';
import {
  WsAuthService,
  WsMetricsService,
  WsLoggerService,
  WsRateLimitService,
} from '../services';
import type { AuthenticatedSocket } from '../interfaces';
import { WsErrorCode } from '../interfaces';
import { AppConfigService } from '@modules/config';

const LOG_EMIT_ENABLED = process.env.WS_LOG_EMIT === '1';

function extractErrorCode(err: unknown): string {
  if (err instanceof WsException) {
    const e = err.getError();
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'code' in e) {
      return String((e as { code: unknown }).code);
    }
  }
  return WsErrorCode.WS_INTERNAL_ERROR;
}

export abstract class AuthenticatedGateway<TEvents>
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer() protected server!: Server;

  protected abstract readonly namespace: string;
  protected abstract readonly requiredPermissions: string[];
  protected abstract readonly logger: WsLoggerService;

  constructor(
    protected readonly wsAuth: WsAuthService,
    protected readonly metrics: WsMetricsService,
    protected readonly wsRateLimit: WsRateLimitService,
    protected readonly config: AppConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    this.logger.debug('ws.connect.attempted', {
      namespace: this.namespace,
      clientId: client.id,
    });

    const handshakeAllowed = await this.wsRateLimit.checkHandshake(client);
    if (!handshakeAllowed) {
      this.logger.log('ws.connect.rejected', {
        namespace: this.namespace,
        clientId: client.id,
        reason: 'rate_limited',
      });
      this.metrics.incrementRateLimitRejections(this.namespace);
      client.disconnect(true);
      return;
    }

    try {
      const { userId } = await this.wsAuth.authenticate(
        client,
        this.requiredPermissions,
      );

      client.data.userId = userId;
      await client.join(Rooms.user(userId));

      await this.onAuthorizedConnect(client);

      this.logger.debug('ws.connect.authorized', {
        namespace: this.namespace,
        clientId: client.id,
        userId,
      });
      this.metrics.incrementConnectionsOpened(this.namespace);
    } catch (err) {
      const reason = extractErrorCode(err);

      this.logger.log('ws.connect.rejected', {
        namespace: this.namespace,
        clientId: client.id,
        reason,
      });
      this.metrics.incrementAuthFailures(this.namespace);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug('ws.disconnect', {
      namespace: this.namespace,
      clientId: client.id,
      userId: client.data?.userId,
    });
    this.metrics.incrementConnectionsClosed(this.namespace);
    this.onDisconnect(client);
  }

  async onApplicationShutdown(): Promise<void> {
    const drainMs = this.config.ws.WS_DRAIN_MS;
    const hasClients = this.server?.sockets?.sockets?.size ?? 0;
    if (hasClients > 0 && drainMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, drainMs));
    }
    this.server?.disconnectSockets(true);
  }

  protected emit<K extends keyof TEvents & string>(
    room: string,
    event: K,
    payload: TEvents[K],
  ): void {
    if (LOG_EMIT_ENABLED) {
      this.logger.debug('ws.emit', {
        namespace: this.namespace,
        room,
        event,
      });
    }
    this.server.to(room).emit(event as string, payload);
  }

  protected onAuthorizedConnect(
    _client: AuthenticatedSocket,
  ): void | Promise<void> {
    void _client;
  }

  protected onDisconnect(_client: AuthenticatedSocket): void {
    void _client;
  }
}
