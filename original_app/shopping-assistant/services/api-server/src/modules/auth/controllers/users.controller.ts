import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { AuthService } from '../application/auth.service';
import { AuthenticatedRequest } from '../auth.types';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() request: AuthenticatedRequest) {
    return ok(await this.auth.getMe(request.user!.userId));
  }
}

