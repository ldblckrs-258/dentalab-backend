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
import { RequirePermissions, Audited } from '@common/decorators';
import { PaginationQueryDto } from '@modules/pagination';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions('users:read')
  async findAll(@Query() query: PaginationQueryDto) {
    return this.userService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  async findById(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Post()
  @RequirePermissions('users:create')
  @Audited('user')
  async create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  @Audited('user')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('users:update')
  @Audited('user')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.userService.updateStatus(id, dto);
  }

  @Post(':id/roles')
  @RequirePermissions('users:update')
  @Audited('user')
  async assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return this.userService.assignRoles(id, dto);
  }

  @Delete(':id/roles')
  @RequirePermissions('users:update')
  @Audited('user')
  async removeRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return this.userService.removeRoles(id, dto);
  }
}
