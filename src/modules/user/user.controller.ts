import { Audited, CurrentUser, RequirePermissions } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { AVATAR_ALLOWED_MIME_TYPES, AVATAR_MAX_SIZE } from '@modules/storage';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { BulkUpdateUserStatusDto } from './dto/bulk-update-user-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SyncRolesDto } from './dto/sync-roles.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UserService } from './user.service';

const AVATAR_ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

const avatarMulterOptions = {
  limits: { fileSize: AVATAR_MAX_SIZE },
  fileFilter: (
    _req: any,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const mimeOk = AVATAR_ALLOWED_MIME_TYPES.includes(file.mimetype);
    const extOk = AVATAR_ALLOWED_EXTENSIONS.test(file.originalname);
    if (mimeOk || extOk) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(`Invalid file type '${file.mimetype}'`),
        false,
      );
    }
  },
};

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions('users:read')
  async findAll(@Query() query: UserQueryDto) {
    return this.userService.findAll(query);
  }

  @Patch('me')
  @Audited('user')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  updateMyProfile(
    @Body() dto: UpdateMyProfileDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.userService.updateMyProfile(userId, dto, file);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  async findById(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Post()
  @RequirePermissions('users:create')
  @Audited('user')
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.create(dto, currentUser.id);
  }

  @Patch('bulk-status')
  @RequirePermissions('users:update')
  @Audited('user')
  async bulkUpdateStatus(@Body() dto: BulkUpdateUserStatusDto) {
    return this.userService.bulkUpdateStatus(dto);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  @Audited('user')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') actorId: string,
  ) {
    return this.userService.update(id, dto, file, actorId);
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
  async assignRoles(
    @Param('id') id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.assignRoles(id, dto, currentUser.id);
  }

  @Delete(':id/roles')
  @RequirePermissions('users:update')
  @Audited('user')
  async removeRoles(
    @Param('id') id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.removeRoles(id, dto, currentUser.id);
  }

  @Put(':id/roles')
  @RequirePermissions('users:update')
  @Audited('user')
  async syncRoles(
    @Param('id') id: string,
    @Body() dto: SyncRolesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.syncRoles(id, dto, currentUser.id);
  }
}
