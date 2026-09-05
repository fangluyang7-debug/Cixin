import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../application/auth.service';
import { AuthenticatedRequest } from '../auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.requireUserFromAuthorization(request.headers.authorization);
    return true;
  }
}

