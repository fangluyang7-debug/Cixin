import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { CloudReadinessService } from '../../../core/runtime/cloud-readiness.service';
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly readiness: CloudReadinessService) {}
  @Get()
  getHealth() { return ok({ status: 'ok', service: 'api-server' }); }
  @Get('infrastructure')
  async getInfrastructure() {
    const health = await this.readiness.check();
    const result = { available: health.infrastructureAvailable, scope: 'database-and-cos-only',
      modelMode: health.modelMode, shoppingAvailable: health.available, checkedAt: health.checkedAt,
      checks: { database: health.checks.database, cos: health.checks.cos } };
    if (!result.available) throw new ServiceUnavailableException({ code: 'INFRASTRUCTURE_NOT_READY', ...result });
    return ok(result);
  }
  @Get('capabilities')
  async getCapabilities() {
    const result = await this.readiness.check();
    return ok({ modelMode: result.modelMode, checkedAt: result.checkedAt, capabilities: result.capabilities,
      catalog: result.catalog, checks: result.checks });
  }
  @Get('readiness')
  async getReadiness() {
    const result = await this.readiness.check();
    if (!result.available) throw new ServiceUnavailableException({ code: 'DEPENDENCIES_NOT_READY', ...result });
    return ok(result);
  }
}
