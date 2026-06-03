import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public, RateLimit } from '@common/decorators';
import { BookingOtpService } from './booking-otp.service';
import { BookingService } from './booking.service';
import { BookingSlotService } from './booking-slot.service';
import { BookingTicketGuard } from './booking-ticket.guard';
import { PrismaService } from '@modules/database';
import { StorageService } from '@modules/storage';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { SlotsQueryDto } from './dto/slots-query.dto';
import { ProvidersQueryDto } from './dto/providers-query.dto';
import type { BookingTicketRequest } from './booking-ticket.guard';
import type { Request } from 'express';

@Public()
@Controller('public/booking')
export class BookingController {
  constructor(
    private readonly otpService: BookingOtpService,
    private readonly bookingService: BookingService,
    private readonly slotService: BookingSlotService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get('appointment-types')
  @RateLimit({ limit: 60, windowSeconds: 60, keyExtractor: 'ip' })
  async getAppointmentTypes() {
    return this.prisma.baseClient.appointmentType.findMany({
      where: { isActive: true },
      select: { id: true, name: true, durationMinutes: true, color: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('providers')
  @RateLimit({ limit: 60, windowSeconds: 60, keyExtractor: 'ip' })
  async getProviders(@Query() query: ProvidersQueryDto) {
    const where: Record<string, unknown> = { isActive: true };

    if (query.typeId) {
      const junctionRows =
        await this.prisma.baseClient.providerAppointmentType.findMany({
          where: { appointmentTypeId: query.typeId },
          select: { providerId: true },
        });
      where['id'] = { in: junctionRows.map((r) => r.providerId) };
    }

    return this.prisma.baseClient.provider
      .findMany({
        where,
        select: {
          id: true,
          specialty: true,
          user: { select: { fullName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          displayName: r.user.fullName,
          avatarUrl: this.storage.resolveAvatarUrl(r.user.avatarUrl),
          specialty: r.specialty,
        })),
      );
  }

  @Get('slots')
  @RateLimit({ limit: 30, windowSeconds: 60, keyExtractor: 'ip' })
  async getSlots(@Query() query: SlotsQueryDto) {
    return this.slotService.getBookableSlots({
      typeId: query.typeId,
      providerId: query.providerId,
      date: query.date,
    });
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const ip = req.ip ?? 'unknown';
    await this.otpService.request(dto.email, ip);
    return { message: 'If this email is valid, a code has been sent.' };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.otpService.verify(dto.email, dto.code);
    if (!result) {
      return { message: 'Invalid or expired code.' };
    }
    return result;
  }

  @Post('appointments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(BookingTicketGuard)
  @RateLimit({ limit: 5, windowSeconds: 60, keyExtractor: 'ip' })
  async createBooking(
    @Body() dto: CreateBookingDto,
    @Req() req: Request & { bookingTicket: BookingTicketRequest },
  ) {
    return this.bookingService.createBooking(req.bookingTicket, dto);
  }
}
