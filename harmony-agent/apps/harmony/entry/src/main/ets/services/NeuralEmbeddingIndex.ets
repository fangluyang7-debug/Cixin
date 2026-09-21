import { NormalizationProgress, validateNormalizationProgress, appendNormalizationValues } from './NormalizationCheckpoint';
import { collectVectorPartitions } from './VectorPartitionResults';
import { parseSearchConstraints, matchesSearchConstraints, SearchConstraints } from './SearchConstraints';
import { taskpool } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import util from '@ohos.util';
import hilog from '@ohos.hilog';
import {
  EmbeddingModelInfo,
  EmbeddingSearchResult,
  ProductEmbeddingSeed
} from '../models/EmbeddingModel';
import { NeuralEmbeddingArtifact } from '../models/NeuralEmbeddingModel';
import { Product } from '../models/Product';
import { StoreManager } from '../database/StoreManager';
import { MindSporeEmbeddingEngine } from './MindSporeEmbeddingEngine';
import { computeQuantizedNormChunk, scoreQuantizedVectorChunk } from './VectorSearchWorker';
import { CancellationSignal } from 'scheduler';

export { NormalizationProgress } from './NormalizationCheckpoint';

const ARTIFACT_RAWFILE: string = 'soleai_neural_embedding_v1.json';
const EXPECTED_FORMAT_VERSION: number = 2;
const MAX_PRODUCT_COUNT: number = 3000;

interface IndexedScore {
  index: number;
  score: number;
}

export interface VectorSearchTelemetry {
  executionPath: string;
  configuredPartitions: number;
  scannedCount: number;
}

export class NeuralEmbeddingIndex {
  private static instance: NeuralEmbeddingIndex | null = null;
  private initializationPromise: Promise<void> | null = null;
  private ready: boolean = false;
  private artifact: NeuralEmbeddingArtifact | null = null;
  private products: Product[] = [];
  private productVectorBytes: Uint8Array = new Uint8Array(0);
  private normCaches: Map<number, Float32Array> = new Map<number, Float32Array>();

  private constructor() {
  }

  public static getInstance(): NeuralEmbeddingIndex {
    if (NeuralEmbeddingIndex.instance === null) {
      NeuralEmbeddingIndex.instance = new NeuralEmbeddingIndex();
    }
    return NeuralEmbeddingIndex.instance;
  }

  public initialize(context: common.Context): Promise<void> {
    if (this.initializationPromise === null) {
      this.initializationPromise = this.load(context);
    }
    return this.initializationPromise;
  }

  public async waitUntilReady(): Promise<void> {
    if (this.initializationPromise !== null) {
      await this.initializationPromise;
    }
    if (!this.ready) {
      throw new Error('Neural embedding index has not been initialized.');
    }
  }

  public isReady(): boolean {
    return this.ready;
  }

  public getModelInfo(): EmbeddingModelInfo | null {
    if (this.artifact === null) {
      return null;
    }
    return {
      modelId: this.artifact.modelId,
      modelVersion: this.artifact.modelVersion,
      encoderType: this.artifact.encoderType,
      vocabularySize: this.artifact.vocabularySize,
      embeddingDimension: this.artifact.embeddingDimension,
      productCount: this.artifact.productCount,
      corpusSha256: this.artifact.corpusSha256,
      explainedVarianceRatio: 0
    };
  }

  public async search(
    query: string,
    requestedDimension: number,
    requestedPartitions: number,
    topK: number
  ): Promise<EmbeddingSearchResult[]> {
    const vector: Float32Array = await this.encodeQuery(query, requestedPartitions);
    return this.searchVector(vector, requestedDimension, requestedPartitions, topK);
  }

  public async encodeQuery(query: string, requestedPartitions: number): Promise<Float32Array> {
    await this.waitUntilReady();
    return MindSporeEmbeddingEngine.getInstance().encode(query, Math.max(1, Math.min(4, requestedPartitions)));
  }

