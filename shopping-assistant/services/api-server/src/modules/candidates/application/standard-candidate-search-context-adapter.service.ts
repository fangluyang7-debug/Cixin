import { Injectable } from '@nestjs/common';
import {
  FilterSnapshot,
  ProductProfileSnapshot,
  QueryImagePreprocessSnapshot,
} from '@prisma/client';
import { ProductProfileResult } from '../../../adapters/model/model-adapter.interface';
import {
  normalizeProductCategory,
  productCategoryKeywords,
} from '../../../common/catalog/product-categories';
import { fromJson } from '../../../common/utils/json';
import { CandidateSearchContextAdapter } from './candidate-search-context-adapter.interface';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardCandidateSearchContextAdapterService
  implements CandidateSearchContextAdapter
{
  toQueryEmbedding(
    preprocess: Pick<QueryImagePreprocessSnapshot, 'embeddingVectorJson'> | null,
  ): number[] {
    if (!preprocess) return [];
    return fromJson<number[]>(preprocess.embeddingVectorJson, []).filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
  }

  toFilterRaw(
    filter: Pick<FilterSnapshot, 'rawJson'> | null,
  ): Record<string, unknown> {
    return filter
      ? fromJson<JsonRecord>(filter.rawJson, {})
      : { sortRule: 'relevance_desc', stockOnly: false };
  }

  toProfile(snapshot: ProductProfileSnapshot | null): ProductProfileResult | null {
    if (!snapshot) return null;
    const raw = fromJson<JsonRecord>(snapshot.rawJson, {});
    return {
      category: snapshot.category,
      brand: snapshot.brand,
      modelLine: typeof raw.modelLine === 'string' ? raw.modelLine : null,
      colorFamily:
        typeof raw.colorFamily === 'string' ? raw.colorFamily : null,
      colorway: typeof raw.colorway === 'string' ? raw.colorway : null,
      shoeType: typeof raw.shoeType === 'string' ? raw.shoeType : null,
      size: snapshot.size,
      color: snapshot.color,
      styleTags: fromJson<string[]>(snapshot.styleTagsJson, []),
      sceneTags: fromJson<string[]>(snapshot.sceneTagsJson, []),
      keywords: fromJson<string[]>(snapshot.keywordsJson, []),
      confidence: snapshot.confidence ?? 0,
      raw,
    };
  }

  toKeywords(snapshot: Pick<ProductProfileSnapshot, 'keywordsJson' | 'category'> | null): string[] {
    if (!snapshot) return productCategoryKeywords('general');
    const fallbackKeywords = productCategoryKeywords(
      normalizeProductCategory(snapshot.category, 'general'),
    );
    const keywords = fromJson<string[]>(snapshot.keywordsJson, []).filter(
      (keyword): keyword is string =>
        typeof keyword === 'string' && keyword.trim().length > 0,
    );
    return keywords.length > 0 ? keywords : fallbackKeywords;
  }
}
