import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  roleIds: string[];
}
