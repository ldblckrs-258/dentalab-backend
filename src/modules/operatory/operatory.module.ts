import { Module } from '@nestjs/common';
import { OperatoryController } from './operatory.controller';
import { OperatoryService } from './operatory.service';

@Module({
  controllers: [OperatoryController],
  providers: [OperatoryService],
  exports: [OperatoryService],
})
export class OperatoryModule {}
