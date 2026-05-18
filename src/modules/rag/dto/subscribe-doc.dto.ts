import { IsUUID } from 'class-validator';

export class SubscribeDocDto {
  @IsUUID()
  docId!: string;
}
