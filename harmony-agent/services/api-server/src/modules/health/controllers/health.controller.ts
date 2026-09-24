import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ok } from '../../../common/dto/api-response.dto';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  getHealth() {
    return ok({
      status: 'ok',
      service: 'api-server',
    });
  }

  // Read-only dependency check for Zeabur. Configuration presence is not a COS network probe.
  @Get('readiness')
  async getReadiness() {
    let database: 'connected' | 'unavailable' = 'connected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }
    const storageKeys = [
      'objectStorage.region',
      'objectStorage.secretId',
      'objectStorage.secretKey',
      'objectStorage.buckets.compressedRecognition',
      'objectStorage.buckets.originalSource',
      'objectStorage.buckets.demoAssets',
    ];
    const objectStorage = this.config.get<string>('objectStorage.provider') === 'tencent_cos' &&
      storageKeys.every((key) => Boolean(this.config.get<string>(key)?.trim()))
      ? 'configured_not_probed' : 'unconfigured';
    const result = { database, objectStorage };
    if (database !== 'connected' || objectStorage === 'unconfigured') {
      throw new ServiceUnavailableException({ code: 'DEPENDENCIES_NOT_READY', ...result });
    }
    return ok(result);
  }
}
