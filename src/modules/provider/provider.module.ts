import { Module } from '@nestjs/common';
import { SchedulingModule } from '@modules/scheduling/scheduling.module';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

@Module({
  imports: [SchedulingModule],
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
