import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { KIOSK_STATUS_ACTIVE } from '@common/constants';
import { hashToken } from '@common/utils';

@Injectable()
export class KioskAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-kiosk-token'] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Kiosk token is required');
    }

    const tokenHash = hashToken(token);

    const session = await this.prisma.baseClient.kioskSession.findFirst({
      where: {
        token_hash: tokenHash,
        status: KIOSK_STATUS_ACTIVE,
        expires_at: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or expired kiosk token');
    }

    request.kioskSession = session;
    return true;
  }
}
