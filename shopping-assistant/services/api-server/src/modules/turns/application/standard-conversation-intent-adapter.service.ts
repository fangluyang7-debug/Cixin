import { Inject, Injectable } from "@nestjs/common";
import {
  ConversationIntent,
  ConversationTurnParseInput,
  ConversationTurnParseResult,
  MODEL_ADAPTER,
  ModelAdapter,
} from "../../../adapters/model/model-adapter.interface";
import {
  displayPlatformLabel,
} from "../../../common/platforms/platform-normalization";
import {
  getProductCategoryDefinition,
  normalizeProductCategory,
  normalizeProductCategoryOrNull,
} from "../../../common/catalog/product-categories";
import { extractShoppingFilterPatch } from "../../../common/shopping/shopping-filter-heuristics";
import { analyzeShoppingLanguage } from "../../../common/shopping/shopping-language-analyzer";
import { ConversationIntentAdapter } from "./conversation-intent-adapter.interface";

const INTENTS: ConversationIntent[] = [
  "refine_filter",
  "reset_filter",
  "ask_clarification",
  "compare_candidates",
  "explain_result",
  "shopping_advice",
  "general_chat",
];

const FILTER_INTENTS = new Set<ConversationIntent>([
  "refine_filter",
  "reset_filter",
]);

@Injectable()
export class StandardConversationIntentAdapterService implements ConversationIntentAdapter {
  constructor(
    @Inject(MODEL_ADAPTER)
    private readonly model: ModelAdapter,
  ) {}

  async parseTurn(
    input: ConversationTurnParseInput,
  ): Promise<ConversationTurnParseResult> {
    const deterministicTurn = this.parseDeterministicTurn(input);
    if (deterministicTurn) return deterministicTurn;

    const parsed = this.guardParsedTurn(
      input,
      await this.parseWithFallback(input),
    );
    return {
      intent: this.toIntent(parsed.intent),
      filterPatch: this.toRecord(parsed.filterPatch),
      filterRemove: this.toStringArray(parsed.filterRemove),
      shouldResetPreviousFilters: parsed.shouldResetPreviousFilters === true,
      assistantMessage: this.toAssistantMessage(
        parsed.assistantMessage,
        parsed.intent,
      ),
      confidence: this.toConfidence(parsed.confidence),
      raw: this.toRecord(parsed.raw),
      semanticOperations: parsed.semanticOperations ?? [],
      candidateRefs: parsed.candidateRefs ?? [],
      profilePatch: this.toRecord(parsed.profilePatch),
      profileRemove: this.toStringArray(parsed.profileRemove),
      rejectedOperations: parsed.rejectedOperations ?? [],
    };
  }

