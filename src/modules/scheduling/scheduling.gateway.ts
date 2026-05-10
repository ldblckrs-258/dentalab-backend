import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@modules/config';
import { JwtService } from '@nestjs/jwt';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import type { JwtPayload } from '@common/interfaces';
import type { Server, Socket } from 'socket.io';

export interface ScheduleUpdatedEvent {
  providerId: string;
  effectFrom: string;
  effectTo: string | null;
}

export interface OverrideRequestedEvent {
  id: string;
  providerId: string;
  specificDate: string;
}

export interface OverrideReviewedEvent {
  id: string;
  status: 'approved' | 'rejected' | 'cancelled';
  reviewerId: string | null;
}

@WebSocketGateway({ namespace: '/schedule', cors: { origin: '*' } })
@Injectable()
export class SchedulingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(SchedulingGateway.name);
  private readonly scheduleReadersRoom = 'schedule-readers';

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const token = this.extractBearerToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.jwt.JWT_SECRET,
      });

      const canReadSchedules = await this.permissionResolver.hasAnyPermission(
        payload.sub,
        ['provider_schedules:read', 'schedule_overrides:read'],
      );

      if (!canReadSchedules) {
        client.disconnect(true);
        return;
      }

      client.data.userId = payload.sub;
      void client.join(this.scheduleReadersRoom);
      this.logger.debug(`Schedule socket connected: ${client.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    this.logger.debug(`Schedule socket disconnected: ${client.id}`);
  }

  emitScheduleUpdated(event: ScheduleUpdatedEvent): void {
    this.server.to(this.scheduleReadersRoom).emit('schedule.updated', event);
  }

  emitOverrideRequested(event: OverrideRequestedEvent): void {
    this.server.to(this.scheduleReadersRoom).emit('override.requested', event);
  }

  emitOverrideReviewed(event: OverrideReviewedEvent): void {
    this.server.to(this.scheduleReadersRoom).emit('override.reviewed', event);
  }

  private extractBearerToken(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    return null;
  }
}
