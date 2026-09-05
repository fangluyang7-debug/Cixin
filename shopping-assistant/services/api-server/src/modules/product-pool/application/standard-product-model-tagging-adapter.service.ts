import { Inject, Injectable } from '@nestjs/common';
import {
  MODEL_ADAPTER,
  ModelAdapter,
  ProductTagInput,
  ProductTagResult,
} from '../../../adapters/model/model-adapter.interface';
import { ProductModelTaggingAdapter } from './product-model-tagging-adapter.interface';

@Injectable()
export class StandardProductModelTaggingAdapterService
  implements ProductModelTaggingAdapter
{
  constructor(
    @Inject(MODEL_ADAPTER)
    private readonly model: ModelAdapter,
  ) {}

  tagProduct(input: ProductTagInput): Promise<ProductTagResult> {
    return this.model.tagProduct(input);
  }
}