  public async searchVector(queryVector: Float32Array, requestedDimension: number,
    requestedPartitions: number, topK: number, query: string = '',
    telemetry?: VectorSearchTelemetry): Promise<EmbeddingSearchResult[]> {
    await this.waitUntilReady();
    if (this.artifact === null || this.products.length === 0) {
      return [];
    }
    const dimension: number = this.resolveDimension(requestedDimension);
    const partitionCount: number = Math.max(
      1,
      Math.min(4, Math.min(Math.floor(requestedPartitions), this.products.length))
    );
    const queryValues: number[] = [];
    for (let index: number = 0; index < dimension; index++) {
      queryValues.push(queryVector[index]);
    }

    if (telemetry !== undefined) {
      telemetry.executionPath = 'taskpool'; telemetry.configuredPartitions = partitionCount;
      telemetry.scannedCount = this.products.length;
    }
    const chunkSize: number = Math.ceil(this.products.length / partitionCount);
    const taskPromises: Promise<Object>[] = [];
    const chunkStarts: number[] = [];
    for (let partitionIndex: number = 0; partitionIndex < partitionCount; partitionIndex++) {
      const start: number = partitionIndex * chunkSize;
      const end: number = Math.min(this.products.length, start + chunkSize);
      if (start >= end) {
        continue;
      }
      const byteStart: number = start * this.artifact.embeddingDimension;
      const byteEnd: number = end * this.artifact.embeddingDimension;
      const vectorChunk: Uint8Array = this.productVectorBytes.slice(byteStart, byteEnd);
      const scaleChunk: number[] = this.artifact.productScales.slice(start, end);
      const normChunk: number[] = [];
      const cachedNorms: Float32Array | undefined = this.normCaches.get(dimension);
      if (cachedNorms !== undefined && cachedNorms.length === this.products.length) {
        for (let normIndex: number = start; normIndex < end; normIndex++) {
          normChunk.push(cachedNorms[normIndex]);
        }
      }
      const task: taskpool.Task = new taskpool.Task(
        scoreQuantizedVectorChunk,
        queryValues,
        vectorChunk.buffer,
        scaleChunk,
        normChunk,
        this.artifact.embeddingDimension,
        dimension,
        end - start
      );
      chunkStarts.push(start);
      taskPromises.push(taskpool.execute(task, taskpool.Priority.HIGH).catch((): Object => [] as number[]));
    }

    try {
      const chunkResults: number[][] = await collectVectorPartitions(taskPromises);
      const scores: IndexedScore[] = [];
      for (let chunkIndex: number = 0; chunkIndex < chunkResults.length; chunkIndex++) {
        const chunkScores: number[] = chunkResults[chunkIndex] as number[];
        if (chunkScores.length === 0) { throw new Error('TaskPool partition failed.'); }
        const start: number = chunkStarts[chunkIndex];
        for (let localIndex: number = 0; localIndex < chunkScores.length; localIndex++) {
          scores.push({ index: start + localIndex, score: chunkScores[localIndex] });
        }
      }
      return this.selectTopResults(scores, topK, query);
    } catch (error) {
      hilog.error(
        0x0000,
        'NeuralEmbeddingIndex',
        `TaskPool vector search failed, using serial fallback: ${JSON.stringify(error)}`
      );
      if (telemetry !== undefined) { telemetry.executionPath = 'serial_fallback'; telemetry.configuredPartitions = 1; }
      return this.searchSerial(queryVector, dimension, topK, query);
    }
  }

