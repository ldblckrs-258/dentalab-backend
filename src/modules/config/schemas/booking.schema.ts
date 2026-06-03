import { z } from 'zod/v4';

export const bookingSchema = z.object({
  BOOKING_TICKET_SECRET: z.string().min(16),
  BOOKING_OTP_PEPPER: z.string().min(16),
});

export type BookingConfig = z.infer<typeof bookingSchema>;
