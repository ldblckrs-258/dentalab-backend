import { IsUUID } from 'class-validator';

export class SubscribeNoteDto {
  @IsUUID()
  noteId!: string;
}