  private parseDeterministicTurn(
    input: ConversationTurnParseInput,
  ): ConversationTurnParseResult | null {
    const message = input.latestUserMessage;
    if (this.isAdviceFirstQuestion(message)) return null;
    const analysis = analyzeShoppingLanguage(message, input);
    const filterPatch = analysis.filterPatch;
    const filterRemove = analysis.filterRemove;
    const hasPatch = Object.keys(filterPatch).length > 0;
    const hasRemove = filterRemove.length > 0;

    if (/刚才说错了|我说错了|前面说错了|不对但没说|correction$/iu.test(analysis.correctedText)) {
      return {
        intent: "ask_clarification",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: "没关系，请告诉我需要改成什么条件。",
        confidence: 0.99,
        raw: { provider: "local_semantic_v2", localClassifier: "incomplete_correction" },
        rejectedOperations: [{ field: "filterState", code: "CORRECTION_VALUE_REQUIRED", message: "请告诉我需要改成什么条件。" }],
      };
    }

    if (/算了[，,。\s]*不买了|不买了|不想买了|停止推荐/iu.test(analysis.correctedText)) {
      return {
        intent: "general_chat",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: "好的，本次商品搜索已停止。",
        confidence: 0.99,
        raw: { provider: "local_semantic_v2", localClassifier: "stop_shopping" },
      };
    }

    if (/销量|新品|最新/iu.test(analysis.correctedText) && /排序|优先|先看|按/iu.test(analysis.correctedText)) {
      return {
        intent: "ask_clarification",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: "当前商品数据没有可靠的销量或上新时间，暂时不能按该条件排序。你可以改用价格、评分、送达速度或匹配度排序。",
        confidence: 0.99,
        raw: {
          provider: "local_semantic_v2",
          normalizedText: analysis.normalizedText,
          correctedText: analysis.correctedText,
        },
        semanticOperations: analysis.semanticOperations,
        candidateRefs: analysis.candidateRefs,
        rejectedOperations: [{ field: "sortRule", code: "SORT_SIGNAL_UNAVAILABLE", message: "当前没有可靠的销量或上新时间。" }],
      };
    }

    if (analysis.rejectedOperations.length > 0) {
      return {
        intent: "ask_clarification",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: analysis.clarificationMessage ?? "这条要求存在冲突，请确认后再试。",
        confidence: 0.98,
        raw: {
          provider: "local_semantic_v2",
          normalizedText: analysis.normalizedText,
          correctedText: analysis.correctedText,
        },
        semanticOperations: analysis.semanticOperations,
        candidateRefs: analysis.candidateRefs,
        rejectedOperations: analysis.rejectedOperations,
      };
    }

    if (analysis.shouldResetPreviousFilters) {
      return {
        intent: "reset_filter",
        filterPatch,
        filterRemove,
        shouldResetPreviousFilters: true,
        assistantMessage: this.buildFallbackAssistantMessage(filterPatch),
        confidence: 0.98,
        raw: {
          provider: "local_semantic_v2",
          localClassifier: "reset_filter",
          normalizedText: analysis.normalizedText,
          correctedText: analysis.correctedText,
        },
        semanticOperations: analysis.semanticOperations,
        candidateRefs: analysis.candidateRefs,
        profilePatch: analysis.profilePatch,
        profileRemove: analysis.profileRemove,
      };
    }

    if (analysis.shouldRestorePreviousFilter) {
      return {
        intent: "reset_filter",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: "正在恢复上一轮筛选条件。",
        confidence: 0.98,
        raw: {
          provider: "local_semantic_v2",
          localClassifier: "restore_previous_filter",
          restorePreviousFilter: true,
          normalizedText: analysis.normalizedText,
          correctedText: analysis.correctedText,
        },
        semanticOperations: analysis.semanticOperations,
        candidateRefs: analysis.candidateRefs,
      };
    }

    if (
      (hasPatch || hasRemove || analysis.candidateRefs.length > 0) &&
      (this.isExplicitFilterRequest(message) ||
        this.isProductSearchRequest(message) ||
        analysis.semanticOperations.length > 0)
    ) {
      const removingCandidate = /去掉|排除|不要这个|这个不要|删除|换一批|这批都不喜欢|这批都不要/iu.test(message) && analysis.candidateRefs.length > 0;
      if (removingCandidate) {
        filterPatch.excludedCandidateItemIds = analysis.candidateRefs.map((item) => item.candidateItemId);
        const productIds = analysis.candidateRefs.map((item) => item.productId).filter((item): item is string => Boolean(item));
        if (productIds.length > 0) filterPatch.excludedProductIds = productIds;
      }
      const candidateIntent = analysis.candidateRefs.length > 0 && !removingCandidate
        ? /对比|比较|比一下|比一比/iu.test(message)
          ? "compare_candidates"
          : /为什么|原因|推荐依据|怎么样|如何/iu.test(message)
            ? "explain_result"
            : "shopping_advice"
        : "refine_filter";
      return {
        intent: candidateIntent,
        filterPatch,
        filterRemove,
        shouldResetPreviousFilters: false,
        assistantMessage:
          analysis.candidateRefs.length > 0 && !removingCandidate
            ? this.buildReferencedCandidateMessage(candidateIntent, analysis.candidateRefs)
            : this.buildFallbackAssistantMessage(filterPatch),
        confidence: 0.96,
        raw: {
          provider: "local_semantic_v2",
          localClassifier: "semantic_operation_v2",
          normalizedText: analysis.normalizedText,
          correctedText: analysis.correctedText,
        },
        semanticOperations: analysis.semanticOperations,
        candidateRefs: analysis.candidateRefs,
        profilePatch: analysis.profilePatch,
        profileRemove: analysis.profileRemove,
      };
    }

    return null;
  }

