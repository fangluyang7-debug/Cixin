import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { CloudReadinessService } from '../../../core/runtime/cloud-readiness.service';
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly readiness: CloudReadinessService) {}
  @Get()
  getHealth() { return ok({ status: 'ok', service: 'api-server' }); }
  @Get('readiness')
  async getReadiness() {
    const result = await this.readiness.check();
    if (!result.available) throw new ServiceUnavailableException({ code: 'DEPENDENCIES_NOT_READY', ...result });
    return ok(result);
  }
}
