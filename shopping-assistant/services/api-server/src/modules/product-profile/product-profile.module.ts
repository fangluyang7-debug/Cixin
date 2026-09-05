import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODEL_ADAPTER } from '../../adapters/model/model-adapter.interface';
import { OpenAiCompatibleModelAdapterService } from '../../adapters/model/openai-compatible-model-adapter.service';
import { AssetsModule } from '../assets/assets.module';
import { PromptAssetsModule } from '../prompt-assets/prompt-assets.module';

@Module({
  imports: [AssetsModule, PromptAssetsModule],
  providers: [
    OpenAiCompatibleModelAdapterService,
    {
      provide: MODEL_ADAPTER,
      useFactory: (
        config: ConfigService,
        realModel: OpenAiCompatibleModelAdapterService,
      ) => {
        const visionProvider = config.get<string>('modelProviders.vision.provider');
        const chatProvider = config.get<string>('modelProviders.chat.provider');
        if (visionProvider === 'mock' || chatProvider === 'mock') {
          throw new Error('MOCK_MODEL_PROVIDER_ARCHIVED');
        }

        return realModel;
      },
      inject: [ConfigService, OpenAiCompatibleModelAdapterService],
    },
  ],
  exports: [MODEL_ADAPTER],
})
export class ProductProfileModule {}