  private async parseWithFallback(
    input: ConversationTurnParseInput,
  ): Promise<ConversationTurnParseResult> {
    try {
      return await this.model.parseConversationTurn(input);
    } catch (error) {
      const filterPatch = this.extractFilterPatch(input.latestUserMessage);
      if (this.isProductSearchRequest(input.latestUserMessage)) {
        return {
          intent: "refine_filter",
          filterPatch,
          filterRemove: [],
          shouldResetPreviousFilters: false,
          assistantMessage: this.buildFallbackAssistantMessage(filterPatch),
          confidence: Object.keys(filterPatch).length > 0 ? 0.66 : 0.56,
          raw: {
            provider: "local_conversation_fallback",
            reason:
              error instanceof Error ? error.message : "MODEL_PARSE_FAILED",
            localClassifier: "product_search_request",
          },
        };
      }
      const localIntent = this.classifyLocalIntent(input.latestUserMessage);
      if (localIntent && Object.keys(filterPatch).length === 0) {
        return {
          intent: localIntent,
          filterPatch: {},
          filterRemove: [],
          shouldResetPreviousFilters: false,
          assistantMessage: this.buildNonFilterAssistantMessage(
            localIntent,
            input,
          ),
          confidence: 0.58,
          raw: {
            provider: "local_conversation_fallback",
            reason:
              error instanceof Error ? error.message : "MODEL_PARSE_FAILED",
            localClassifier: localIntent,
          },
        };
      }
      return {
        intent: "refine_filter",
        filterPatch,
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: this.buildFallbackAssistantMessage(filterPatch),
        confidence: Object.keys(filterPatch).length > 0 ? 0.62 : 0.38,
        raw: {
          provider: "local_conversation_fallback",
          reason: error instanceof Error ? error.message : "MODEL_PARSE_FAILED",
        },
      };
    }
  }

  private guardParsedTurn(
    input: ConversationTurnParseInput,
    parsed: ConversationTurnParseResult,
  ): ConversationTurnParseResult {
    const message = input.latestUserMessage;
    const intent = this.toIntent(parsed.intent);
    const filterPatch = this.toRecord(parsed.filterPatch);
    const localPatch = this.extractFilterPatch(message);
    const hasPatch = Object.keys(filterPatch).length > 0;
    const hasLocalPatch = Object.keys(localPatch).length > 0;
    const localIntent = this.classifyLocalIntent(message);
    const productSearchRequest = this.isProductSearchRequest(message);
    const explicitFilterRequest =
      this.isResetRequest(message) ||
      this.isExplicitFilterRequest(message) ||
      productSearchRequest ||
      (!this.isQuestionLike(message) && hasLocalPatch);

    if (this.isResetRequest(message)) {
      return {
        ...parsed,
        intent: "reset_filter",
        shouldResetPreviousFilters: true,
        filterPatch: hasPatch ? filterPatch : localPatch,
        assistantMessage:
          this.toOptionalAssistantMessage(parsed.assistantMessage) ??
          this.buildFallbackAssistantMessage(
            hasPatch ? filterPatch : localPatch,
          ),
      };
    }

    if (
      productSearchRequest &&
      (!this.isQuestionLike(message) ||
        hasLocalPatch ||
        input.candidateSummary.length === 0)
    ) {
      const patch = hasPatch ? filterPatch : localPatch;
      return {
        ...parsed,
        intent: "refine_filter",
        filterPatch: patch,
        assistantMessage:
          this.toOptionalAssistantMessage(parsed.assistantMessage) ??
          this.buildFallbackAssistantMessage(patch),
      };
    }

    if (FILTER_INTENTS.has(intent)) {
      if (explicitFilterRequest) {
        return {
          ...parsed,
          intent,
          filterPatch: hasPatch ? filterPatch : localPatch,
        };
      }

      const nonFilterIntent = localIntent ?? "shopping_advice";
      return this.toNonFilterTurn(parsed, nonFilterIntent, input);
    }

    if (!FILTER_INTENTS.has(intent) && explicitFilterRequest) {
      const patch = hasPatch ? filterPatch : localPatch;
      return {
        ...parsed,
        intent: "refine_filter",
        filterPatch: patch,
        assistantMessage:
          this.toOptionalAssistantMessage(parsed.assistantMessage) ??
          this.buildFallbackAssistantMessage(patch),
      };
    }

    if (!FILTER_INTENTS.has(intent)) {
      return this.toNonFilterTurn(parsed, intent, input);
    }

    if (!hasPatch && hasLocalPatch) {
      return {
        ...parsed,
        intent: "refine_filter",
        filterPatch: localPatch,
      };
    }

    return parsed;
  }

