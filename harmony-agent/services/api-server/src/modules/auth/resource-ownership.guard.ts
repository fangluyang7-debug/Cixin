import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from './application/auth.service';
import { PrismaService } from '../../persistence/prisma/prisma.service';

// Applies to every session/candidate subresource, including legacy controllers.
@Injectable()
export class ResourceOwnershipGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const { sessionId, candidateItemId } = request.params ?? {};
    if (!sessionId && !candidateItemId) return true;
    const user = await this.auth.requireUserFromAuthorization(request.headers.authorization);
    request.user = user;
    if (sessionId && !await this.prisma.querySession.findFirst({ where: { id: sessionId, userId: user.userId }, select: { id: true } })) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    if (candidateItemId && !await this.prisma.candidateItem.findFirst({ where: { id: candidateItemId,
      snapshot: { session: { userId: user.userId }, ...(sessionId ? { sessionId } : {}) } }, select: { id: true } })) {
      throw new NotFoundException('CANDIDATE_NOT_FOUND');
    }
    return true;
  }
}
