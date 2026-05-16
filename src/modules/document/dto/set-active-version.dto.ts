import { IsUUID } from 'class-validator';

export class SetActiveVersionDto {
  @IsUUID()
  versionId: string;
}
