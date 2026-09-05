import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalImageWorkerClientService } from './local-image-worker-client.service';

@Injectable()
export class LocalImageWorkerHealthService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly worker: LocalImageWorkerClientService,
  ) {}

  async onModuleInit() {
    const localWorkerEnabled = this.config.get<boolean>('embedding.localWorkerEnabled') === true;
    if (!localWorkerEnabled) return;

    const provider = this.config.get<string>('embedding.provider');
    const preprocessor = this.config.get<string>('embedding.imagePreprocessor');
    if (provider !== 'local_gpu_worker' && preprocessor !== 'local_gpu_worker') return;
    await this.worker.health();
  }
}
