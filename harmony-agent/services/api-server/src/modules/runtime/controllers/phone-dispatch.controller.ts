import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { ok } from '../../../common/dto/api-response.dto';
import { PhoneDispatchService } from '../phone-dispatch.service';

function field(body: unknown, name: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    throw new BadRequestException(`${name.toUpperCase()}_INVALID`);
  }
  return value;
}

@Controller('api/v1/runtime/phone-dispatch')
@UseGuards(JwtAuthGuard)
export class PhoneDispatchController {
  constructor(private readonly dispatch: PhoneDispatchService) {}

  @Post('pairings')
  async createPairing(@Req() request: AuthenticatedRequest) {
    return ok(await this.dispatch.createPairing(request.user!.userId));
  }

  @Post('pairings/claim')
  async claim(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return ok(await this.dispatch.claimPairing(request.user!.userId, field(body, 'code')));
  }

  @Get('devices')
  async devices(@Req() request: AuthenticatedRequest) {
    return ok(await this.dispatch.devices(request.user!.userId));
  }

  @Post('devices/:deviceId/revoke')
  async revoke(@Req() request: AuthenticatedRequest, @Param('deviceId') deviceId: string) {
    return ok(await this.dispatch.revoke(request.user!.userId, deviceId));
  }

  @Post('jobs')
  async submit(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return ok(await this.dispatch.submit(request.user!.userId, field(body, 'deviceId')));
  }

  @Get('jobs/:jobId')
  async get(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string) {
    return ok(await this.dispatch.get(request.user!.userId, jobId));
  }

  @Post('jobs/:jobId/cancel')
  async cancel(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string) {
    return ok(await this.dispatch.cancel(request.user!.userId, jobId));
  }

  @Post('devices/:deviceId/lease')
  async lease(@Req() request: AuthenticatedRequest, @Param('deviceId') deviceId: string) {
    return ok(await this.dispatch.lease(request.user!.userId, deviceId));
  }

  @Post('devices/:deviceId/jobs/:jobId/result')
  async result(@Req() request: AuthenticatedRequest, @Param('deviceId') deviceId: string,
    @Param('jobId') jobId: string, @Body() body: unknown) {
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    return ok(await this.dispatch.result(request.user!.userId, deviceId, jobId,
      value.fence as number, value.norms as number[], value.computedMs as number));
  }

  @Post('devices/:deviceId/jobs/:jobId/stop-ack')
  async stopAck(@Req() request: AuthenticatedRequest, @Param('deviceId') deviceId: string,
    @Param('jobId') jobId: string, @Body() body: unknown) {
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    return ok(await this.dispatch.acknowledgeStop(request.user!.userId, deviceId, jobId, value.fence as number));
  }
}
