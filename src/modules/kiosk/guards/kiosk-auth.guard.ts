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
        tokenHash: tokenHash,
        status: KIOSK_STATUS_ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException(
        t('kiosk.token_invalid', 'Invalid or expired kiosk token'),
      );
    }

    // Device fingerprint validation on subsequent requests
    if (session.deviceFingerprintHash) {
      const userAgent = request.headers['user-agent'] ?? '';
      const ip = request.ip ?? '';
      const fingerprint = hashToken(`${userAgent}${ip}`);

      if (session.deviceFingerprintHash !== fingerprint) {
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
