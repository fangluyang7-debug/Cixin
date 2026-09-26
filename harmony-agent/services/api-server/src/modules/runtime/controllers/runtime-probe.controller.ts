import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { CloudReadinessService } from '../../../core/runtime/cloud-readiness.service';

// Bounded transport probes, no business inputs or search execution.
@Controller('api/v1/runtime/probe')
export class RuntimeProbeController {
  constructor(private readonly readiness: CloudReadinessService) {}
  @Get('ping') ping() { return ok({ available: true }); }
  @Get('download') download() { return ok({ padding: 'x'.repeat(32768) }); }
  @Post('upload') upload(@Body() body: { payload?: unknown }) {
    if (typeof body?.payload !== 'string' || body.payload.length > 65536 || !/^x*$/.test(body.payload)) {
      throw new BadRequestException('PROBE_PAYLOAD_INVALID');
    }
    return ok({ receivedBytes: Buffer.byteLength(body.payload) });
  }
  @Post('minimal-task') async minimal() {
    const start = performance.now();
    await new Promise<void>(resolve => setImmediate(resolve));
    // Event-loop queue only; provider queue is included in execution history, not claimed observable here.
    return ok({ queueMs: performance.now() - start, queueSource: 'event-loop' });
  }
  @Get('dependencies') async dependencies() {
    const result = await this.readiness.check();
    return ok({ available: result.available, checkedAt: result.checkedAt, checks: result.checks });
  }
}
