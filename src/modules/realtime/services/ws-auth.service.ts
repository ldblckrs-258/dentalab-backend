import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '@common/interfaces';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { WsErrorCode } from '../interfaces';

@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async authenticate(
    client: Socket,
    requiredPermissions: string[],
  ): Promise<{ userId: string; payload: JwtPayload }> {
    const token = this.extractToken(client);
    if (!token) {
      throw new WsException(WsErrorCode.WS_NO_TOKEN);
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new WsException(WsErrorCode.WS_INVALID_TOKEN);
    }

    const hasPermission = await this.permissionResolver.hasAnyPermission(
      payload.sub,
      requiredPermissions,
    );

    if (!hasPermission) {
      throw new WsException(WsErrorCode.WS_NO_PERMISSION);
    }

    return { userId: payload.sub, payload };
  }

  private extractToken(client: Socket): string | null {
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
