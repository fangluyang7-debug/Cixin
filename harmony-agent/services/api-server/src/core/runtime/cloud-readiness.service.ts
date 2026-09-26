import { RuntimeWorkScope } from './runtime-work-scope';
import sharp = require('sharp');
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { TencentCosStorageAdapterService } from '../../adapters/storage/tencent-cos-storage-adapter.service';

export interface CloudReadiness {
  available: boolean;
  modelMode: 'required' | 'deferred';
  infrastructureAvailable: boolean;
  checkedAt: string;
  checks: Record<string, { available: boolean; durationMs: number; reason?: string }>;
}

@Injectable()
export class CloudReadinessService {
  private cached?: { expiresAt: number; result: CloudReadiness };
  private pending?: Promise<CloudReadiness>;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly storage: TencentCosStorageAdapterService) {}

  async check(): Promise<CloudReadiness> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;
    if (this.pending) return this.pending;
    this.pending = this.probe().then(result => {
      this.cached = { result, expiresAt: Date.now() + (result.available ? 30000 : 5000) };
      return result;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async probe(): Promise<CloudReadiness> {
    const checks: CloudReadiness['checks'] = {};
    const modelMode = this.config.get<string>('runtime.cloudModelMode') === 'deferred' ? 'deferred' : 'required';
    const measure = async (name: string, work: () => Promise<unknown>) => {
      const start = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), 10000);
        })]);
        checks[name] = { available: true, durationMs: Date.now() - start };
      } catch {
        // Never expose provider response bodies, signed URLs or credentials.
        checks[name] = { available: false, durationMs: Date.now() - start, reason: `${name.toUpperCase()}_PROBE_FAILED` };
      } finally { if (timer) clearTimeout(timer); }
    };
    await Promise.all([
      measure('database', () => this.prisma.product.findFirst({ select: { id: true } })),
      measure('cos', () => RuntimeWorkScope.run(AbortSignal.timeout(9000),
        { storageReadMs: 0, storageWriteMs: 0, modelMs: 0 }, () => this.storage.probeReadWrite())),
      ...['chat', 'vision', 'embedding'].map(kind => {
        if (modelMode === 'deferred') {
          checks[kind] = { available: false, durationMs: 0, reason: 'MODEL_INTEGRATION_DEFERRED' };
          return Promise.resolve();
        }
        return measure(kind, () => this.probeModel(kind));
      }),
    ]);
    return { available: Object.values(checks).every(item => item.available), modelMode,
      infrastructureAvailable: checks.database.available && checks.cos.available,
      checkedAt: new Date().toISOString(), checks };
  }

  private async probeModel(kind: string) {
    const prefix = kind === 'embedding' ? 'embedding' : `modelProviders.${kind}`;
    const baseUrl = this.config.get<string>(`${prefix}.baseUrl`)?.replace(/\/$/, '');
    const apiKey = this.config.get<string>(`${prefix}.apiKey`);
    const model = this.config.get<string>(`${prefix}.modelName`);
    if (!baseUrl || !apiKey || !model || !baseUrl.startsWith('https://')) throw new Error('MODEL_CONFIG_MISSING');
    const probeImage = 'data:image/png;base64,' + (await sharp({ create: { width: 64, height: 64, channels: 3,
      background: { r: 255, g: 255, b: 255 } } }).png().toBuffer()).toString('base64');
    const body = kind === 'embedding' ? { model, input: [{ type: 'image_url', image_url: { url: probeImage } }] } : {
      model, max_tokens: 4, messages: [{ role: 'user', content: kind === 'vision' ? [
        { type: 'text', text: 'Describe this image in one word.' },
        { type: 'image_url', image_url: { url: probeImage } },
      ] : 'Reply OK.' }],
    };
    const normalized = baseUrl.replace(/\/api\/coding\/v3$/, '/api/v3');
    const endpoint = kind === 'embedding' ? (normalized.endsWith('/embeddings/multimodal') ? normalized :
      normalized.endsWith('/embeddings') ? normalized + '/multimodal' : normalized + '/embeddings/multimodal') : baseUrl + '/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('MODEL_PROBE_FAILED');
    const result = await response.json() as { data?: Array<{ embedding?: number[] }> | { embedding?: number[] }; embedding?: number[]; choices?: Array<{ message?: { content?: string } }> };
    const vector = Array.isArray(result.data) ? result.data[0]?.embedding : result.data?.embedding ?? result.embedding;
    if (kind === 'embedding' ? !vector?.length || !vector.every(Number.isFinite) : !result.choices?.[0]?.message?.content?.trim()) {
      throw new Error('MODEL_CAPABILITY_UNAVAILABLE');
    }
  }
}