  private toNonFilterTurn(
    parsed: ConversationTurnParseResult,
    intent: ConversationIntent,
    input: ConversationTurnParseInput,
  ): ConversationTurnParseResult {
    const safeIntent = FILTER_INTENTS.has(intent) ? "shopping_advice" : intent;
    if (safeIntent === "shopping_advice") {
      return {
        ...parsed,
        intent: safeIntent,
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: this.buildNonFilterAssistantMessage(
          safeIntent,
          input,
        ),
      };
    }
    const parsedAssistantMessage = this.toOptionalAssistantMessage(
      parsed.assistantMessage,
    );
    const assistantMessage =
      parsedAssistantMessage &&
      !this.isCapabilityQuestion(input.latestUserMessage) &&
      this.isCapabilityIntroMessage(parsedAssistantMessage)
        ? this.buildNonFilterAssistantMessage(safeIntent, input)
        : (parsedAssistantMessage ??
          this.buildNonFilterAssistantMessage(safeIntent, input));
    return {
      ...parsed,
      intent: safeIntent,
      filterPatch: {},
      filterRemove: [],
      shouldResetPreviousFilters: false,
      assistantMessage,
    };
  }

  private classifyLocalIntent(message: string): ConversationIntent | null {
    if (this.isGeneralChat(message)) return "general_chat";
    if (
      /为什么|为何|原因|凭什么|怎么匹配|匹配依据|为什么推荐|why/i.test(message)
    ) {
      return "explain_result";
    }
    if (
      /对比|比较|区别|哪个|哪双|哪一个|更好|最好|compare|which/i.test(message)
    ) {
      return "compare_candidates";
    }
    if (
      /推荐|建议|怎么买|怎么选|值不值|值得|划算|性价比|适合|尺码|鞋码|偏大|偏小|脚宽|通勤|跑步|篮球|穿搭|避坑|靠谱吗|真伪|质量|recommend|advice|worth/i.test(
        message,
      )
    ) {
      return "shopping_advice";
    }
    if (
      !this.isExplicitFilterRequest(message) &&
      !this.isResetRequest(message)
    ) {
      return "general_chat";
    }
    return null;
  }

  private isGeneralChat(message: string) {
    return /^(你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|thanks|thank you|你是谁|你能做什么|在吗|辛苦了)[\s。！？!?]*$/i.test(
      message.trim(),
    );
  }

  private isQuestionLike(message: string) {
    return /[?？]|为什么|为何|怎么|如何|哪个|哪双|哪一个|推荐|建议|值不值|值得|适合|能不能|可不可以|好吗|行吗|靠谱吗/i.test(
      message,
    );
  }

  private isResetRequest(message: string) {
    if (
      /重新\s*排序|重排|按.*排序|匹配度|相似度|relevance|similarity/i.test(
        message,
      )
    ) {
      return false;
    }
    return /重新开始|重新来|重置|清空|从头|看所有平台|所有平台|start over|reset|clear/i.test(
      message,
    );
  }

  private isExplicitFilterRequest(message: string) {
    return /只看|仅看|筛选|过滤|限定|限制|控制在|预算|价位|不超过|低于|少于|最多|最高|以内|以下|以上|有货|现货|可拍|包邮|免邮|旗舰店|官方店|平台|淘宝|天猫|京东|得物|拼多多|抖音|闲鱼|咸鱼|排除|不要|不看|去掉|改成|换成|想看|看.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|找.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|搜索.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|搜.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|买.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|按.*排序|价格优先|低价优先|好评优先|评分优先|最快|送达|到货|从低到高|从高到低|cheapest|free shipping|filter|only|under|below|exclude|sort/i.test(
      message,
    );
  }

  private isProductSearchRequest(message: string) {
    if (this.isGeneralChat(message)) return false;
    if (this.isAdviceFirstQuestion(message)) return false;
    return (
      /(?:想买|要买|准备买|帮我找|找一下|搜索|搜一下|看看|看一下|换成|改成|改口|推荐|买一双|买一台|买台|买个|只看|仅看|筛选)/i.test(
        message,
      ) && this.hasProductSearchSignal(message)
    );
  }

  private hasProductSearchSignal(message: string) {
    return (
      normalizeProductCategoryOrNull(message) !== null ||
      /商品|产品|数码|电子产品|淘宝|天猫|京东|得物|拼多多|抖音|旗舰店|官方店|Nike|耐克|Adidas|阿迪|Puma|彪马|New Balance|新百伦|Asics|亚瑟士/i.test(
        message,
      )
    );
  }

