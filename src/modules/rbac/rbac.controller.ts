import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions, Audited, CurrentUser } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { PaginationQueryDto } from '@modules/pagination';
import { RbacService } from './rbac.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { CreateOverrideDto } from './dto/create-override.dto';

@Controller('rbac')
export class RbacController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ── Roles ──

  @Get('roles')
  @RequirePermissions('roles:read')
  async findAllRoles(@Query() query: PaginationQueryDto) {
    return this.rbacService.findAllRoles(query);
  }

  @Get('roles/:id')
  @RequirePermissions('roles:read')
  async findRoleById(@Param('id') id: string) {
    return this.rbacService.findRoleById(id);
  }

  @Post('roles')
  @RequirePermissions('roles:create')
  @Audited('role')
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles:update')
  @Audited('role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles:delete')
  @Audited('role')
  async deleteRole(@Param('id') id: string) {
    return this.rbacService.deleteRole(id);
  }

  // ── Permissions ──

  @Get('permissions')
  @RequirePermissions('permissions:read')
  async findAllPermissions(@Query() query: PaginationQueryDto) {
    return this.rbacService.findAllPermissions(query);
  }

  // ── Role-Permission Assignment ──

  @Post('roles/:id/permissions')
  @RequirePermissions('roles:update')
  @Audited('role')
  async assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.assignPermissionsToRole(id, dto);
  }

  @Delete('roles/:id/permissions')
  @RequirePermissions('roles:update')
  @Audited('role')
  async revokePermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.revokePermissionsFromRole(id, dto);
  }

  @Post('roles/:id/permissions/remove')
  @RequirePermissions('roles:update')
  @Audited('role_permissions')
  async revokePermissionsPost(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.revokePermissionsFromRole(id, dto);
  }

  // ── User Permissions ──

  @Get('users/:id/permissions')
  @RequirePermissions('users:read')
  async getUserPermissions(@Param('id') userId: string) {
    return this.permissionResolver.resolvePermissions(userId);
  }

  // ── User Permission Overrides ──

  @Get('users/:id/overrides')
  @RequirePermissions('users:read')
  async findUserOverrides(@Param('id') id: string) {
    return this.rbacService.findUserOverrides(id);
  }

  @Post('users/:id/overrides')
  @RequirePermissions('users:update')
  @Audited('user')
  async createOverride(
    @Param('id') userId: string,
    @Body() dto: CreateOverrideDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.rbacService.createOverride(userId, dto, admin.id);
  }

  @Patch('overrides/:id/revoke')
  @RequirePermissions('users:update')
  @Audited('user')
  async revokeOverride(
    @Param('id') overrideId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.rbacService.revokeOverride(overrideId, admin.id);
  }
}
