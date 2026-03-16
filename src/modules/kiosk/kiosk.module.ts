import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { KioskAuthGuard } from './guards/kiosk-auth.guard';

@Module({
  controllers: [KioskController],
  providers: [KioskService, KioskAuthGuard],
  exports: [KioskService],
})
export class KioskModule {}