  private isAdviceFirstQuestion(message: string) {
    const normalized = message.trim();
    const advicePattern =
      /有什么适合|适合.*吗|穿什么|怎么选|推荐哪类|哪种.*适合|通勤|上班|上课|约会|日常穿|日常.*鞋|穿搭|跑步.*怎么|篮球.*怎么|休闲.*怎么/i;
    const directSearchPattern =
      /我想买|要买|准备买|帮我找|找一下|搜索|搜一下|看看|看一下|有没有|只看|仅看|筛选|预算|价位|不超过|低于|少于|最多|最高|以内|以下|\d{2,5}\s*(元|块|rmb|RMB|¥)/i;

    return (
      advicePattern.test(normalized) && !directSearchPattern.test(normalized)
    );
  }

  private extractFilterPatch(message: string): Record<string, unknown> {
    const semanticPatch = analyzeShoppingLanguage(message).filterPatch;
    return Object.keys(semanticPatch).length > 0
      ? semanticPatch
      : extractShoppingFilterPatch(message);
  }

  private buildFallbackAssistantMessage(filterPatch: Record<string, unknown>) {
    const parts: string[] = [];
    if (filterPatch.brand) parts.push(`品牌为 ${filterPatch.brand}`);
    if (filterPatch.color) parts.push(`颜色为 ${filterPatch.color}`);
    if (filterPatch.size) parts.push(`尺码为 ${filterPatch.size}`);
    if (filterPatch.stockOnly === true) parts.push("只看有货");
    if (filterPatch.freeShippingOnly === true) parts.push("只看包邮");
    if (filterPatch.priceMax) parts.push(`${filterPatch.priceMax}元以内`);
    if (filterPatch.priceMin) parts.push(`${filterPatch.priceMin}元以上`);
    if (filterPatch.shopType === "flagship") parts.push("优先旗舰店");
    if (Array.isArray(filterPatch.platformsInclude)) {
      parts.push(
        `平台限定为 ${filterPatch.platformsInclude
          .map((platform) => displayPlatformLabel(platform))
          .join("、")}`,
      );
    }
    if (Array.isArray(filterPatch.platformsExclude)) {
      parts.push(
        `不看 ${filterPatch.platformsExclude
          .map((platform) => displayPlatformLabel(platform))
          .join("、")}`,
      );
    }
    if (filterPatch.sortRule === "price_asc") parts.push("按价格从低到高");
    if (filterPatch.sortRule === "price_desc") parts.push("按价格从高到低");
    if (filterPatch.sortRule === "relevance_desc") parts.push("按匹配度优先");
    if (filterPatch.sortRule === "rating_desc") parts.push("按评分优先");
    if (filterPatch.sortRule === "delivery_asc") parts.push("按送达速度优先");
    return parts.length > 0
      ? `好的，已为您${parts.join("，")}筛选。`
      : "收到，我会按这条要求继续收拢商品池。";
  }

  private buildNonFilterAssistantMessage(
    intent: ConversationIntent,
    input: ConversationTurnParseInput,
  ) {
    const top = input.candidateSummary[0];
    const second = input.candidateSummary[1];
    if (intent === "compare_candidates" && top && second) {
      return `当前前两项可以这样看：${top.title} 价格约 ${top.amount}${top.currency}，${second.title} 价格约 ${second.amount}${second.currency}。如果你重视低价先看价格更低的，如果重视稳妥度再结合店铺、库存和匹配原因判断。`;
    }
    if (intent === "explain_result" && top) {
      return `这类结果主要是根据识别到的商品特征、当前筛选条件、平台库存和价格信号返回的。当前靠前的是 ${top.title}，价格约 ${top.amount}${top.currency}，库存状态为 ${top.stockStatus}。`;
    }
    if (intent === "shopping_advice" && top) {
      return `从当前候选看，我建议先看 ${top.title}。它在现有结果里价格约 ${top.amount}${top.currency}，可以再结合库存、店铺类型和你的预算决定是否下单。`;
    }
    if (intent === "shopping_advice") {
      return this.buildShoppingAdviceFallback(
        input,
      );
    }
    if (intent === "compare_candidates") {
      return "当前还没有足够的候选商品可以比较。先补充具体商品或搜索条件后，我再基于真实结果帮你判断哪一项更合适。";
    }
    if (intent === "explain_result") {
      return "当前还没有可解释的候选商品结果。先补充具体商品或搜索条件后，我再基于真实结果说明推荐依据。";
    }
    if (intent === "ask_clarification") {
      return "我需要再确认一下：你是想让我给购买建议，还是要改变预算、平台、库存这些筛选条件？";
    }
    if (intent === "general_chat") {
      return this.buildGeneralChatFallback(input.latestUserMessage);
    }
    return "收到，我会结合当前上下文继续处理。";
  }

