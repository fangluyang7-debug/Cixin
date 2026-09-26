import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
@Injectable()
export class RuntimeMaintenanceGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const actual = context.switchToHttp().getRequest().headers['x-maintenance-token'];
    const expected = process.env.MAINTENANCE_API_TOKEN;
    if (!expected || typeof actual !== 'string' || Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new ForbiddenException('RUNTIME_MAINTENANCE_REQUIRED');
    return true;
  }
}
