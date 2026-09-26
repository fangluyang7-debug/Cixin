import { RuntimeModule } from '../runtime/runtime.module';
import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';

@Module({
  imports: [RuntimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
