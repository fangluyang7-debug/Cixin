import { RuntimeWorkScope } from '../../../core/runtime/runtime-work-scope';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ImageAsset } from '@prisma/client';
import { RuntimeExecutionContext } from '../../../core/runtime/executor-registry.service';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { StorageAdapter, StoredImageRef } from '../../../adapters/storage/storage-adapter.interface';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import { CandidateSeed, SearchProvider, SEARCH_PROVIDER } from '../../../adapters/search-provider/search-provider.interface';
import { ProductProfileResult } from '../../../adapters/model/model-adapter.interface';
import { EmbeddingProvider, EmbeddingResult } from '../../product-pool/application/embedding-provider.interface';
import { EMBEDDING_PROVIDER } from '../../product-pool/application/embedding.constants';
import { AssetsService } from '../../assets/application/assets.service';
import { QUERY_IMAGE_CONTENT_ADAPTER, QueryImageContentAdapter } from './query-image-content-adapter.interface';
import { SESSION_PRODUCT_PROFILE_ADAPTER, SessionProductProfileAdapter } from './session-product-profile-adapter.interface';
import { SessionsService } from './sessions.service';
import { CandidatesService } from '../../candidates/application/candidates.service';
import { createId } from '../../../common/utils/id';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';
import { NormalizedSubjectBox } from './query-image-preprocess-adapter.interface';

interface ImageRequest {
  assetId?: string;
  imageBase64?: string;
  contentType?: string;
  categoryHint?: string;
  filters?: Record<string, unknown>;
  initialSubjectSelection?: { box: NormalizedSubjectBox };
}
interface StageState {
  dto: ImageRequest;
  userId: string | null;
  sessionId: string;
  asset?: ImageAsset;
  imageUrl?: string;
  cropRef?: StoredImageRef;
  box: NormalizedSubjectBox;
  category?: string;
  profile?: ProductProfileResult;
  embedding?: EmbeddingResult;
  candidates?: CandidateSeed[];
  candidateSnapshotId?: string;
  answer?: string;
}

