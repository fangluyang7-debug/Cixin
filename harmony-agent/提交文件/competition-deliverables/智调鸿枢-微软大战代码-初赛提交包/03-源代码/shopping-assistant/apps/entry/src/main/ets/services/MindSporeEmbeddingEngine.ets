import { common } from '@kit.AbilityKit';
import mindSporeLite from '@ohos.ai.mindSporeLite';
import hilog from '@ohos.hilog';
import { NeuralEmbeddingArtifact, NeuralValidationQuery } from '../models/NeuralEmbeddingModel';

const SELF_CHECK_COSINE_THRESHOLD: number = 0.999;

export class MindSporeEmbeddingEngine {
  private static instance: MindSporeEmbeddingEngine | null = null;
  private context: common.Context | null = null;
  private artifact: NeuralEmbeddingArtifact | null = null;
  private vocabularyIndex: Map<string, number> = new Map<string, number>();
  private modelBuffer: ArrayBuffer | null = null;
  private models: Map<number, mindSporeLite.Model> = new Map<number, mindSporeLite.Model>();
  private modelPromises: Map<number, Promise<mindSporeLite.Model>> =
    new Map<number, Promise<mindSporeLite.Model>>();

  private constructor() {
  }

  public static getInstance(): MindSporeEmbeddingEngine {
    if (MindSporeEmbeddingEngine.instance === null) {
      MindSporeEmbeddingEngine.instance = new MindSporeEmbeddingEngine();
    }
    return MindSporeEmbeddingEngine.instance;
  }

  public async initialize(
    context: common.Context,
    artifact: NeuralEmbeddingArtifact
  ): Promise<void> {
    if (this.modelBuffer !== null && this.artifact?.modelVersion === artifact.modelVersion) {
      return;
    }
    const modelBytes: Uint8Array =
      await context.resourceManager.getRawFileContent(artifact.modelFile);
    this.context = context;
    this.artifact = artifact;
    this.modelBuffer = modelBytes.slice().buffer as ArrayBuffer;
    this.models.clear();
    this.modelPromises.clear();
    this.vocabularyIndex = new Map<string, number>();
    for (let index: number = 0; index < artifact.vocabulary.length; index++) {
      this.vocabularyIndex.set(artifact.vocabulary[index], index + 1);
    }

    await this.getOrLoadModel(1);
    await this.runSelfCheck();
    hilog.info(
      0x0000,
      'MindSporeEmbeddingEngine',
      `Loaded ${artifact.modelVersion}: bytes=${modelBytes.length}, sequence=${artifact.sequenceLength}, dim=${artifact.embeddingDimension}`
    );
  }

  public async encode(text: string, requestedThreads: number): Promise<Float32Array> {
    if (this.artifact === null) {
      throw new Error('MindSpore Lite embedding model has not been initialized.');
    }
    const tokenIds: Int32Array = this.tokenize(text);
    return this.predictTokenIds(tokenIds, requestedThreads);
  }

  private async predictTokenIds(
    tokenIds: Int32Array,
    requestedThreads: number
  ): Promise<Float32Array> {
    const threadCount: number = this.resolveThreadCount(requestedThreads);
    const model: mindSporeLite.Model = await this.getOrLoadModel(threadCount);
    const inputs: mindSporeLite.MSTensor[] = model.getInputs();
    if (inputs.length !== 1) {
      throw new Error(`Embedding model expects one input, got ${inputs.length}.`);
    }
    inputs[0].setData(tokenIds.buffer as ArrayBuffer);
    const outputs: mindSporeLite.MSTensor[] = await model.predict(inputs);
    if (outputs.length !== 1) {
      throw new Error(`Embedding model expects one output, got ${outputs.length}.`);
    }
    return new Float32Array(outputs[0].getData());
  }

