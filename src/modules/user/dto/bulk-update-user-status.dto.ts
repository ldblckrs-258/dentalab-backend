import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsUUID,
} from 'class-validator';

export class BulkUpdateUserStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids: string[];

  @IsBoolean()
  isActive: boolean;
}
