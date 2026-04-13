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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateLanguageDto } from './dto/update-language.dto';
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

  @Patch('me/avatar')
  @Audited('user')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  uploadMyAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.userService.uploadAvatar(userId, file, userId);
  }

  @Delete('me/avatar')
  @Audited('user')
  removeMyAvatar(@CurrentUser('id') userId: string) {
    return this.userService.removeAvatar(userId);
  }

  @Patch('me/language')
  @Audited('user')
  async updateLanguage(
    @Body() dto: UpdateLanguageDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.userService.updateLanguage(userId, dto.language);
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

  @Patch(':id')
  @RequirePermissions('users:update')
  @Audited('user')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Patch(':id/avatar')
  @RequirePermissions('users:update')
  @Audited('user')
  @UseInterceptors(FileInterceptor('avatar', avatarMulterOptions))
  uploadUserAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') actorId: string,
  ) {
    return this.userService.uploadAvatar(id, file, actorId);
  }

  @Delete(':id/avatar')
  @RequirePermissions('users:update')
  @Audited('user')
  removeUserAvatar(@Param('id') id: string) {
    return this.userService.removeAvatar(id);
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
}
