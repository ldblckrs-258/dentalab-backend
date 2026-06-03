import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';

export interface BookingTicketRequest {
  verificationId: string;
  email: string;
}

@Injectable()
export class BookingTicketGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      bookingTicket?: BookingTicketRequest;
    }>();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Booking ticket required');
    }

    const token = authHeader.slice(7);
    let payload: { sub: string; email: string; aud: string | string[] };

    try {
      payload = this.jwt.verify(token, {
        secret: this.config.booking.BOOKING_TICKET_SECRET,
        audience: 'booking',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired booking ticket');
    }

    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (aud !== 'booking') {
      throw new UnauthorizedException('Invalid booking ticket audience');
    }

    const verification =
      await this.prisma.baseClient.bookingVerification.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, verifiedAt: true, consumedAt: true },
      });

    if (!verification) {
      throw new UnauthorizedException(
        'Booking ticket refers to unknown verification',
      );
    }
    if (!verification.verifiedAt) {
      throw new UnauthorizedException('OTP not verified');
    }
    if (verification.consumedAt) {
      throw new UnauthorizedException('Booking ticket already used');
    }

    request.bookingTicket = {
      verificationId: verification.id,
      email: verification.email,
    };

    return true;
  }
}
