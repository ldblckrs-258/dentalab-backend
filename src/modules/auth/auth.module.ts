import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '@modules/config';
import { AuditModule } from '@modules/audit';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.JWT_SECRET,
        // StringValue type from ms requires literal strings; runtime config needs cast
        signOptions: { expiresIn: config.jwt.JWT_ACCESS_EXPIRY as any },
      }),
    }),
    forwardRef(() => AuditModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // JwtAuthGuard is wired explicitly via main.ts useGlobalGuards() to lock
    // its execution order between RateLimitGuard and PermissionGuard.
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule {}