  private buildReferencedCandidateMessage(
    intent: ConversationIntent,
    refs: Array<{ ordinal: number; title: string }>,
  ) {
    if (intent === "compare_candidates" && refs.length >= 2) {
      return `你引用的是第 ${refs[0].ordinal} 项“${refs[0].title}”和第 ${refs[1].ordinal} 项“${refs[1].title}”。我会只基于这两项的价格、店铺、库存和匹配信息进行比较。`;
    }
    const ref = refs[0];
    if (!ref) return "请告诉我想查看哪一项候选商品。";
    if (intent === "explain_result") {
      return `你问的是第 ${ref.ordinal} 项“${ref.title}”。它的解释只会使用这一项的匹配信息和当前筛选条件。`;
    }
    return `你问的是第 ${ref.ordinal} 项“${ref.title}”，后续建议只针对这一项。`;
  }

  private buildGeneralChatFallback(message: string) {
    if (this.isCapabilityQuestion(message)) {
      return "我可以帮你拍照找同款、按预算和平台筛选商品、比较候选商品，也可以根据你的需求给购买建议。";
    }
    if (/累|疲惫|不想|烦|压力|焦虑|写代码|加班/i.test(message)) {
      return "那就先别硬扛了，先休息十分钟，回来只做一个最小任务，比如把报错读明白或先改一个最确定的问题。";
    }
    if (/谢谢|感谢|thanks|thank you/i.test(message)) {
      return "不客气。";
    }
    return "在的，直接说现在想聊什么。";
  }

  private isCapabilityQuestion(message: string) {
    return /你能做什么|你可以做什么|你是谁|怎么用|如何使用|介绍一下/i.test(
      message,
    );
  }

  private buildShoppingAdviceFallback(input: ConversationTurnParseInput): string {
    const message = input.latestUserMessage;
    const category = normalizeProductCategory(
      input.effectiveFilter.categoryScope ?? input.productProfile?.category ?? message,
      "general",
    );
    if (category !== "shoe") {
      return this.buildCategoryAdviceFallback(message, category);
    }
    const gender = this.extractShoppingGender(message, input.userMemoryContext);
    const genderPrefix =
      gender === "male" ? "男生" : gender === "female" ? "女生" : "";

    if (/通勤|上班|上课|日常.*通勤/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}通勤的话` : "通勤鞋的话";
      return `${subject}，我会优先推荐三类：简洁跑鞋、低帮板鞋和德训鞋/复古休闲鞋。每天走路多就优先看缓震和支撑，想更好搭配就选黑白灰、米色这类低调配色。通勤场景重点看舒适、耐脏、低调和好搭配。需要我直接帮你搜索具体商品吗？`;
    }

    if (/跑步|跑鞋|慢跑|长跑|短跑|running/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}跑步鞋` : "跑步鞋";
      return `${subject}建议先看缓震、支撑和鞋楦是否合脚。日常慢跑优先选稳定缓震跑鞋，配速训练可以看更轻的训练鞋，脚宽就避开过窄鞋型。需要我按这个方向帮你搜一批具体款吗？`;
    }

