import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { KIOSK_STATUS_ACTIVE } from '@common/constants';
import { hashToken, t } from '@common/utils';

@Injectable()
export class KioskAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-kiosk-token'] as string | undefined;

    if (!token) {
      throw new UnauthorizedException(
        t('kiosk.token_required', 'Kiosk token is required'),
      );
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
      throw new UnauthorizedException(
        t('kiosk.token_invalid', 'Invalid or expired kiosk token'),
      );
    }

    // Device fingerprint validation on subsequent requests
    if (session.device_fingerprint_hash) {
      const userAgent = request.headers['user-agent'] ?? '';
      const ip = request.ip ?? '';
      const fingerprint = hashToken(`${userAgent}${ip}`);

      if (session.device_fingerprint_hash !== fingerprint) {
        throw new ForbiddenException(
          t(
            'kiosk.device_mismatch',
            'Session accessed from a different device',
          ),
        );
      }
    }

    request.kioskSession = session;
    return true;
  }
}
