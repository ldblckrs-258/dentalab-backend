import { IsArray, IsUUID } from 'class-validator';

export class SyncRolesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds: string[];
}
