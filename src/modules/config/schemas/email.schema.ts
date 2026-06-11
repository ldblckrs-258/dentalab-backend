import { z } from 'zod/v4';

export const emailSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  EMAIL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  EMAIL_FROM_ADDRESS: z.string().default('noreply@dentalab.com'),
  EMAIL_FROM_NAME: z.string().default('DentaLab'),
  EMAIL_REPLY_TO: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  FRONTEND_URL: z.url().default('http://localhost:3000'),
});

export type EmailConfig = z.infer<typeof emailSchema>;
