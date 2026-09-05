import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../persistence/prisma/prisma.service";
import { StorageAdapter } from "../storage/storage-adapter.interface";
import { OBJECT_STORAGE_ADAPTER } from "../storage/storage.constants";
import {
  CandidateVisualVerificationInput,
  CandidateVisualVerificationResult,
  ConversationIntent,
  ConversationTurnParseInput,
  ConversationTurnParseResult,
  IdentifyShoeInput,
  ModelAdapter,
  ProductCategoryResult,
  ProductProfileResult,
  ProductTagInput,
  ProductTagResult,
} from "./model-adapter.interface";
import type {
  TrendEvidenceSource,
  TrendOutfitCandidate,
  TrendOutfitExtractionInput,
  TrendOutfitExtractionResult,
} from "../../modules/trend-outfit/application/trend-outfit.types";
import { ProfileSchemaRegistryService } from "../../modules/prompt-assets/application/profile-schema-registry.service";
import { PromptRegistryService } from "../../modules/prompt-assets/application/prompt-registry.service";
import {
  getProductCategoryDefinition,
  normalizeProductCategory,
  productCategoryClassifierCatalog,
  productCategoryKeywords,
} from "../../common/catalog/product-categories";

type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | {
      role: "user";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
    };

interface ChatCompletionOptions {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

@Injectable()
export class OpenAiCompatibleModelAdapterService implements ModelAdapter {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
    private readonly promptRegistry: PromptRegistryService,
    private readonly profileSchemaRegistry: ProfileSchemaRegistryService,
  ) {}

