export default () => ({
  port: Number(process.env.API_SERVER_PORT ?? process.env.PORT ?? 3000),
  jsonBodyLimit: process.env.API_JSON_BODY_LIMIT ?? "10mb",
  databaseUrl: process.env.DATABASE_URL,
  runtime: {
    nodeEnv: process.env.NODE_ENV ?? "development",
    allowMockProviders: false,
    platformAdapter: process.env.RUNTIME_PLATFORM_ADAPTER ?? "auto",
    networkProbeUrl: optionalString(process.env.RUNTIME_NETWORK_PROBE_URL),
    networkProbeTimeoutMs: Number(process.env.RUNTIME_NETWORK_PROBE_TIMEOUT_MS ?? 3000),
    minimumPerformanceSamples: Number(
      process.env.RUNTIME_MINIMUM_PERFORMANCE_SAMPLES ?? 3,
    ),
    switchThreshold: Number(process.env.RUNTIME_SWITCH_THRESHOLD ?? 0.05),
    lowBatteryPercent: Number(process.env.RUNTIME_LOW_BATTERY_PERCENT ?? 20),
    highTemperatureCelsius: Number(
      process.env.RUNTIME_HIGH_TEMPERATURE_CELSIUS ?? 75,
    ),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-before-deploy",
    jwtExpiresSeconds: Number(
      process.env.JWT_EXPIRES_SECONDS ?? 60 * 60 * 24 * 30,
    ),
  },
  searchProvider: process.env.SEARCH_PROVIDER ?? "local_product_pool",
  productDataProvider:
    process.env.PRODUCT_DATA_PROVIDER ??
    process.env.SEARCH_PROVIDER ??
    "local_product_pool",
  productImport: {
    imageTargetSize: Number(
      process.env.PRODUCT_IMPORT_IMAGE_TARGET_SIZE ?? 320,
    ),
    imageJpegQuality: Number(
      process.env.PRODUCT_IMPORT_IMAGE_JPEG_QUALITY ?? 88,
    ),
  },
  productPool: {
    resumeImportOnStart: parseBoolean(
      process.env.PRODUCT_POOL_RESUME_IMPORT_ON_START,
      false,
    ),
    resumeImportBatchLimit: Number(
      process.env.PRODUCT_POOL_RESUME_IMPORT_BATCH_LIMIT ?? 1,
    ),
    statsCacheTtlSeconds: Number(
      process.env.PRODUCT_POOL_STATS_CACHE_TTL_SECONDS ?? 60,
    ),
    statsSnapshotFreshSeconds: Number(
      process.env.PRODUCT_POOL_STATS_SNAPSHOT_FRESH_SECONDS ?? 60,
    ),
    statsSlowQueryMs: Number(
      process.env.PRODUCT_POOL_STATS_SLOW_QUERY_MS ?? 500,
    ),
  },
  marketplace: {
    searchMode: process.env.MARKETPLACE_SEARCH_MODE ?? "official",
    enabledPlatforms:
      process.env.MARKETPLACE_ENABLED_PLATFORMS ?? "taobao,douyin,pdd,dewu,jd",
    taobao: {
      apiBaseUrl: process.env.MARKETPLACE_TAOBAO_API_BASE_URL,
      apiKey: process.env.MARKETPLACE_TAOBAO_API_KEY,
    },
    douyin: {
      apiBaseUrl: process.env.MARKETPLACE_DOUYIN_API_BASE_URL,
      apiKey: process.env.MARKETPLACE_DOUYIN_API_KEY,
    },
    pdd: {
      apiBaseUrl: process.env.MARKETPLACE_PDD_API_BASE_URL,
      apiKey: process.env.MARKETPLACE_PDD_API_KEY,
    },
    dewu: {
      apiBaseUrl: process.env.MARKETPLACE_DEWU_API_BASE_URL,
      apiKey: process.env.MARKETPLACE_DEWU_API_KEY,
    },
    jd: {
      apiBaseUrl: process.env.MARKETPLACE_JD_API_BASE_URL,
      apiKey: process.env.MARKETPLACE_JD_API_KEY,
    },
  },
  ann: {
    provider: process.env.ANN_PROVIDER ?? "sqlite_vec",
    topK: Number(process.env.ANN_TOP_K ?? 50),
    minScore: Number(process.env.ANN_MIN_SCORE ?? 0.68),
    scanBatchSize: Number(process.env.ANN_SCAN_BATCH_SIZE ?? 500),
    slowQueryMs: Number(process.env.ANN_SLOW_QUERY_MS ?? 2000),
  },
  search: {
    pipelineMode: parseSearchPipelineMode(process.env.SEARCH_PIPELINE_MODE),
    globalCandidateLimit: Number(
      process.env.SEARCH_GLOBAL_CANDIDATE_LIMIT ?? 30,
    ),
    initialReturnLimit: Number(process.env.SEARCH_INITIAL_RETURN_LIMIT ?? 30),
    prefetchLimit: Number(process.env.SEARCH_PREFETCH_LIMIT ?? 120),
    productScanLimit: parseOptionalPositiveInteger(
      process.env.SEARCH_PRODUCT_SCAN_LIMIT,
    ),
    imageAnnRecallMultiplier: Number(
      process.env.IMAGE_ANN_RECALL_MULTIPLIER ?? 4,
    ),
    imageAnnRecallMinCandidates: Number(
      process.env.IMAGE_ANN_RECALL_MIN_CANDIDATES ?? 360,
    ),
    imageAnnRecallMaxCandidates: Number(
      process.env.IMAGE_ANN_RECALL_MAX_CANDIDATES ?? 800,
    ),
    initialDetailedProfileWaitMs: Number(
      process.env.SEARCH_INITIAL_DETAILED_PROFILE_WAIT_MS ?? 1500,
    ),
    lightweightProfileWaitMs: Number(
      process.env.SEARCH_LIGHTWEIGHT_PROFILE_WAIT_MS ?? 30000,
    ),
    detailedProfileTimeoutMs: Number(
      process.env.SEARCH_DETAILED_PROFILE_TIMEOUT_MS ?? 30000,
    ),
    categoryRecognitionTimeoutMs: Number(
      process.env.SEARCH_CATEGORY_RECOGNITION_TIMEOUT_MS ?? 30000,
    ),
    visualVerifyMaxCandidates: Number(
      process.env.VISUAL_VERIFY_MAX_CANDIDATES ??
        process.env.LOCAL_PRODUCT_VISUAL_VERIFY_TOP_K ??
        3,
    ),
    visualVerifyConcurrency: Number(
      process.env.VISUAL_VERIFY_CONCURRENCY ?? 10,
    ),
    visualVerifyTimeoutMs: Number(process.env.VISUAL_VERIFY_TIMEOUT_MS ?? 5000),
    visualVerifyMinConfidence: Number(
      process.env.LOCAL_PRODUCT_VISUAL_VERIFY_MIN_CONFIDENCE ?? 0.5,
    ),
    resultMinScore: Number(process.env.SEARCH_RESULT_MIN_SCORE ?? 0.55),
    imageBackfillMinResultCount: Number(
      process.env.SEARCH_IMAGE_BACKFILL_MIN_RESULT_COUNT ?? 20,
    ),
    imageBackfillMinScore: Number(
      process.env.SEARCH_IMAGE_BACKFILL_MIN_SCORE ?? 0.38,
    ),
    imageBackfillMinAnnScore: Number(
      process.env.SEARCH_IMAGE_BACKFILL_MIN_ANN_SCORE ?? 0.48,
    ),
    imageBackfillMinTagScore: Number(
      process.env.SEARCH_IMAGE_BACKFILL_MIN_TAG_SCORE ?? 0.24,
    ),
    imageBackfillCandidateMultiplier: Number(
      process.env.SEARCH_IMAGE_BACKFILL_CANDIDATE_MULTIPLIER ?? 3,
    ),
    timeoutMs: Number(process.env.SEARCH_TIMEOUT_MS ?? 12000),
    earlyResultMinCount: Number(process.env.SEARCH_EARLY_RESULT_MIN_COUNT ?? 3),
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER ?? "volcengine_doubao_vision",
    imagePreprocessor: process.env.IMAGE_EMBEDDING_PREPROCESSOR ?? "none",
    localWorkerEnabled: parseBoolean(
      process.env.ENABLE_LOCAL_IMAGE_WORKER,
      false,
    ),
    productEmbeddingKinds: parseCsv(
      process.env.PRODUCT_EMBEDDING_KINDS ?? "visual,multimodal",
    ),
    annEmbeddingKind: process.env.ANN_EMBEDDING_KIND ?? "visual",
    queryEmbeddingKind: process.env.QUERY_EMBEDDING_KIND ?? "visual",
    searchQueryEmbeddingKind:
      process.env.SEARCH_QUERY_EMBEDDING_KIND ?? "multimodal",
    modelName: optionalString(process.env.EMBEDDING_MODEL_NAME),
    baseUrl: optionalString(process.env.EMBEDDING_API_BASE_URL),
    apiKey: optionalString(process.env.EMBEDDING_API_KEY),
    dimension: parseOptionalPositiveInteger(process.env.EMBEDDING_DIMENSION),
    localWorkerBaseUrl: optionalString(process.env.LOCAL_IMAGE_WORKER_BASE_URL),
    localWorkerTimeoutMs: Number(
      process.env.LOCAL_IMAGE_WORKER_TIMEOUT_MS ?? 60000,
    ),
  },
  queryImagePreprocess: {
    paddingRatio: Number(process.env.QUERY_IMAGE_BBOX_PADDING_RATIO ?? 0.12),
    minConfidence: Number(process.env.QUERY_IMAGE_BBOX_MIN_CONFIDENCE ?? 0.2),
    targetSize: Number(
      process.env.QUERY_IMAGE_EMBEDDING_TARGET_SIZE ??
        process.env.PRODUCT_IMPORT_IMAGE_TARGET_SIZE ??
        320,
    ),
    jpegQuality: Number(process.env.QUERY_IMAGE_CROP_JPEG_QUALITY ?? 82),
    storeCropInObjectStorage: parseBoolean(
      process.env.QUERY_IMAGE_STORE_CROP_IN_COS,
      true,
    ),
    localCategoryMinConfidence: Number(
      process.env.QUERY_LOCAL_CATEGORY_MIN_CONFIDENCE ?? 0.04,
    ),
  },
  contentSearch: {
    provider: process.env.CONTENT_SEARCH_PROVIDER ?? "noop",
    providerChain:
      process.env.CONTENT_SEARCH_PROVIDER_CHAIN ?? "serper,serpapi",
    timeoutMs: Number(process.env.CONTENT_SEARCH_TIMEOUT_MS ?? 5000),
    maxResultsPerQuery: Number(
      process.env.CONTENT_SEARCH_MAX_RESULTS_PER_QUERY ?? 8,
    ),
    totalResultLimit: Number(
      process.env.CONTENT_SEARCH_TOTAL_RESULT_LIMIT ?? 12,
    ),
    earlyResultMinCount: Number(
      process.env.CONTENT_SEARCH_EARLY_RESULT_MIN_COUNT ?? 3,
    ),
    serper: {
      apiKey: process.env.SERPER_API_KEY,
      baseUrl: process.env.SERPER_API_BASE_URL ?? "https://google.serper.dev",
    },
    serpapi: {
      apiKey: process.env.SERPAPI_API_KEY,
      baseUrl: process.env.SERPAPI_API_BASE_URL ?? "https://serpapi.com/search",
      engine: process.env.SERPAPI_ENGINE ?? "google",
    },
  },
  trendOutfit: {
    contentSearch: {
      baseUrl: process.env.CONTENT_SEARCH_API_BASE_URL,
      apiKey: process.env.CONTENT_SEARCH_API_KEY,
      timeoutMs: Number(process.env.CONTENT_SEARCH_TIMEOUT_MS ?? 8000),
    },
  },
  modelProviders: {
    vision: {
      provider:
        process.env.VISION_PROVIDER ??
        (process.env.MODEL_3 ? "volcengine_ark" : process.env.MODEL_PROVIDER),
      baseUrl:
        optionalString(process.env.VISION_MODEL_BASE_URL) ??
        optionalString(process.env.BASE_URL_3),
      modelName:
        optionalString(process.env.VISION_MODEL_NAME) ??
        optionalString(process.env.MODEL_3),
      apiKey:
        optionalString(process.env.VISION_MODEL_API_KEY) ??
        optionalString(process.env.OPENAI_API_KEY_3),
    },
    chat: {
      provider:
        process.env.CHAT_PROVIDER ??
        (process.env.MODEL_2 ? "deepseek" : process.env.MODEL_PROVIDER),
      baseUrl:
        optionalString(process.env.CHAT_MODEL_BASE_URL) ??
        optionalString(process.env.BASE_URL_2),
      modelName:
        optionalString(process.env.CHAT_MODEL_NAME) ??
        optionalString(process.env.MODEL_2),
      apiKey:
        optionalString(process.env.CHAT_MODEL_API_KEY) ??
        optionalString(process.env.OPENAI_API_KEY_2),
    },
  },
  objectStorage: {
    provider: process.env.OBJECT_STORAGE_PROVIDER ?? "tencent_cos",
    region: process.env.OBJECT_STORAGE_REGION,
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    secretId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretKey: process.env.OBJECT_STORAGE_ACCESS_KEY_SECRET,
    buckets: {
      compressedRecognition:
        process.env.OBJECT_STORAGE_BUCKET_COMPRESSED_RECOGNITION,
      originalSource: process.env.OBJECT_STORAGE_BUCKET_ORIGINAL_SOURCE,
      demoAssets: process.env.OBJECT_STORAGE_BUCKET_DEMO_ASSETS,
    },
  },
});

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function optionalString(value: string | undefined) {
  const normalized = stripWrappingQuotes(value?.trim() ?? "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  return normalized ? normalized : undefined;
}

function stripWrappingQuotes(value: string) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function parseOptionalPositiveInteger(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function parseSearchPipelineMode(value: string | undefined) {
  return value === "light_tag_ann_fusion" || value === "current_ann_then_refine"
    ? value
    : "current_ann_then_refine";
}
