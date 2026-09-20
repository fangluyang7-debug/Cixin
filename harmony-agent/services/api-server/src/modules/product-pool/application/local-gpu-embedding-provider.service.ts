import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ImageEmbeddingInput,
  TextEmbeddingInput,
} from './embedding-provider.interface';
import { LocalImageWorkerClientService } from './local-image-worker-client.service';

interface WorkerEmbeddingResponse {
  provider?: string;
  modelName?: string;
  dimension?: number;
  vector: number[];
  vectorHash?: string;
}

@Injectable()
export class LocalGpuEmbeddingProviderService implements EmbeddingProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly worker: LocalImageWorkerClientService,
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (input.imageUrl || input.imageBase64) {
      return this.embedImage({
        imageUrl: input.imageUrl,
        imageBase64: input.imageBase64,
        imageContentType: input.imageContentType,
        textHint: input.text,
        tags: input.tags,
      });
    }
    return this.embedText({
      text: input.text ?? JSON.stringify(input.tags ?? {}),
      tags: input.tags,
    });
  }

  async embedImage(input: ImageEmbeddingInput): Promise<EmbeddingResult> {
    const result = await this.worker.post<WorkerEmbeddingResponse>('/v1/images/embed', {
      imageUrl: input.imageUrl ?? null,
      imageBase64: input.imageBase64 ?? null,
      textHint: input.textHint,
      tags: input.tags ?? {},
    });
    return this.normalizeResult(result);
  }

  async embedText(input: TextEmbeddingInput): Promise<EmbeddingResult> {
    const result = await this.worker.post<WorkerEmbeddingResponse>('/v1/images/embed', {
      text: input.text,
      tags: input.tags ?? {},
    });
    return this.normalizeResult(result);
  }

  private normalizeResult(result: WorkerEmbeddingResponse): EmbeddingResult {
    if (!Array.isArray(result.vector) || result.vector.length === 0) {
      throw new InternalServerErrorException('LOCAL_IMAGE_WORKER_EMPTY_VECTOR');
    }
    const vector = result.vector
      .map((item) => (typeof item === 'number' ? item : Number(item)))
      .filter((item) => Number.isFinite(item));
    const expectedDimension = this.config.get<number>('embedding.dimension');
    if (!expectedDimension) {
      throw new InternalServerErrorException('LOCAL_EMBEDDING_DIMENSION_NOT_CONFIGURED');
    }
    if (vector.length !== expectedDimension) {
      throw new InternalServerErrorException('LOCAL_EMBEDDING_DIMENSION_MISMATCH');
    }
    const vectorHash = result.vectorHash ?? createHash('sha256').update(JSON.stringify(vector)).digest('hex');
    const modelName = result.modelName ?? this.config.get<string>('embedding.modelName');
    if (!modelName) {
      throw new InternalServerErrorException('LOCAL_EMBEDDING_MODEL_NAME_NOT_CONFIGURED');
    }
    return {
      provider: this.config.get<string>('embedding.provider') ?? 'local_gpu_worker',
      modelName,
      dimension: vector.length,
      vector,
      vectorHash,
    };
  }
}
