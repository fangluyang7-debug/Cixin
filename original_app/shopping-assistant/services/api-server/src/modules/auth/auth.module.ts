import { Module } from '@nestjs/common';
import { AuthService } from './application/auth.service';
import { JwtTokenService } from './application/jwt-token.service';
import { AuthController } from './controllers/auth.controller';
import { UsersController } from './controllers/users.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtTokenService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}

