import { Body, Controller, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { AuthService } from '../application/auth.service';
import { LoginDto, RegisterDto } from '../dto/auth.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return ok(await this.auth.register(dto));
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return ok(await this.auth.login(dto));
  }
}

