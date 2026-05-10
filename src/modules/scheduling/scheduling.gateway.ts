import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import {
  AuthenticatedGateway,
  WsAuthService,
  WsMetricsService,
  WsLoggerService,
  WsRateLimitService,
} from '@modules/realtime';
import type { AuthenticatedSocket } from '@modules/realtime';
import { AppConfigService } from '@modules/config';
import { ScheduleRooms } from './schedule.rooms';

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

export interface ScheduleEvents {
  'schedule.updated': ScheduleUpdatedEvent;
  'override.requested': OverrideRequestedEvent;
  'override.reviewed': OverrideReviewedEvent;
}

@WebSocketGateway({ namespace: '/schedule' })
@Injectable()
export class SchedulingGateway extends AuthenticatedGateway<ScheduleEvents> {
  protected readonly namespace = '/schedule';
  protected readonly requiredPermissions = [
    'provider_schedules:read',
    'schedule_overrides:read',
  ];
  protected readonly logger = new WsLoggerService(SchedulingGateway.name);

  constructor(
    wsAuth: WsAuthService,
    metrics: WsMetricsService,
    wsRateLimit: WsRateLimitService,
    config: AppConfigService,
  ) {
    super(wsAuth, metrics, wsRateLimit, config);
  }

  emitScheduleUpdated(event: ScheduleUpdatedEvent): void {
    this.emit(ScheduleRooms.readers(), 'schedule.updated', event);
  }

  emitOverrideRequested(event: OverrideRequestedEvent): void {
    this.emit(ScheduleRooms.readers(), 'override.requested', event);
  }

  emitOverrideReviewed(event: OverrideReviewedEvent): void {
    this.emit(ScheduleRooms.readers(), 'override.reviewed', event);
  }

  protected async onAuthorizedConnect(
    client: AuthenticatedSocket,
  ): Promise<void> {
    await client.join(ScheduleRooms.readers());
  }
}
