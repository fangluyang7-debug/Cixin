import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleModelAdapterService } from '../../src/adapters/model/openai-compatible-model-adapter.service';
import { RuntimeWorkScope, RuntimeWorkMeasurements } from '../../src/core/runtime/runtime-work-scope';

describe('high-quality text model route', () => {
  it('calls the configured pro model and records the actual model ID', async () => {
    const values: Record<string, string> = {
      'modelProviders.vision.provider': 'volcengine',
      'modelProviders.vision.baseUrl': 'https://model.example/v1',
      'modelProviders.vision.sceneModels.profile': 'pro-model',
      'modelProviders.vision.apiKey': 'test-only',
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    const adapter = new OpenAiCompatibleModelAdapterService(config, {} as any, {} as any, {} as any, {} as any);
    const complete = jest.spyOn(adapter as any, 'callJsonCompletion').mockResolvedValue({ keywords: ['缓震', '透气'] });
    const measurements: RuntimeWorkMeasurements = { storageReadMs: 0, storageWriteMs: 0, modelMs: 0 };
    const result = await RuntimeWorkScope.run(new AbortController().signal, measurements,
      () => adapter.enhanceTextQuery({ message: '推荐跑鞋', category: 'shoe' }));
    expect(result).toEqual({ keywords: ['缓震', '透气'], modelId: 'pro-model' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ modelName: 'pro-model' }));
    expect(measurements.modelCalls).toEqual([{ purpose: 'high_quality_text', modelId: 'pro-model' }]);
  });
});
