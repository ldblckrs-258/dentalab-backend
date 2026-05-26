import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ScopeDto } from './chat-scope.dto';

export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  answerModelId?: string;

  @IsOptional()
  @ValidateIf((o: UpdateSessionDto) => o.scope !== null)
  @IsObject({ message: 'chat.scope.invalid_combination' })
  @ValidateNested()
  @Type(() => ScopeDto)
  scope?: ScopeDto | null;
}