    if (/篮球|basketball/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}篮球鞋` : "篮球鞋";
      return `${subject}优先看包裹、抓地和侧向支撑。外场多就选耐磨大底，后卫打法可以偏轻快，锋线或体重大一些可以优先缓震和稳定。需要我直接帮你搜索具体商品吗？`;
    }

    if (
      /休闲|日常|逛街|小白鞋|板鞋|德训|复古|casual|lifestyle/i.test(message)
    ) {
      const subject = genderPrefix ? `${genderPrefix}日常休闲鞋` : "日常休闲鞋";
      return `${subject}我会优先看低帮板鞋、复古跑鞋和德训鞋。想百搭就选黑白灰或米色，想显轻快可以选浅色鞋面，日常穿重点看脚感、耐脏和搭配宽容度。需要我按这个方向帮你搜一批具体款吗？`;
    }

    if (/穿搭|搭配|约会|上班|上课/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}穿搭鞋` : "穿搭鞋";
      return `${subject}可以先按场景选：上班上课选低调板鞋或德训鞋，约会和日常出门选复古跑鞋或干净小白鞋。颜色先看黑、白、灰、米，更容易和裤装外套搭起来。需要我直接帮你搜索具体商品吗？`;
    }

    return "选鞋我会先看使用场景、预算、脚感需求和搭配风格。走路多优先缓震和支撑，想百搭优先低调配色，运动场景再按跑步、篮球或训练细分。需要我按这个方向帮你搜一批具体款吗？";
  }

  private buildCategoryAdviceFallback(message: string, category: string) {
    if (category === "computer") {
      const student = /学生|上课|学习|校园|大学|高中/i.test(message);
      if (/笔记本|laptop|notebook|便携/i.test(message) || student) {
        const subject = student ? "学生用电脑" : "笔记本电脑";
        return `${subject}我会先看预算、便携性、续航、性能和售后。上课和宿舍两头带建议优先轻薄本或全能本，至少 16GB 内存和 512GB 固态；如果要剪视频、建模或游戏，再看独显和散热。需要我按这个方向帮你搜索具体型号吗？`;
      }
      return "选电脑我会先看预算、用途、便携性、性能、屏幕和售后。办公学习优先轻薄本，创作和游戏再看独显、散热和扩展能力。需要我按这个方向帮你搜索具体型号吗？";
    }
    if (category === "phone") {
      return "选手机我会先看预算、系统偏好、续航、拍照、性能和存储。日常使用优先续航和手感，游戏或拍照再分别看芯片、散热和影像配置。需要我按这个方向帮你搜索具体机型吗？";
    }
    if (category === "headphones") {
      return "选耳机我会先看佩戴方式、降噪、音质、通话和续航。通勤优先主动降噪和佩戴稳定，运动场景重点看防水和不易掉。需要我按这个方向帮你搜索具体型号吗？";
    }
    const label = getProductCategoryDefinition(category).labelZh;
    return `选${label}我会先看使用场景、预算、核心参数和售后，再按你的偏好缩小范围。需要我按这个方向帮你搜索具体商品吗？`;
  }

  private extractShoppingGender(
    message: string,
    userMemoryContext?: Record<string, unknown> | null,
  ): "male" | "female" | null {
    const messageGender = this.normalizeGender(message);
    if (messageGender) return messageGender;

    const context = this.toRecord(userMemoryContext);
    const derived = this.toRecord(context.derived);
    return this.normalizeGender(
      derived.shoppingGender ??
        derived.preferredGenderForProducts ??
        derived.gender ??
        context.shoppingGender ??
        context.preferredGenderForProducts ??
        context.gender,
    );
  }

  private normalizeGender(value: unknown): "male" | "female" | null {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!text) return null;
    if (/女|female|women|woman|girl/.test(text)) return "female";
    if (/男|male|men|man|boy/.test(text)) return "male";
    return null;
  }

  private toOptionalAssistantMessage(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed === "已更新筛选条件。") return null;
    if (trimmed === "我需要更多信息才能继续筛选。") return null;
    if (trimmed === "收到，我会按这条要求继续收拢商品池。") return null;
    return trimmed;
  }

  private isCapabilityIntroMessage(message: string) {
    return /我在|你可以问我|我可以帮你|拍照找同款|按预算|筛选商品|比较候选|能力|功能/i.test(
      message,
    );
  }

  private toIntent(value: unknown): ConversationIntent {
    return typeof value === "string" &&
      INTENTS.includes(value as ConversationIntent)
      ? (value as ConversationIntent)
      : "refine_filter";
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private toAssistantMessage(value: unknown, intent: unknown): string {
    if (typeof value === "string" && value.trim().length > 0)
      return value.trim();
    if (intent === "ask_clarification") return "我需要更多信息才能继续筛选。";
    if (intent === "shopping_advice") return "我会基于当前候选给你购买建议。";
    if (intent === "general_chat") return "在的，直接说现在想聊什么。";
    return "已更新筛选条件。";
  }

  private toConfidence(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
