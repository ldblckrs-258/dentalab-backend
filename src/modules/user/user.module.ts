import { Module } from '@nestjs/common';
import { RbacModule } from '@modules/rbac';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [RbacModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
