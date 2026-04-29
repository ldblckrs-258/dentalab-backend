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
import {
  RequirePermissions,
  RequireAnyPermission,
  AuditMutation,
  CurrentUser,
} from '@common/decorators';
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
  @AuditMutation({ code: 'RBAC_ROLE_CREATED', resource: 'role' })
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles:update')
  @AuditMutation({ code: 'RBAC_ROLE_UPDATED', resource: 'role' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles:delete')
  @AuditMutation({ code: 'RBAC_ROLE_DELETED', resource: 'role' })
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
  async assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.assignPermissionsToRole(id, dto);
  }

  @Delete('roles/:id/permissions')
  @RequirePermissions('roles:update')
  async revokePermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.revokePermissionsFromRole(id, dto);
  }

  @Post('roles/:id/permissions/remove')
  @RequirePermissions('roles:update')
  async revokePermissionsPost(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.rbacService.revokePermissionsFromRole(id, dto);
  }

  @Post('roles/:id/permissions/reset')
  @RequirePermissions('roles:update')
  async resetRolePermissions(@Param('id') id: string) {
    return this.rbacService.resetRolePermissions(id);
  }

  // ── User Permissions ──

  @Get('users/:id/permissions')
  @RequirePermissions('users:read')
  async getUserPermissions(@Param('id') userId: string) {
    return this.permissionResolver.resolvePermissions(userId);
  }

  // ── User Permission Overrides ──

  @Get('users/:id/overrides')
  @RequireAnyPermission('users:read:all', 'users:read:non_admin')
  async findUserOverrides(@Param('id') id: string) {
    return this.rbacService.findUserOverrides(id);
  }

  @Post('users/:id/overrides')
  @RequirePermissions('users:update')
  async createOverride(
    @Param('id') userId: string,
    @Body() dto: CreateOverrideDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.rbacService.createOverride(userId, dto, admin.id);
  }

  @Patch('overrides/:id/revoke')
  @RequirePermissions('users:update')
  async revokeOverride(
    @Param('id') overrideId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.rbacService.revokeOverride(overrideId, admin.id);
  }
}
