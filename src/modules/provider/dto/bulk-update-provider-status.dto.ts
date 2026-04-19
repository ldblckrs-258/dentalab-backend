import { ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class BulkUpdateProviderStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(4, { each: true })
  ids: string[];

  @IsBoolean()
  isActive: boolean;
}