// Real business stages; URLs and buffers are transient executor data, never graph metadata.
@Injectable()
export class ShoppingImageStagesService {
  constructor(private readonly prisma: PrismaService, private readonly assets: AssetsService,
    private readonly sessions: SessionsService, private readonly candidates: CandidatesService,
    @Inject(OBJECT_STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(QUERY_IMAGE_CONTENT_ADAPTER) private readonly content: QueryImageContentAdapter,
    @Inject(SESSION_PRODUCT_PROFILE_ADAPTER) private readonly profiles: SessionProductProfileAdapter,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(SEARCH_PROVIDER) private readonly search: SearchProvider) {}

  async execute(context: RuntimeExecutionContext): Promise<unknown> {
    context.signal.throwIfAborted();
    const stage = context.task.toolId.replace('shopping.stage.', '');
    const request = context.input as { dto: ImageRequest; userId?: string | null };
    const previous = context.task.dependencies?.[0];
    const state = previous ? context.outputs.get(previous) as StageState : undefined;
    if (stage === 'receive') {
      const dto = request.dto;
      if (!dto || (!dto.assetId && !dto.imageBase64)) throw new BadRequestException('IMAGE_INPUT_REQUIRED');
      const box = dto.initialSubjectSelection?.box ?? { x: 0, y: 0, width: 1, height: 1 };
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 ||
        box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) {
        throw new BadRequestException('IMAGE_BOX_INVALID');
      }
      return { dto, box, userId: request.userId ?? null, sessionId: createId('sess') } satisfies StageState;
    }
    if (!state) throw new Error('RUNTIME_DEPENDENCY_FAILED');
    switch (stage) {
      case 'asset': {
        let assetId = state.dto.assetId;
        if (!assetId) {
          const encoded = state.dto.imageBase64!;
          if (encoded.length > 9 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(state.dto.contentType ?? '')) throw new BadRequestException('IMAGE_INPUT_INVALID');
          const buffer = Buffer.from(encoded, 'base64');
          if (!buffer.length || buffer.length > 6 * 1024 * 1024) throw new BadRequestException('IMAGE_SIZE_INVALID');
          const asset = await this.assets.createImageAsset({ variantType: 'compressed_recognition',
            sourceType: 'camera', isPrimaryRecognitionAsset: true },
            { buffer, mimetype: state.dto.contentType!, originalname: 'capture', size: buffer.length });
          assetId = asset.assetId;
          // Release image bytes as soon as COS has accepted them.
          state.dto = { ...state.dto, imageBase64: undefined, assetId };
        }
        const asset = await this.prisma.imageAsset.findUnique({ where: { id: assetId } });
        if (!asset || asset.uploadStatus !== 'uploaded') throw new NotFoundException('IMAGE_ASSET_NOT_UPLOADED');
        state.asset = asset;
        state.imageUrl = await this.signedUrl(asset);
        break;
      }
      case 'quality-check': {
        const metadata = await this.content.readMetadata(state.imageUrl!);
        if (!metadata.width || !metadata.height || metadata.width < 32 || metadata.height < 32) {
          throw new BadRequestException('IMAGE_QUALITY_TOO_LOW');
        }
        break;
      }
      case 'crop': {
        const crop = await this.content.cropForEmbedding({ signedUrl: state.imageUrl!, box: state.box,
          paddingRatio: 0.05, targetSize: 512, jpegQuality: 90 });
        context.signal.throwIfAborted();
        state.cropRef = await this.storage.putImage({ assetId: createId('crop'), assetGroupId: state.asset!.assetGroupId,
          variantType: 'compressed_recognition', content: crop.buffer, contentType: 'image/jpeg',
          objectKeyPrefix: `runtime/${context.runId}` });
        state.imageUrl = await this.signedUrl(state.cropRef);
        break;
      }
      case 'category': {
        const result = await RuntimeWorkScope.measure('modelMs', () => this.profiles.classifyProductCategory({ imageUrl: state.imageUrl!, categoryHint: state.dto.categoryHint }));
        state.category = normalizeProductCategory(result.category);
        break;
      }
      case 'product-profile': {
        state.profile = await RuntimeWorkScope.measure('modelMs', () => this.profiles.identifyProductProfile({ assetId: state.asset!.id,
          imageUrl: state.imageUrl!, categoryHint: state.category }));
        if (!Number.isFinite(state.profile.confidence) || state.profile.confidence < (context.task.constraints?.minimumQuality ?? 0)) {
          throw new BadRequestException('PRODUCT_PROFILE_QUALITY_TOO_LOW');
        }
        break;
      }
      case 'embedding': {
        state.embedding = await RuntimeWorkScope.measure('modelMs', () => this.embeddings.embedImage({ imageUrl: state.imageUrl!, tags: { category: state.category } }));
        if (!state.embedding.vector.length || !state.embedding.vector.every(Number.isFinite)) throw new Error('RUNTIME_INVALID_EMBEDDING');
        break;
      }
      case 'vector-search': {
        if (!this.search.searchFastAnnShoes) throw new Error('RUNTIME_VECTOR_SEARCH_UNAVAILABLE');
        state.candidates = await this.search.searchFastAnnShoes({ assetId: state.asset!.id,
          keywords: state.profile!.keywords, profile: state.profile, queryEmbedding: state.embedding!.vector,
          queryImageUrl: state.imageUrl, category: state.category, embeddingKind: 'visual', limit: 100,
          filters: { ...state.dto.filters, categoryScope: state.category } });
        break;
      }
      case 'price-stock': {
        // Refresh against the persisted catalog; never invent live marketplace prices.
        const urls = state.candidates!.map(item => item.productUrl);
        const products = urls.length ? await this.prisma.product.findMany({ where: { productUrl: { in: urls } } }) : [];
        const catalog = new Map(products.map(product => [`${product.platform}:${product.productUrl}`, product]));
        state.candidates = state.candidates!.map(item => {
          const product = catalog.get(`${item.platformName}:${item.productUrl}`);
          return product ? { ...item, amount: product.priceAmount, currency: product.currency,
            stockStatus: product.stockStatus === 'in_stock' || product.stockStatus === 'out_of_stock' ? product.stockStatus : 'unknown',
            rawPayload: { ...item.rawPayload, priceSource: 'zeabur_catalog', priceObservedAt: product.updatedAt.toISOString() } } : item;
        });
        break;
      }
      case 'rank': {
        const seen = new Set<string>();
        state.candidates = state.candidates!.filter(item => {
          const key = item.productPoolKey ?? `${item.platformName}:${item.productUrl}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        }).sort((left, right) => Number(left.stockStatus === 'out_of_stock') - Number(right.stockStatus === 'out_of_stock')).slice(0, 30);
        break;
      }
      case 'answer': {
        state.answer = state.candidates!.length ? `找到 ${state.candidates!.length} 个商品候选，价格与库存来自云端商品库。` : '未找到符合当前图片的商品。';
        const profile = state.profile!;
        await this.prisma.querySession.create({ data: { id: state.sessionId, assetId: state.asset!.id,
          userId: state.userId, status: 'processing', stage: 'runtime_persist', entrySource: 'android_app',
          categoryHint: state.category, profileSnapshot: { create: { id: createId('profile'), category: profile.category,
            brand: profile.brand, size: profile.size, color: profile.color, keywordsJson: JSON.stringify(profile.keywords),
            styleTagsJson: JSON.stringify(profile.styleTags), sceneTagsJson: JSON.stringify(profile.sceneTags),
            confidence: profile.confidence, rawJson: JSON.stringify({ ...profile.raw, detailedProfileStatus: 'ready',
              modelLine: profile.modelLine, colorFamily: profile.colorFamily, colorway: profile.colorway, shoeType: profile.shoeType }) } },
          filterSnapshots: { create: { id: createId('filter'), turnIndex: 0,
            stockOnly: state.dto.filters?.stockOnly === true, sortRule: 'relevance_desc', rawJson: JSON.stringify(state.dto.filters ?? {}) } } } });
        context.signal.throwIfAborted();
        await this.prisma.queryImagePreprocessSnapshot.create({ data: { id: createId('query_pre'), sessionId: state.sessionId,
          assetId: state.asset!.id, selectionSource: 'runtime', status: 'ready', selectedBoxJson: JSON.stringify(state.box),
          cropImageRefJson: JSON.stringify(state.cropRef), embeddingProvider: state.embedding!.provider,
          embeddingModel: state.embedding!.modelName, embeddingDimension: state.embedding!.dimension,
          embeddingVectorHash: state.embedding!.vectorHash, embeddingVectorJson: JSON.stringify(state.embedding!.vector) } });
        state.candidateSnapshotId = await this.sessions.writeRuntimeCandidateSnapshot({ sessionId: state.sessionId,
          turnIndex: 0, candidates: state.candidates!, fallback: null, appliedFilter: state.dto.filters ?? {} });
        break;
      }
      case 'result': {
        await this.prisma.querySession.update({ where: { id: state.sessionId }, data: { status: 'ready', stage: 'candidate_ready' } });
        return { ...(await this.sessions.getSession(state.sessionId)),
          candidates: await this.candidates.getCurrentCandidates(state.sessionId), assistantMessage: state.answer,
          resultRef: `session:${state.sessionId}`, imageSearch: { candidateSnapshotId: state.candidateSnapshotId, searchMode: 'runtime_staged' } };
      }
      default: throw new Error('RUNTIME_UNKNOWN_IMAGE_STAGE');
    }
    context.signal.throwIfAborted();
    return state;
  }

  private async signedUrl(ref: { bucketGroup: string; objectKey: string }): Promise<string> {
    const url = await this.storage.getSignedReadUrl?.({ bucketGroup: ref.bucketGroup, objectKey: ref.objectKey, expiresSeconds: 300 });
    if (!url) throw new Error('RUNTIME_COS_SIGNING_UNAVAILABLE');
    return url;
  }
}