  public async rebuildNormalizationCache(
    requestedDimension: number,
    requestedPartitions: number
  ): Promise<number> {
    await this.waitUntilReady();
    if (this.artifact === null || this.products.length === 0) {
      return 0;
    }
    const dimension: number = this.resolveDimension(requestedDimension);
    const partitionCount: number = Math.max(
      1,
      Math.min(4, Math.min(Math.floor(requestedPartitions), this.products.length))
    );
    const chunkSize: number = Math.ceil(this.products.length / partitionCount);
    const taskPromises: Promise<Object>[] = [];
    const chunkStarts: number[] = [];
    for (let partitionIndex: number = 0; partitionIndex < partitionCount; partitionIndex++) {
      const start: number = partitionIndex * chunkSize;
      const end: number = Math.min(this.products.length, start + chunkSize);
      if (start >= end) {
        continue;
      }
      const byteStart: number = start * this.artifact.embeddingDimension;
      const byteEnd: number = end * this.artifact.embeddingDimension;
      const vectorChunk: Uint8Array = this.productVectorBytes.slice(byteStart, byteEnd);
      const scaleChunk: number[] = this.artifact.productScales.slice(start, end);
      const task: taskpool.Task = new taskpool.Task(
        computeQuantizedNormChunk,
        vectorChunk.buffer,
        scaleChunk,
        this.artifact.embeddingDimension,
        dimension,
        end - start
      );
      chunkStarts.push(start);
      taskPromises.push(taskpool.execute(task, taskpool.Priority.LOW));
    }

    const chunkResults: Object[] = await Promise.all(taskPromises);
    const norms: Float32Array = new Float32Array(this.products.length);
    for (let chunkIndex: number = 0; chunkIndex < chunkResults.length; chunkIndex++) {
      const chunkNorms: number[] = chunkResults[chunkIndex] as number[];
      const start: number = chunkStarts[chunkIndex];
      for (let localIndex: number = 0; localIndex < chunkNorms.length; localIndex++) {
        norms[start + localIndex] = chunkNorms[localIndex];
      }
    }
    this.normCaches.set(dimension, norms);
    hilog.info(
      0x0000,
      'NeuralEmbeddingIndex',
      `Rebuilt norm cache: products=${norms.length}, dim=${dimension}, partitions=${partitionCount}`
    );
    return norms.length;
  }

  public async rebuildNormalizationChunk(previous: NormalizationProgress | undefined,
    signal: CancellationSignal, chunkSize: number = 128): Promise<NormalizationProgress> {
    await this.waitUntilReady();
    if (this.artifact === null) { throw new Error('Index is not ready.'); }
    const dimension: number = this.artifact.embeddingDimension;
    const progress: NormalizationProgress = previous ?? {
      cursor: 0, dimension: dimension, modelVersion: this.artifact.modelVersion, norms: []
    };
    validateNormalizationProgress(progress, this.artifact.modelVersion, dimension, this.products.length);
    if (signal.isCancellationRequested) { throw new Error('Index update cancelled.'); }
    const start: number = progress.cursor;
    const end: number = Math.min(this.products.length, start + chunkSize);
    if (end > start) {
      const task: taskpool.Task = new taskpool.Task(computeQuantizedNormChunk,
        this.productVectorBytes.slice(start * dimension, end * dimension).buffer,
        this.artifact.productScales.slice(start, end), dimension, dimension, end - start);
      const values: number[] = await taskpool.execute(task, taskpool.Priority.LOW) as number[];
      if (signal.isCancellationRequested) { throw new Error('Index update cancelled.'); }
      appendNormalizationValues(progress, values, end);
    }
    // Publish only a complete cache; cancellation leaves the previous cache usable.
    if (end === this.products.length && !signal.isCancellationRequested) {
      this.normCaches.set(dimension, new Float32Array(progress.norms));
    }
    return progress;
  }

  private async load(context: common.Context): Promise<void> {
    const rawData: Uint8Array =
      await context.resourceManager.getRawFileContent(ARTIFACT_RAWFILE);
    const decoder: util.TextDecoder = new util.TextDecoder('utf-8', { ignoreBOM: true });
    const artifact: NeuralEmbeddingArtifact =
      JSON.parse(decoder.decodeToString(rawData)) as NeuralEmbeddingArtifact;
    this.validateArtifact(artifact);

    const base64: util.Base64Helper = new util.Base64Helper();
    const productBytes: Uint8Array =
      base64.decodeSync(artifact.quantizedProductVectorsBase64);
    if (productBytes.length !== artifact.productCount * artifact.embeddingDimension) {
      throw new Error('Neural product vector byte length does not match model metadata.');
    }

    const products: Product[] =
      await StoreManager.getInstance().queryAllProducts(MAX_PRODUCT_COUNT);
    if (products.length !== artifact.productCount) {
      throw new Error(
        `Neural index expects ${artifact.productCount} products, but RdbStore has ${products.length}.`
      );
    }
    for (let index: number = 0; index < products.length; index++) {
      if (products[index].externalId !== artifact.productExternalIds[index]) {
        throw new Error(`Product/neural-vector order mismatch at row ${index}.`);
      }
    }

    this.artifact = artifact;
    this.products = products;
    this.productVectorBytes = productBytes;
    await MindSporeEmbeddingEngine.getInstance().initialize(context, artifact);

    const embeddingSeeds: ProductEmbeddingSeed[] = [];
    for (let index: number = 0; index < products.length; index++) {
      const byteStart: number = index * artifact.embeddingDimension;
      embeddingSeeds.push({
        productId: products[index].databaseId,
        modelVersion: artifact.modelVersion,
        dimension: artifact.embeddingDimension,
        vector: productBytes.slice(byteStart, byteStart + artifact.embeddingDimension),
        vectorScale: artifact.productScales[index]
      });
    }
    await StoreManager.getInstance().ensureProductEmbeddings(
      embeddingSeeds,
      artifact.modelVersion
    );
    this.ready = true;
    hilog.info(
      0x0000,
      'NeuralEmbeddingIndex',
      `Loaded ${artifact.modelVersion}: products=${products.length}, vocab=${artifact.vocabularySize}, dim=${artifact.embeddingDimension}`
    );
  }

