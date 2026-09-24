import { Controller, Get } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';

@Controller('api/v1/health')
export class HealthController {
  @Get()
  getHealth() {
    return ok({
      status: 'ok',
      service: 'api-server',
    });
  }
}
