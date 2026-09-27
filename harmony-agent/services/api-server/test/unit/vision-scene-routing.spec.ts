import { ConfigService } from '@nestjs/config';
import configuration from '../../src/common/config/configuration';
import { OpenAiCompatibleModelAdapterService } from '../../src/adapters/model/openai-compatible-model-adapter.service';

describe('vision scene routing', () => {
  const originalEnv = process.env;
  let request: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      VISION_PROVIDER: 'volcengine_ark',
      VISION_MODEL_BASE_URL: 'https://models.example/v3',
      VISION_MODEL_API_KEY: 'test-key',
      VISION_MODEL_NAME: 'default-economy',
    };
    request = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        category: 'shoe', confidence: 0.9, sameProduct: true,
      }) } }] }),
    } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  async function runScenes() {
    const service = Object.assign(
      Object.create(OpenAiCompatibleModelAdapterService.prototype),
      {
        config: new ConfigService(configuration()),
        profileSchemaRegistry: {
          getProfileSchema: () => ({ version: 'test', schema: {} }),
        },
      },
    ) as OpenAiCompatibleModelAdapterService;
    const imageUrl = 'https://images.example/product.jpg';
    await service.tagProduct({ title: 'shoe', imageUrl });
    await service.classifyProductCategory({ imageUrl });
    const profile = await service.identifyShoe({ imageUrl });
    await service.verifyCandidateVisualMatch({
      queryProfile: profile,
      queryImageUrl: imageUrl,
      candidate: { title: 'shoe', imageUrl },
    });
    return request.mock.calls.map(([, init]) => JSON.parse(init.body).model);
  }

  it('sends each scene model to the provider using shared credentials', async () => {
    Object.assign(process.env, {
      VISION_TAGGING_MODEL_NAME: 'tag-economy',
      VISION_CATEGORY_MODEL_NAME: 'category-economy',
      VISION_PROFILE_MODEL_NAME: 'profile-economy',
      VISION_VERIFY_MODEL_NAME: 'verify-pro',
    });
    expect(await runScenes()).toEqual([
      'tag-economy', 'category-economy', 'profile-economy', 'verify-pro',
    ]);
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe('https://models.example/v3/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer test-key');
    }
  });

  it('keeps the legacy default for all scenes without overrides', async () => {
    expect(await runScenes()).toEqual(Array(4).fill('default-economy'));
  });

  it('normalizes blank overrides and isolates the verification override', async () => {
    Object.assign(process.env, {
      VISION_TAGGING_MODEL_NAME: '   ',
      VISION_CATEGORY_MODEL_NAME: '""',
      VISION_PROFILE_MODEL_NAME: '',
      VISION_VERIFY_MODEL_NAME: ' "verify-pro" ',
    });
    expect(await runScenes()).toEqual([
      'default-economy', 'default-economy', 'default-economy', 'verify-pro',
    ]);
  });

  it('preserves MODEL_3 compatibility', async () => {
    delete process.env.VISION_MODEL_NAME;
    process.env.MODEL_3 = 'legacy-vision';
    expect(await runScenes()).toEqual(Array(4).fill('legacy-vision'));
  });
});
