import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulingModule } from '@modules/scheduling/scheduling.module';
import { AppointmentModule } from '@modules/appointment';
import { AppConfigService } from '@modules/config';
import { BookingController } from './booking.controller';
import { BookingSlotService } from './booking-slot.service';
import { BookingOtpService } from './booking-otp.service';
import { BookingService } from './booking.service';
import { BookingTicketGuard } from './booking-ticket.guard';

@Module({
  imports: [
    SchedulingModule,
    AppointmentModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.booking.BOOKING_TICKET_SECRET,
        signOptions: { audience: 'booking', expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [BookingController],
  providers: [
    BookingSlotService,
    BookingOtpService,
    BookingService,
    BookingTicketGuard,
  ],
  exports: [BookingSlotService],
})
export class BookingModule {}