  private getOrLoadModel(threadCount: number): Promise<mindSporeLite.Model> {
    const cached: mindSporeLite.Model | undefined = this.models.get(threadCount);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const pending: Promise<mindSporeLite.Model> | undefined =
      this.modelPromises.get(threadCount);
    if (pending !== undefined) {
      return pending;
    }
    if (this.modelBuffer === null) {
      return Promise.reject(new Error('MindSpore Lite model bytes are unavailable.'));
    }
    const runtimeContext: mindSporeLite.Context = {
      target: ['cpu'],
      cpu: {
        threadNum: threadCount,
        threadAffinityMode: mindSporeLite.ThreadAffinityMode.NO_AFFINITIES,
        precisionMode: 'enforce_fp32'
      }
    };
    const loadPromise: Promise<mindSporeLite.Model> =
      mindSporeLite.loadModelFromBuffer(this.modelBuffer, runtimeContext);
    this.modelPromises.set(threadCount, loadPromise);
    return loadPromise.then((model: mindSporeLite.Model) => {
      this.models.set(threadCount, model);
      this.modelPromises.delete(threadCount);
      return model;
    }).catch((error: Error) => {
      this.modelPromises.delete(threadCount);
      throw error;
    });
  }

  private tokenize(text: string): Int32Array {
    if (this.artifact === null) {
      throw new Error('Embedding metadata is unavailable.');
    }
    const tokenIds: number[] = [];
    const lower: string = text.toLowerCase();
    let segment: string = '';
    let segmentIsAscii: boolean = false;

    const pushToken = (token: string): void => {
      if (tokenIds.length >= this.artifact!.sequenceLength) {
        return;
      }
      const tokenId: number | undefined = this.vocabularyIndex.get(token);
      if (tokenId !== undefined) {
        tokenIds.push(tokenId);
      }
    };
    const flushSegment = (): void => {
      if (segment.length === 0 || tokenIds.length >= this.artifact!.sequenceLength) {
        segment = '';
        return;
      }
      if (segmentIsAscii) {
        pushToken(`w:${segment}`);
      }
      const maxSize: number = Math.min(3, segment.length);
      for (let size: number = 1; size <= maxSize; size++) {
        for (let start: number = 0; start + size <= segment.length; start++) {
          pushToken(`c${size}:${segment.substring(start, start + size)}`);
        }
      }
      segment = '';
    };

    for (let index: number = 0; index < lower.length; index++) {
      const code: number = lower.charCodeAt(index);
      const isAsciiAlphaNumeric: boolean =
        (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
      const isCjk: boolean = code >= 0x4E00 && code <= 0x9FFF;
      if (!isAsciiAlphaNumeric && !isCjk) {
        flushSegment();
        continue;
      }
      if (segment.length > 0 && isAsciiAlphaNumeric !== segmentIsAscii) {
        flushSegment();
      }
      segmentIsAscii = isAsciiAlphaNumeric;
      segment += lower[index];
    }
    flushSegment();

    const result: Int32Array = new Int32Array(this.artifact.sequenceLength);
    const length: number = Math.min(tokenIds.length, result.length);
    for (let index: number = 0; index < length; index++) {
      result[index] = tokenIds[index];
    }
    return result;
  }

  private async runSelfCheck(): Promise<void> {
    if (this.artifact === null || this.artifact.validationQueries.length === 0) {
      throw new Error('Embedding artifact does not contain a runtime validation vector.');
    }
    const validation: NeuralValidationQuery = this.artifact.validationQueries[0];
    const tokenIds: Int32Array = new Int32Array(validation.tokenIds);
    const actual: Float32Array = await this.predictTokenIds(tokenIds, 1);
    const cosine: number = this.cosine(actual, validation.embedding);
    if (cosine < SELF_CHECK_COSINE_THRESHOLD) {
      throw new Error(
        `MindSpore Lite self-check failed: cosine=${cosine.toFixed(6)}.`
      );
    }
    hilog.info(
      0x0000,
      'MindSporeEmbeddingEngine',
      `Runtime self-check passed: query=${validation.text}, cosine=${cosine.toFixed(6)}`
    );
  }

  private cosine(actual: Float32Array, expected: number[]): number {
    const length: number = Math.min(actual.length, expected.length);
    let dot: number = 0;
    let leftNorm: number = 0;
    let rightNorm: number = 0;
    for (let index: number = 0; index < length; index++) {
      dot += actual[index] * expected[index];
      leftNorm += actual[index] * actual[index];
      rightNorm += expected[index] * expected[index];
    }
    const denominator: number = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
    return denominator > 0 ? dot / denominator : 0;
  }

  private resolveThreadCount(requestedThreads: number): number {
    if (requestedThreads >= 4) {
      return 4;
    }
    if (requestedThreads >= 2) {
      return 2;
    }
    return 1;
  }
}