  async identifyShoe(input: IdentifyShoeInput): Promise<ProductProfileResult> {
    const vision = this.resolveVisionConfig();
    if (!vision) {
      throw new InternalServerErrorException(
        "VISION_MODEL_PROVIDER_NOT_CONFIGURED",
      );
    }

    const imageUrl = await this.resolveInputImageUrl(input);
    if (!imageUrl || imageUrl.startsWith("mock://")) {
      throw new InternalServerErrorException(
        "IMAGE_ASSET_SIGNED_URL_UNAVAILABLE",
      );
    }
    const categoryHint = normalizeProductCategory(input.categoryHint ?? "shoe");
    const categoryDefinition = getProductCategoryDefinition(categoryHint);
    const allowedCategories = productCategoryClassifierCatalog().map(
      (category) => category.key,
    );

    const result = await this.callJsonCompletion({
      ...vision,
      maxTokens: 180,
      messages: [
        {
          role: "system",
          content: [
            "Identify the main shopping product in the image for product search.",
            "Return strict compact JSON only. Do not include explanations, boxes, OCR dumps, or extra keys.",
            "Allowed keys: category, brand, modelLine, colorFamily, colorway, shoeType, color, keywords, confidence.",
            "Use null for unknown scalar fields and [] for unknown keywords.",
            "Keep keywords short and stable, max 3 items.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "identify_lightweight_search_profile",
                categoryHint,
                categoryLabel: categoryDefinition.labelEn,
                allowedCategories,
                colorFamilyEnum: [
                  "black",
                  "white",
                  "black_white",
                  "gray",
                  "blue",
                  "red",
                  "green",
                  "yellow",
                  "brown",
                  "multi",
                ],
                shoeTypeEnum: [
                  "running",
                  "basketball",
                  "lifestyle",
                  "training",
                  "skate",
                  "football",
                  "boot",
                  "sandal",
                ],
                output:
                  "category, brand, modelLine, colorFamily, colorway, shoeType, color, keywords, confidence",
                rules: [
                  "Return category as one canonical key from allowedCategories.",
                  "For shoes, infer brand, colorFamily, shoeType, and visible color only when visually clear.",
                  "Set shoeType only for shoe products; otherwise null.",
                  "Do not infer modelLine unless a stable line or exact printed model is visible.",
                  "Do not output styleTags, sceneTags, size, or subjectDetection.",
                ],
              }),
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });

    return this.normalizeProfileResult(
      result,
      input.imageUrl ? "vision_query_crop" : "vision_user_image",
      "lightweight-product-profile-v1",
      categoryHint,
    );
  }

  async classifyProductCategory(input: {
    imageUrl: string;
    categoryHint?: string | null;
  }): Promise<ProductCategoryResult> {
    const vision = this.resolveVisionConfig();
    if (!vision) {
      throw new InternalServerErrorException(
        "VISION_MODEL_PROVIDER_NOT_CONFIGURED",
      );
    }
    if (!input.imageUrl || input.imageUrl.startsWith("mock://")) {
      throw new InternalServerErrorException("CATEGORY_IMAGE_URL_UNAVAILABLE");
    }

    const result = await this.callJsonCompletion({
      ...vision,
      maxTokens: 160,
      messages: [
        {
          role: "system",
          content: [
            "Classify the main shopping product category from one cropped product image.",
            "Return strict JSON only with category and confidence.",
            "category must be one canonical key from the allowedCategories list.",
            JSON.stringify(productCategoryClassifierCatalog()),
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "classify_product_category",
                categoryHint: input.categoryHint ?? null,
              }),
            },
            { type: "image_url", image_url: { url: input.imageUrl } },
          ],
        },
      ],
    });

    return {
      category: normalizeProductCategory(
        result.category,
        input.categoryHint ?? "shoe",
      ),
      confidence: this.clamp01(this.toNumber(result.confidence, 0.5)),
      raw: {
        provider: "openai_compatible_vision",
        source: "lightweight_category_classifier",
        raw: result,
      },
    };
  }

  async parseRefineMessage(input: { message: string }) {
    const parsed = await this.parseConversationTurn({
      sessionId: "single_turn",
      turnIndex: 0,
      latestUserMessage: input.message,
      productProfile: null,
      effectiveFilter: {},
      userMemoryContext: null,
      conversationSummary: null,
      recentMessages: [],
      candidateSummary: [],
      prompt: this.promptRegistry.getConversationPrompt("digital_other"),
      outputSchema: this.promptRegistry.getFilterOutputSchema(),
      profileSchema:
        this.profileSchemaRegistry.getProfileSchema("digital_other"),
    });

    return parsed.filterPatch;
  }

  async parseConversationTurn(
    input: ConversationTurnParseInput,
  ): Promise<ConversationTurnParseResult> {
    const chat = this.resolveChatConfig();
    if (!chat) {
      throw new InternalServerErrorException(
        "CHAT_MODEL_PROVIDER_NOT_CONFIGURED",
      );
    }

    const result = await this.callJsonCompletion({
      ...chat,
      maxTokens: 900,
      messages: [
        {
          role: "system",
          content: [
            input.prompt.systemPrompt,
            `Output schema version: ${input.outputSchema.version}`,
            JSON.stringify(input.outputSchema.schema),
          ].join("\n\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "parse_conversation_turn",
            sessionId: input.sessionId,
            turnIndex: input.turnIndex,
            profileSchemaVersion: input.profileSchema.version,
            profileSchema: input.profileSchema.schema,
            productProfile: input.productProfile,
            currentEffectiveFilter: input.effectiveFilter,
            userMemoryContext: input.userMemoryContext ?? null,
            conversationSummary: input.conversationSummary,
            recentMessages: input.recentMessages,
            candidateSummary: input.candidateSummary,
            latestUserMessage: input.latestUserMessage,
          }),
        },
      ],
    });

    return this.normalizeConversationParseResult(result, input);
  }

  async extractTrendOutfit(
    input: TrendOutfitExtractionInput,
  ): Promise<TrendOutfitExtractionResult> {
    const chat = this.resolveChatConfig();
    if (!chat) {
      throw new InternalServerErrorException(
        "CHAT_MODEL_PROVIDER_NOT_CONFIGURED",
      );
    }

    const result = await this.callJsonCompletion({
      ...chat,
      maxTokens: 1200,
      messages: [
        {
          role: "system",
          content: [
            "You extract fashion outfit pairing relationships from public content search snippets.",
            "Return strict JSON only. Do not choose local products.",
            "Only infer target product categories, keywords, style tags, scene tags, confidence, and short reasons.",
            "Ignore appraisal, unboxing, review, proxy shopping, and price-only content.",
            "Output schema: { trendSummary: string, outfitCandidates: [{ targetCategory, displayCategory, keywords, styleTags, sceneTags, confidence, reason }], evidenceSources: [{ title, snippet, url, source }] }.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "extract_trend_outfit_pairs",
            baseProduct: input.baseProduct,
            searchResults: input.searchResults.map((result) => ({
              title: result.title,
              snippet: result.snippet,
              url: result.url,
              source: result.source,
            })),
            rules: [
              "Prefer high-frequency complementary items mentioned across multiple snippets.",
              "targetCategory should be a concise machine-readable category such as bottom, top, socks, bag, outerwear, accessory.",
              "displayCategory should be user-facing Chinese when possible.",
              "keywords should describe product terms that can be matched against a local product title or tags.",
              "Do not recommend products similar to the base product unless the content clearly describes them as a styling companion.",
              "confidence must be between 0 and 1.",
            ],
          }),
        },
      ],
    });

    return this.normalizeTrendOutfitExtraction(result, input);
  }

  async tagProduct(input: ProductTagInput): Promise<ProductTagResult> {
    const vision = this.resolveVisionConfig();
    if (!vision) {
      throw new InternalServerErrorException(
        "VISION_MODEL_PROVIDER_NOT_CONFIGURED",
      );
    }

    const categoryHint = normalizeProductCategory(input.categoryHint ?? "shoe");
    const categoryDefinition = getProductCategoryDefinition(categoryHint);
    const prompt = [
      `Title: ${input.title}`,
      `Platform: ${input.platform ?? "unknown"}`,
      `Brand hint: ${input.brandHint ?? "unknown"}`,
      `Category hint: ${categoryHint} (${categoryDefinition.labelEn})`,
      "Return JSON with fields defined by the product profile schema.",
      "category must be one canonical key from allowedCategories.",
      `allowedCategories: ${JSON.stringify(productCategoryClassifierCatalog())}`,
    ].join("\n");
    const profileSchema =
      this.profileSchemaRegistry.getProfileSchema(categoryHint);

    const usableImageUrl =
      input.imageUrl && !input.imageUrl.startsWith("mock://")
        ? input.imageUrl
        : null;
    const content: ChatMessage["content"] = usableImageUrl
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: usableImageUrl } },
        ]
      : prompt;

    const result = await this.callJsonCompletion({
      ...vision,
      maxTokens: 800,
      messages: [
        {
          role: "system",
          content: [
            "You tag product catalog entries. Return strict JSON only. Keep modelLine stable and concise.",
            `Use product profile schema version ${profileSchema.version}.`,
            JSON.stringify(profileSchema.schema),
          ].join("\n"),
        },
        { role: "user", content },
      ],
    });

    return this.normalizeTagResult(
      result,
      input,
      profileSchema.version,
      categoryHint,
    );
  }

  async verifyCandidateVisualMatch(
    input: CandidateVisualVerificationInput,
  ): Promise<CandidateVisualVerificationResult> {
    const vision = this.resolveVisionConfig();
    if (
      !vision ||
      !input.candidate.imageUrl ||
      input.candidate.imageUrl.startsWith("mock://")
    ) {
      throw new InternalServerErrorException("VISION_VERIFY_INPUT_NOT_READY");
    }

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: JSON.stringify({
          task: "same_product_verification",
          category: normalizeProductCategory(
            input.queryProfile.category,
            "shoe",
          ),
          queryProfile: input.queryProfile,
          candidate: input.candidate,
          instruction:
            "If a query image is provided, compare the candidate image against it. Otherwise compare against the structured query profile.",
          output: {
            sameProduct: "boolean",
            sameColorway: "boolean",
            confidence: "number 0-1",
          },
        }),
      },
    ];
    if (input.queryImageUrl && !input.queryImageUrl.startsWith("mock://")) {
      content.push({
        type: "image_url",
        image_url: { url: input.queryImageUrl },
      });
    }
    content.push({
      type: "image_url",
      image_url: { url: input.candidate.imageUrl },
    });

    const result = await this.callJsonCompletion({
      ...vision,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content: [
            "Decide whether a candidate shopping product is the same product as the query profile. Return JSON only.",
            "Use images as primary evidence when images are provided. Text fields may be incomplete or inconsistent.",
            `Use product profile schema version ${this.profileSchemaRegistry.getProfileSchema(input.queryProfile.category).version}.`,
          ].join("\n"),
        },
        {
          role: "user",
          content,
        },
      ],
    });

    return {
      sameProduct: result.sameProduct === true,
      sameColorway: result.sameColorway === true,
      confidence: this.toNumber(result.confidence, 0),
      verificationStatus: 'verified',
      verificationSource: 'model',
      raw: { provider: "openai_compatible_vision", result },
    };
  }

  private resolveVisionConfig() {
    const provider = this.config.get<string>("modelProviders.vision.provider");
    const baseUrl = this.config.get<string>("modelProviders.vision.baseUrl");
    const modelName = this.config.get<string>(
      "modelProviders.vision.modelName",
    );
    const apiKey = this.config.get<string>("modelProviders.vision.apiKey");
    if (!provider || provider === "mock" || !baseUrl || !modelName || !apiKey)
      return null;
    return { baseUrl, modelName, apiKey };
  }

  private resolveChatConfig() {
    const provider = this.config.get<string>("modelProviders.chat.provider");
    const baseUrl = this.config.get<string>("modelProviders.chat.baseUrl");
    const modelName = this.config.get<string>("modelProviders.chat.modelName");
    const apiKey = this.config.get<string>("modelProviders.chat.apiKey");
    if (!provider || provider === "mock" || !baseUrl || !modelName || !apiKey)
      return null;
    return { baseUrl, modelName, apiKey };
  }

  private async getImageUrlForAsset(assetId: string) {
    const asset = await this.prisma.imageAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) return null;
    if (asset.uploadStatus !== "uploaded") return null;
    return this.storage.getSignedReadUrl?.({
      bucketGroup: asset.bucketGroup,
      objectKey: asset.objectKey,
      expiresSeconds: 900,
    });
  }

  private async resolveInputImageUrl(input: IdentifyShoeInput) {
    if (input.imageUrl && !input.imageUrl.startsWith("mock://")) {
      return input.imageUrl;
    }
    if (!input.assetId) return null;
    return this.getImageUrlForAsset(input.assetId);
  }

  private async callJsonCompletion(options: ChatCompletionOptions) {
    const endpoint = `${options.baseUrl.replace(/\/+$/g, "")}/chat/completions`;
    const requestBody = {
      model: options.modelName,
      messages: options.messages,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: options.maxTokens ?? 800,
    };
    let response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok && response.status >= 400 && response.status < 500) {
      const { response_format: _responseFormat, ...bodyWithoutResponseFormat } =
        requestBody;
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyWithoutResponseFormat),
      });
    }

    if (!response.ok) {
      throw new InternalServerErrorException("MODEL_PROVIDER_REQUEST_FAILED");
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const content = this.extractAssistantContent(payload);
    return this.parseJsonObject(content);
  }

  private extractAssistantContent(payload: Record<string, unknown>) {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new InternalServerErrorException("MODEL_PROVIDER_EMPTY_RESPONSE");
    }
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content !== "string") {
      throw new InternalServerErrorException("MODEL_PROVIDER_INVALID_RESPONSE");
    }
    return content;
  }

  private parseJsonObject(content: string) {
    const trimmed = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "");
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InternalServerErrorException(
        "MODEL_PROVIDER_JSON_OBJECT_REQUIRED",
      );
    }
    return parsed as Record<string, unknown>;
  }

  private normalizeConversationParseResult(
    raw: Record<string, unknown>,
    input: ConversationTurnParseInput,
  ): ConversationTurnParseResult {
    const intent = this.toIntent(raw.intent);
    const assistantMessage =
      this.toStringOrNull(raw.assistantMessage) ??
      (intent === "ask_clarification"
        ? "我需要更多信息才能继续筛选。"
        : "已更新筛选条件。");

    return {
      intent,
      filterPatch: this.toObject(raw.filterPatch),
      filterRemove: this.toStringArray(raw.filterRemove),
      shouldResetPreviousFilters: raw.shouldResetPreviousFilters === true,
      assistantMessage,
      confidence: this.clamp01(this.toNumber(raw.confidence, 0.5)),
      raw: {
        provider: "openai_compatible_chat",
        promptVersion: input.prompt.version,
        schemaVersion: input.profileSchema.version,
        outputSchemaVersion: input.outputSchema.version,
        modelResult: raw,
      },
    };
  }

  private normalizeTrendOutfitExtraction(
    raw: Record<string, unknown>,
    input: TrendOutfitExtractionInput,
  ): TrendOutfitExtractionResult {
    const rawCandidates = Array.isArray(raw.outfitCandidates)
      ? raw.outfitCandidates
      : [];
    const outfitCandidates = rawCandidates
      .map((item) => this.normalizeTrendOutfitCandidate(item))
      .filter((item): item is TrendOutfitCandidate => Boolean(item))
      .slice(0, 8);

    return {
      trendSummary:
        this.toStringOrNull(raw.trendSummary) ??
        "已根据公开穿搭内容抽取搭配方向。",
      outfitCandidates,
      evidenceSources: this.normalizeTrendEvidenceSources(
        raw.evidenceSources,
        input,
      ),
    };
  }

  private normalizeTrendOutfitCandidate(
    value: unknown,
  ): TrendOutfitCandidate | null {
    const raw = this.toObject(value);
    const keywords = this.toStringArray(raw.keywords).slice(0, 8);
    const targetCategory = this.toStringOrNull(raw.targetCategory);
    const displayCategory = this.toStringOrNull(raw.displayCategory);
    if (!targetCategory && !displayCategory && keywords.length === 0)
      return null;

    return {
      targetCategory:
        targetCategory ?? displayCategory ?? keywords[0] ?? "accessory",
      displayCategory:
        displayCategory ?? targetCategory ?? keywords[0] ?? "搭配单品",
      keywords,
      styleTags: this.toStringArray(raw.styleTags).slice(0, 8),
      sceneTags: this.toStringArray(raw.sceneTags).slice(0, 8),
      confidence: this.clamp01(this.toNumber(raw.confidence, 0.5)),
      reason: this.toStringOrNull(raw.reason) ?? "公开内容中出现的搭配关系。",
    };
  }

  private normalizeTrendEvidenceSources(
    value: unknown,
    input: TrendOutfitExtractionInput,
  ): TrendEvidenceSource[] {
    const rawSources = Array.isArray(value) ? value : [];
    const normalized = rawSources
      .map((item) => this.normalizeTrendEvidenceSource(item))
      .filter((item): item is TrendEvidenceSource => Boolean(item))
      .slice(0, 12);
    if (normalized.length > 0) return normalized;

    return input.searchResults.slice(0, 12).map((result) => ({
      title: result.title,
      snippet: result.snippet,
      url: result.url,
      source: result.source,
    }));
  }

  private normalizeTrendEvidenceSource(
    value: unknown,
  ): TrendEvidenceSource | null {
    const raw = this.toObject(value);
    const title = this.toStringOrNull(raw.title);
    const url = this.toStringOrNull(raw.url);
    if (!title || !url) return null;
    return {
      title,
      snippet: this.toStringOrNull(raw.snippet) ?? "",
      url,
      source: this.toStringOrNull(raw.source) ?? "public_search",
    };
  }

  private normalizeProfileResult(
    raw: Record<string, unknown>,
    source: string,
    schemaVersion?: string,
    categoryFallback = "shoe",
  ): ProductProfileResult {
    const tag = this.normalizeTagLike(raw);
    const subjectDetection = this.toObject(raw.subjectDetection);
    const category = normalizeProductCategory(tag.category, categoryFallback);
    return {
      category,
      brand: tag.brand,
      modelLine: tag.modelLine,
      colorFamily: tag.colorFamily,
      colorway: tag.colorway,
      shoeType: tag.shoeType,
      size: this.toStringOrNull(raw.size),
      color: this.toStringOrNull(raw.color) ?? tag.colorFamily,
      styleTags: this.toStringArray(raw.styleTags),
      sceneTags: this.toStringArray(raw.sceneTags),
      keywords:
        tag.keywords.length > 0
          ? tag.keywords
          : productCategoryKeywords(category),
      confidence: tag.confidence,
      raw: {
        provider: "openai_compatible_vision",
        source,
        schemaVersion,
        subjectDetection,
        raw,
      },
    };
  }

  private normalizeTagResult(
    raw: Record<string, unknown>,
    input: ProductTagInput,
    schemaVersion?: string,
    categoryFallback = "shoe",
  ): ProductTagResult {
    const tag = this.normalizeTagLike(raw);
    const category = normalizeProductCategory(tag.category, categoryFallback);
    return {
      category,
      brand: tag.brand ?? input.brandHint ?? null,
      modelLine: tag.modelLine,
      colorFamily: tag.colorFamily,
      colorway: tag.colorway,
      shoeType: tag.shoeType,
      keywords:
        tag.keywords.length > 0
          ? tag.keywords
          : [input.title, ...productCategoryKeywords(category)],
      confidence: tag.confidence,
      raw: { provider: "openai_compatible_vision", schemaVersion, raw },
    };
  }

  private normalizeTagLike(raw: Record<string, unknown>) {
    return {
      category: this.toStringOrNull(raw.category),
      brand: this.toStringOrNull(raw.brand),
      modelLine: this.toStringOrNull(raw.modelLine),
      colorFamily: this.toStringOrNull(raw.colorFamily),
      colorway: this.toStringOrNull(raw.colorway),
      shoeType: this.toStringOrNull(raw.shoeType),
      keywords: this.toStringArray(raw.keywords),
      confidence: this.toNumber(raw.confidence, 0.5),
    };
  }

  private sanitizeFilter(raw: Record<string, unknown>) {
    return {
      priceMin: this.toStringOrNull(raw.priceMin),
      priceMax: this.toStringOrNull(raw.priceMax),
      platformsInclude: this.toStringArray(raw.platformsInclude),
      platformsExclude: this.toStringArray(raw.platformsExclude),
      stockOnly: raw.stockOnly === true,
      urgentDeliveryPreferred: raw.urgentDeliveryPreferred === true,
      timeConstraintDays: this.toOptionalNumber(raw.timeConstraintDays),
      color: this.toStringOrNull(raw.color),
      brand: this.toStringOrNull(raw.brand),
      sortRule: this.toStringOrNull(raw.sortRule) ?? "relevance_desc",
    };
  }

  private toStringOrNull(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }

  private toObject(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private toIntent(value: unknown): ConversationIntent {
    const allowed: ConversationIntent[] = [
      "refine_filter",
      "reset_filter",
      "ask_clarification",
      "compare_candidates",
      "explain_result",
      "shopping_advice",
      "general_chat",
    ];
    return typeof value === "string" &&
      allowed.includes(value as ConversationIntent)
      ? (value as ConversationIntent)
      : "ask_clarification";
  }

  private toNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  private clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private toOptionalNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
