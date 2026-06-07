import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderOperatoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  orderedIds: string[];
}