  private validateArtifact(artifact: NeuralEmbeddingArtifact): void {
    if (artifact.formatVersion !== EXPECTED_FORMAT_VERSION ||
      artifact.modelFile.length === 0 ||
      artifact.sequenceLength !== 48 ||
      artifact.productCount !== artifact.productExternalIds.length ||
      artifact.productCount !== artifact.productScales.length ||
      artifact.vocabularySize !== artifact.vocabulary.length ||
      artifact.embeddingDimension !== 256 ||
      artifact.validationQueries.length === 0) {
      throw new Error('Neural embedding artifact metadata is inconsistent.');
    }
    if (artifact.supportedDimensions.indexOf(16) < 0 ||
      artifact.supportedDimensions.indexOf(64) < 0 ||
      artifact.supportedDimensions.indexOf(256) < 0) {
      throw new Error('Neural embedding artifact does not provide all required dimensions.');
    }
  }

  private resolveDimension(requestedDimension: number): number {
    if (requestedDimension <= 16) {
      return 16;
    }
    if (requestedDimension <= 64) {
      return 64;
    }
    return 256;
  }

  private searchSerial(
    queryVector: Float32Array,
    dimension: number,
    topK: number,
    query: string = ''
  ): EmbeddingSearchResult[] {
    if (this.artifact === null) {
      return [];
    }
    const scores: IndexedScore[] = [];
    let queryNormSquared: number = 0;
    for (let dimensionIndex: number = 0; dimensionIndex < dimension; dimensionIndex++) {
      queryNormSquared += queryVector[dimensionIndex] * queryVector[dimensionIndex];
    }
    const queryNorm: number = Math.sqrt(queryNormSquared);
    for (let productIndex: number = 0; productIndex < this.products.length; productIndex++) {
      const scale: number = this.artifact.productScales[productIndex];
      const rowOffset: number = productIndex * this.artifact.embeddingDimension;
      let dotProduct: number = 0;
      let productNormSquared: number = 0;
      for (let dimensionIndex: number = 0; dimensionIndex < dimension; dimensionIndex++) {
        const rawByte: number = this.productVectorBytes[rowOffset + dimensionIndex];
        const signedValue: number = rawByte > 127 ? rawByte - 256 : rawByte;
        const productValue: number = signedValue * scale;
        dotProduct += queryVector[dimensionIndex] * productValue;
        productNormSquared += productValue * productValue;
      }
      const denominator: number = queryNorm * Math.sqrt(productNormSquared);
      scores.push({
        index: productIndex,
        score: denominator > 0 ? dotProduct / denominator : 0
      });
    }
    return this.selectTopResults(scores, topK, query);
  }

  private selectTopResults(
    scores: IndexedScore[],
    topK: number,
    query: string = ''
  ): EmbeddingSearchResult[] {
    const constraints: SearchConstraints = parseSearchConstraints(query);
    scores = scores.filter((item: IndexedScore) => matchesSearchConstraints(
      this.products[item.index].title, this.products[item.index].price, constraints));
    scores.sort((left: IndexedScore, right: IndexedScore) => right.score - left.score);
    const limit: number = Math.max(0, Math.min(Math.floor(topK), scores.length));
    const results: EmbeddingSearchResult[] = [];
    for (let index: number = 0; index < limit; index++) {
      results.push({
        product: this.products[scores[index].index],
        score: scores[index].score
      });
    }
    return results;
  }
}
