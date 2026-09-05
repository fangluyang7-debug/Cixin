import * as assert from 'node:assert/strict';
import {
  ConversationTurnParseInput,
  ConversationTurnParseResult,
} from '../src/adapters/model/model-adapter.interface';
import { CandidateSeed } from '../src/adapters/search-provider/search-provider.interface';
import { SessionsService } from '../src/modules/sessions/application/sessions.service';
import { StandardSearchQueryEmbeddingAdapterService } from '../src/modules/product-pool/application/standard-search-query-embedding-adapter.service';
import { StandardConversationIntentAdapterService } from '../src/modules/turns/application/standard-conversation-intent-adapter.service';
import { TurnsService } from '../src/modules/turns/application/turns.service';
import { StandardUserMemoryContextAdapterService } from '../src/modules/user-memory/application/standard-user-memory-context-adapter.service';
import { UserMemoryContextService } from '../src/modules/user-memory/application/user-memory-context.service';
import { normalizeProductCategory } from '../src/common/catalog/product-categories';
import { FilterStateService } from '../src/modules/conversation/application/filter-state.service';
import { StandardCandidateViewAdapterService } from '../src/modules/candidates/application/standard-candidate-view-adapter.service';

type SessionsInternals = {
  shouldStartProductSearch(message: string): boolean;
  filterFromText(message: string): Record<string, unknown>;
  buildInitialTextSearchAssistantMessage(input: {
    message: string;
    candidates: CandidateSeed[];
    fallback: unknown;
    effectiveFilter: Record<string, unknown>;
  }): string;
  buildInitialConversationAssistantMessage(input: {
    message: string;
    profile: Record<string, unknown>;
    userId: string | null;
    category: string;
  }): Promise<string>;
  buildTextProfile(
    message: string,
    keywords: string[],
    memory: Record<string, unknown> | null,
    categoryHint?: string,
  ): {
    category: string;
    brand: string | null;
    shoeType: string | null;
    size: string | null;
    keywords: string[];
  };
  buildDefaultFilterFromMemory(
    memory: Record<string, unknown>,
    categoryHint?: string,
  ): Record<string, unknown>;
};

type TurnsInternals = {
  forceProductSearchTurn(
    message: string,
    parsedTurn: ConversationTurnParseResult,
    context: ConversationTurnParseInput,
  ): ConversationTurnParseResult;
  resolveTurnSearchMessage(
    message: string,
    context: ConversationTurnParseInput,
  ): string;
  buildPostSearchAssistantMessage(input: {
    message: string;
    parsedTurn: ConversationTurnParseResult;
    candidates: CandidateSeed[];
    fallback: unknown;
    effectiveFilter: Record<string, unknown>;
  }): string;
  buildTurnSearchProfile(
    baseProfile: Record<string, unknown> | null,
    message: string,
    effectiveFilter: Record<string, unknown>,
  ): {
    category: string;
    brand: string | null;
    shoeType: string | null;
    size: string | null;
    keywords: string[];
  };
  isSnapshotOnlySortTurn(parsedTurn: {
    filterPatch?: Record<string, unknown>;
    filterRemove?: string[];
    shouldResetPreviousFilters?: boolean;
  }): boolean;
  isSnapshotRefineTurn(parsedTurn: {
    filterPatch?: Record<string, unknown>;
    filterRemove?: string[];
    shouldResetPreviousFilters?: boolean;
  }): boolean;
  filterSnapshotItems(
    items: Array<Record<string, unknown>>,
    filters: Record<string, unknown>,
  ): Array<Record<string, unknown>>;
  isTextQueryPreprocessSnapshot(
    preprocess: { selectionSource?: string | null } | null | undefined,
  ): boolean;
  isTextQueryAsset(
    asset: { sourceType?: string | null } | null | undefined,
  ): boolean;
};

const baseParsedTurn: ConversationTurnParseResult = {
  intent: 'general_chat',
  filterPatch: {},
  filterRemove: [],
  shouldResetPreviousFilters: false,
  assistantMessage: '我在。你可以问我哪双更值得买。',
  confidence: 0.5,
  raw: {},
};

function makeInput(
  message: string,
  patch: Partial<ConversationTurnParseInput> = {},
): ConversationTurnParseInput {
  return {
    sessionId: 'sess_smoke',
    turnIndex: 1,
    latestUserMessage: message,
    productProfile: null,
    effectiveFilter: { sortRule: 'price_asc' },
    userMemoryContext: null,
    conversationSummary: null,
    recentMessages: [],
    candidateSummary: [],
    prompt: { version: 'smoke', systemPrompt: '' },
    outputSchema: { version: 'smoke', schema: {} },
    profileSchema: { version: 'smoke', schema: {} },
    ...patch,
  };
}

function makeCandidate(title = 'Nike 通勤跑鞋'): CandidateSeed {
  return {
    title,
    platformName: '京东',
    amount: '499',
    currency: 'CNY',
    shopName: '官方旗舰店',
    shopType: 'flagship',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.test/shoe.jpg',
    productUrl: 'https://example.test/shoe',
    matchSummary: {},
    normalizedAttributes: {},
    rawPayload: {},
    recommendationReason: [],
    productPoolKey: 'nike-commute',
  };
}

function makeCandidateItem(input: {
  id: string;
  platformName: string;
  amount?: string;
  stockStatus?: string;
  colorFamily?: string;
  sizes?: string[];
  freeShipping?: boolean;
}) {
  return {
    id: input.id,
    title: `${input.platformName} 候选鞋款`,
    platformName: input.platformName,
    amount: input.amount ?? '499',
    currency: 'CNY',
    shopName: '测试店铺',
    shopType: 'flagship',
    stockStatus: input.stockStatus ?? 'in_stock',
    coverImageUrl: 'https://example.test/shoe.jpg',
    productUrl: 'https://example.test/shoe',
    matchSummaryJson: JSON.stringify({ displayScore: 0.9 }),
    normalizedAttributesJson: JSON.stringify({
      productId: `prod_${input.id}`,
      colorFamily: input.colorFamily ?? 'white',
      availableSizes: input.sizes ?? ['42'],
    }),
    rawPayloadJson: JSON.stringify({
      productPoolSource: { productId: `prod_${input.id}`, platform: input.platformName },
      productRawPayload: {
        fulfillment: { freeShipping: input.freeShipping ?? true },
      },
    }),
    recommendationReasonJson: '[]',
    rank: 1,
    pageIndex: 0,
    productPoolKey: `prod_${input.id}:product`,
  };
}

async function main() {
  const unavailableEmbeddingProvider = {
    embedText: async () => {
      throw new Error('EMBEDDING_PROVIDER_UNAVAILABLE');
    },
  };
  const queryEmbeddingAdapter = new StandardSearchQueryEmbeddingAdapterService(
    unavailableEmbeddingProvider as never,
    null as never,
    { get: () => 'multimodal' } as never,
  );
  const degradedQueryEmbedding = await queryEmbeddingAdapter.buildQueryEmbedding({
    keywords: ['nike', '通勤鞋'],
    profile: {
      category: 'shoe',
      brand: 'Nike',
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: null,
      color: null,
      styleTags: [],
      sceneTags: ['commute'],
      keywords: ['nike', '通勤鞋'],
      confidence: 0.8,
      raw: {},
    },
    queryImageUrl: null,
  });
  assert.deepEqual(degradedQueryEmbedding, []);

  const sessions = new (SessionsService as never as new (...args: unknown[]) => SessionsInternals)(
    ...new Array(17).fill(null),
  );

  assert.equal(sessions.shouldStartProductSearch('我想买一双nike鞋'), true);
  assert.equal(sessions.shouldStartProductSearch('我想买台笔记本电脑'), true);
  assert.equal(sessions.shouldStartProductSearch('有什么适合通勤穿的鞋吗'), false);
  assert.equal(sessions.shouldStartProductSearch('有没有500以内的通勤鞋'), true);
  assert.equal(sessions.shouldStartProductSearch('今天好累啊，不想写代码了'), false);
  assert.equal(normalizeProductCategory('有什么适合男生通勤穿的鞋吗'), 'shoe');
  assert.equal(normalizeProductCategory('有什么适合学生用的电脑吗'), 'computer');
  assert.equal(sessions.filterFromText('我想买一双nike鞋').brand, 'Nike');
  const filterState = new FilterStateService();
  const normalizedComputerFilter = filterState.normalizeState({
    categoryScope: 'computer',
    sortRule: 'relevance_desc',
  });
  assert.equal(normalizedComputerFilter.categoryScope, 'computer');
  const computerFilterMerge = filterState.merge(
    normalizedComputerFilter,
    {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { priceMax: '500' },
    },
    {
      promptVersion: 'smoke',
      schemaVersion: 'smoke',
      outputSchemaVersion: 'smoke',
    },
  );
  assert.equal(computerFilterMerge.effectiveFilter.categoryScope, 'computer');
  assert.equal(computerFilterMerge.rawJson.categoryScope, 'computer');
  const candidateViewAdapter = new StandardCandidateViewAdapterService();
  assert.deepEqual(
    candidateViewAdapter.buildRequiredInfoView({ categoryScope: 'computer' }).fields,
    [],
  );
  assert.equal(
    candidateViewAdapter.buildRequiredInfoView({ categoryScope: 'shoe' }).category,
    'shoe',
  );
  const shoeMemory = {
    preferredPlatforms: [],
    excludedPlatforms: [],
    preferredColors: [],
    favoriteBrands: ['Nike'],
    shoeSize: '42',
    trustedStores: [],
    maxDeliveryDays: null,
    responseStyle: null,
    shoppingGender: null,
  };
  const shoeMemoryDefaultFilter = sessions.buildDefaultFilterFromMemory(
    shoeMemory,
    'shoe',
  );
  assert.equal(shoeMemoryDefaultFilter.brand, undefined);
  assert.equal(shoeMemoryDefaultFilter.size, '42');

  const shoeMemoryAdviceProfile = sessions.buildTextProfile(
    '有什么适合男生通勤穿的鞋？',
    ['有什么适合男生通勤穿的鞋'],
    shoeMemory,
    'shoe',
  );
  assert.equal(shoeMemoryAdviceProfile.category, 'shoe');
  assert.equal(shoeMemoryAdviceProfile.brand, null);
  assert.equal(shoeMemoryAdviceProfile.size, '42');

  const inferredShoeAdviceProfile = sessions.buildTextProfile(
    '有什么适合男生通勤穿的鞋吗',
    ['有什么适合男生通勤穿的鞋吗'],
    shoeMemory,
  );
  assert.equal(inferredShoeAdviceProfile.category, 'shoe');
  assert.equal(inferredShoeAdviceProfile.brand, null);
  assert.equal(inferredShoeAdviceProfile.size, '42');

  const explicitShoeBrandProfile = sessions.buildTextProfile(
    '我想买耐克跑鞋',
    ['我想买耐克跑鞋'],
    shoeMemory,
    'shoe',
  );
  assert.equal(explicitShoeBrandProfile.brand, 'Nike');

  const laptopTextProfile = sessions.buildTextProfile(
    '我想买台笔记本电脑',
    ['我想买台笔记本电脑'],
    shoeMemory,
    'computer',
  );
  assert.equal(laptopTextProfile.category, 'computer');
  assert.equal(laptopTextProfile.brand, null);
  assert.equal(laptopTextProfile.size, null);
  const studentComputerAdvice =
    await sessions.buildInitialConversationAssistantMessage({
      message: '有什么适合学生用的电脑吗',
      profile: laptopTextProfile,
      userId: null,
      category: 'computer',
    });
  assert.match(studentComputerAdvice, /学生用电脑|笔记本电脑/);
  assert.match(studentComputerAdvice, /预算|续航|性能/);
  assert.doesNotMatch(studentComputerAdvice, /选鞋|鞋|脚感|跑鞋|板鞋/);
  assert.equal(
    sessions.buildDefaultFilterFromMemory(shoeMemory, 'computer').brand,
    undefined,
  );
  const laptopInitialSearchMessage =
    sessions.buildInitialTextSearchAssistantMessage({
      message: '我想买台笔记本电脑',
      candidates: [makeCandidate('MacBook Pro 14')],
      fallback: null,
      effectiveFilter: { categoryScope: 'computer' },
    });
  assert.match(laptopInitialSearchMessage, /已为您搜索 笔记本电脑/);
  assert.doesNotMatch(laptopInitialSearchMessage, /鞋款/);
  for (const [message, category] of [
    ['我想买个手机', 'phone'],
    ['帮我找蓝牙耳机', 'headphones'],
    ['搜索相机', 'camera'],
    ['买个鼠标', 'mouse'],
  ] as const) {
    const categoryMessage = sessions.buildInitialTextSearchAssistantMessage({
      message,
      candidates: [makeCandidate(`${category} candidate`)],
      fallback: null,
      effectiveFilter: { categoryScope: category },
    });
    assert.doesNotMatch(categoryMessage, /鞋款/);
    assert.equal(sessions.buildTextProfile(message, [message], shoeMemory).category, category);
  }

  const badAdviceModel = {
    parseConversationTurn: async () => ({
      ...baseParsedTurn,
      intent: 'shopping_advice',
      assistantMessage: '我在。你可以问我哪双更值得买、为什么推荐。',
    }),
  };
  const adviceAdapter = new StandardConversationIntentAdapterService(
    badAdviceModel as never,
  );
  const advice = await adviceAdapter.parseTurn(
    makeInput('有什么适合通勤穿的鞋吗'),
  );
  assert.equal(advice.intent, 'shopping_advice');
  assert.deepEqual(advice.filterPatch, {});
  assert.match(advice.assistantMessage, /通勤/);
  assert.match(advice.assistantMessage, /推荐/);
  assert.match(advice.assistantMessage, /搜索/);
  assert.doesNotMatch(advice.assistantMessage, /我在|你可以问我哪双更值得买|男生通勤/);

  const maleAdvice = await adviceAdapter.parseTurn(
    makeInput('有什么适合通勤穿的鞋吗', {
      userMemoryContext: { derived: { shoppingGender: 'male' } },
    }),
  );
  assert.match(maleAdvice.assistantMessage, /男生通勤/);
  const computerAdvice = await adviceAdapter.parseTurn(
    makeInput('有什么适合学生用的电脑吗', {
      productProfile: {
        category: 'computer',
        brand: null,
        modelLine: null,
        colorFamily: null,
        colorway: null,
        shoeType: null,
        size: null,
        color: null,
        styleTags: [],
        sceneTags: [],
        keywords: ['有什么适合学生用的电脑吗'],
        confidence: 0.62,
        raw: {},
      },
      effectiveFilter: { sortRule: 'relevance_desc', categoryScope: 'computer' },
    }),
  );
  assert.equal(computerAdvice.intent, 'shopping_advice');
  assert.match(computerAdvice.assistantMessage, /学生用电脑|笔记本电脑/);
  assert.doesNotMatch(computerAdvice.assistantMessage, /选鞋|脚感|跑鞋|板鞋/);

  const throwingModel = {
    parseConversationTurn: async () => {
      throw new Error('MODEL_DOWN');
    },
  };
  const fallbackAdapter = new StandardConversationIntentAdapterService(
    throwingModel as never,
  );
  const directSearch = await fallbackAdapter.parseTurn(
    makeInput('我想买一双nike鞋'),
  );
  assert.equal(directSearch.intent, 'refine_filter');
  assert.deepEqual(directSearch.filterPatch.brandsInclude, ['Nike']);
  const laptopDirectSearch = await fallbackAdapter.parseTurn(
    makeInput('我想买台笔记本电脑'),
  );
  assert.equal(laptopDirectSearch.intent, 'refine_filter');
  const phoneDirectSearch = await fallbackAdapter.parseTurn(makeInput('我想买个手机'));
  assert.equal(phoneDirectSearch.intent, 'refine_filter');

  const priceFilter = await fallbackAdapter.parseTurn(
    makeInput('只看500元以下的'),
  );
  assert.equal(priceFilter.intent, 'refine_filter');
  assert.equal(priceFilter.filterPatch.priceMax, '500');

  const platformFilter = await fallbackAdapter.parseTurn(makeInput('只看京东'));
  assert.equal(platformFilter.intent, 'refine_filter');
  assert.deepEqual(platformFilter.filterPatch.platformsInclude, ['jd']);

  const jdTypoFilter = await fallbackAdapter.parseTurn(makeInput('只看京冬'));
  assert.deepEqual(jdTypoFilter.filterPatch.platformsInclude, ['jd']);

  const pddExcludeFilter = await fallbackAdapter.parseTurn(makeInput('不看拼夕夕'));
  assert.equal(pddExcludeFilter.intent, 'refine_filter');
  assert.deepEqual(pddExcludeFilter.filterPatch.platformsExclude, ['pdd']);

  const xianyuExcludeFilter = await fallbackAdapter.parseTurn(makeInput('不看咸鱼'));
  assert.equal(xianyuExcludeFilter.intent, 'refine_filter');
  assert.deepEqual(xianyuExcludeFilter.filterPatch.platformsExclude, ['xianyu']);

  const secondHandExcludeFilter = await fallbackAdapter.parseTurn(
    makeInput('不要二手的'),
  );
  assert.equal(secondHandExcludeFilter.intent, 'refine_filter');
  assert.deepEqual(secondHandExcludeFilter.filterPatch.platformsExclude, ['xianyu']);

  const dewuAliasFilter = await fallbackAdapter.parseTurn(makeInput('只看毒app'));
  assert.deepEqual(dewuAliasFilter.filterPatch.platformsInclude, ['dewu']);

  const chineseBudgetFilter = await fallbackAdapter.parseTurn(makeInput('五百以内'));
  assert.equal(chineseBudgetFilter.filterPatch.priceMax, '500');

  const priceFloorFilter = await fallbackAdapter.parseTurn(makeInput('三百以上'));
  assert.equal(priceFloorFilter.filterPatch.priceMin, '300');

  const stockFilter = await fallbackAdapter.parseTurn(makeInput('不要没货的'));
  assert.equal(stockFilter.filterPatch.stockOnly, true);

  const shippingFilter = await fallbackAdapter.parseTurn(makeInput('不要邮费'));
  assert.equal(shippingFilter.filterPatch.freeShippingOnly, true);

  const colorExcludeGuard = await fallbackAdapter.parseTurn(makeInput('不要黑色'));
  assert.equal(colorExcludeGuard.filterPatch.color, undefined);

  const sortFilter = await fallbackAdapter.parseTurn(makeInput('按价格从低到高'));
  assert.equal(sortFilter.intent, 'refine_filter');
  assert.equal(sortFilter.filterPatch.sortRule, 'price_asc');

  const matchSortFilter = await fallbackAdapter.parseTurn(makeInput('按匹配度重新排序'));
  assert.equal(matchSortFilter.intent, 'refine_filter');
  assert.equal(matchSortFilter.filterPatch.sortRule, 'relevance_desc');

  const chat = await fallbackAdapter.parseTurn(
    makeInput('今天好累啊，不想写代码了'),
  );
  assert.equal(chat.intent, 'general_chat');
  assert.deepEqual(chat.filterPatch, {});
  assert.doesNotMatch(chat.assistantMessage, /我在|你可以问我|能力|功能/);

  const compareWithoutCandidates = await fallbackAdapter.parseTurn(
    makeInput('这两个哪个更好'),
  );
  assert.equal(compareWithoutCandidates.intent, 'compare_candidates');
  assert.deepEqual(compareWithoutCandidates.filterPatch, {});
  assert.match(compareWithoutCandidates.assistantMessage, /还没有足够的候选商品/);
  assert.doesNotMatch(compareWithoutCandidates.assistantMessage, /我在|你可以问我|能力|功能/);

  const explainWithoutCandidates = await fallbackAdapter.parseTurn(
    makeInput('为什么推荐这个'),
  );
  assert.equal(explainWithoutCandidates.intent, 'ask_clarification');
  assert.deepEqual(explainWithoutCandidates.filterPatch, {});
  assert.match(explainWithoutCandidates.assistantMessage, /没有第 1 项/);
  assert.doesNotMatch(explainWithoutCandidates.assistantMessage, /我在|你可以问我|能力|功能/);

  const blankGeneralChatModel = {
    parseConversationTurn: async () => ({
      ...baseParsedTurn,
      intent: 'general_chat',
      assistantMessage: '',
    }),
  };
  const blankGeneralChatAdapter = new StandardConversationIntentAdapterService(
    blankGeneralChatModel as never,
  );
  const blankGeneralChat = await blankGeneralChatAdapter.parseTurn(
    makeInput('随便聊聊'),
  );
  assert.equal(blankGeneralChat.intent, 'general_chat');
  assert.doesNotMatch(blankGeneralChat.assistantMessage, /我在|你可以问我|能力|功能/);

  const badNonFilterModel = {
    parseConversationTurn: async (input: ConversationTurnParseInput) => ({
      ...baseParsedTurn,
      intent: input.latestUserMessage.includes('为什么')
        ? 'explain_result' as const
        : 'compare_candidates' as const,
      assistantMessage: '我在。你可以问我商品选择、筛选条件或功能。',
    }),
  };
  const guardedNonFilterAdapter = new StandardConversationIntentAdapterService(
    badNonFilterModel as never,
  );
  const guardedCompare = await guardedNonFilterAdapter.parseTurn(
    makeInput('这两个哪个更好'),
  );
  assert.equal(guardedCompare.intent, 'compare_candidates');
  assert.match(guardedCompare.assistantMessage, /还没有足够的候选商品/);
  assert.doesNotMatch(guardedCompare.assistantMessage, /我在|你可以问我|能力|功能/);

  const guardedExplain = await guardedNonFilterAdapter.parseTurn(
    makeInput('为什么推荐这个'),
  );
  assert.equal(guardedExplain.intent, 'ask_clarification');
  assert.match(guardedExplain.assistantMessage, /没有第 1 项/);
  assert.doesNotMatch(guardedExplain.assistantMessage, /我在|你可以问我|能力|功能/);

  const turns = new (TurnsService as never as new (...args: unknown[]) => TurnsInternals)(
    ...new Array(12).fill(null),
  );
  const searchOfferContext = makeInput('好的', {
    turnIndex: 1,
    recentMessages: [
      {
        turnIndex: 0,
        role: 'user',
        content: '有什么适合通勤穿的鞋吗',
        metadata: {},
        createdAt: new Date(0).toISOString(),
      },
      {
        turnIndex: 0,
        role: 'assistant',
        content: '需要我直接帮你搜索具体商品吗？',
        metadata: {},
        createdAt: new Date(1).toISOString(),
      },
      {
        turnIndex: 1,
        role: 'user',
        content: '好的',
        metadata: {},
        createdAt: new Date(2).toISOString(),
      },
    ],
  });
  const confirmedSearch = turns.forceProductSearchTurn(
    '好的',
    baseParsedTurn,
    searchOfferContext,
  );
  assert.equal(confirmedSearch.intent, 'refine_filter');
  assert.equal(
    turns.isTextQueryPreprocessSnapshot({ selectionSource: 'text_query' }),
    true,
  );
  assert.equal(
    turns.isTextQueryPreprocessSnapshot({ selectionSource: 'text_turn' }),
    true,
  );
  assert.equal(
    turns.isTextQueryPreprocessSnapshot({ selectionSource: 'auto' }),
    false,
  );
  assert.equal(turns.isTextQueryAsset({ sourceType: 'text_query' }), true);
  assert.equal(turns.isTextQueryAsset({ sourceType: 'upload' }), false);
  assert.equal(
    turns.resolveTurnSearchMessage('好的', searchOfferContext),
    '有什么适合通勤穿的鞋吗',
  );

  const directContextualSearch = makeInput('直接为我搜索', {
    turnIndex: 2,
    recentMessages: [
      ...searchOfferContext.recentMessages,
      {
        turnIndex: 1,
        role: 'assistant',
        content: '如果之后需要搜索具体通勤鞋款，随时告诉我。',
        metadata: {},
        createdAt: new Date(3).toISOString(),
      },
      {
        turnIndex: 2,
        role: 'user',
        content: '直接为我搜索',
        metadata: {},
        createdAt: new Date(4).toISOString(),
      },
    ],
  });
  const directContextualSearchTurn = turns.forceProductSearchTurn(
    '直接为我搜索',
    baseParsedTurn,
    directContextualSearch,
  );
  assert.equal(directContextualSearchTurn.intent, 'refine_filter');
  assert.equal(
    turns.resolveTurnSearchMessage(
      '直接为我搜索',
      directContextualSearch,
    ),
    '有什么适合通勤穿的鞋吗 直接为我搜索',
  );

  const unrelatedAcknowledgement = turns.forceProductSearchTurn(
    '好的',
    baseParsedTurn,
    makeInput('好的', {
      recentMessages: [
        {
          turnIndex: 0,
          role: 'assistant',
          content: '今天辛苦了。',
          metadata: {},
          createdAt: new Date(0).toISOString(),
        },
      ],
    }),
  );
  assert.equal(unrelatedAcknowledgement.intent, 'general_chat');

  const staleOfferAcknowledgement = turns.forceProductSearchTurn(
    '好的',
    baseParsedTurn,
    makeInput('好的', {
      turnIndex: 2,
      recentMessages: [
        ...searchOfferContext.recentMessages.slice(0, 2),
        {
          turnIndex: 1,
          role: 'user',
          content: '谢谢',
          metadata: {},
          createdAt: new Date(2).toISOString(),
        },
        {
          turnIndex: 1,
          role: 'assistant',
          content: '不客气。',
          metadata: {},
          createdAt: new Date(3).toISOString(),
        },
        {
          turnIndex: 2,
          role: 'user',
          content: '好的',
          metadata: {},
          createdAt: new Date(4).toISOString(),
        },
      ],
    }),
  );
  assert.equal(staleOfferAcknowledgement.intent, 'general_chat');

  const memoryBrandProfile = {
    category: 'shoe',
    brand: 'Nike',
    modelLine: null,
    colorFamily: null,
    colorway: null,
    shoeType: null,
    size: '42',
    color: null,
    styleTags: [],
    sceneTags: [],
    keywords: ['有什么适合男生通勤穿的鞋？'],
    confidence: 0.62,
    raw: {
      source: 'text_query',
      initialConversationOnly: true,
      preferredBrands: ['Nike'],
    },
  };
  const inheritedMemoryBrandProfile = turns.buildTurnSearchProfile(
    memoryBrandProfile,
    '有什么适合男生通勤穿的鞋？ 好的',
    { sortRule: 'relevance_desc', categoryScope: 'shoe' },
  );
  assert.equal(inheritedMemoryBrandProfile.brand, null);

  const inferredShoeTurnProfile = turns.buildTurnSearchProfile(
    {
      category: 'general',
      brand: null,
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: null,
      color: null,
      styleTags: [],
      sceneTags: [],
      keywords: ['有什么适合男生通勤穿的鞋吗'],
      confidence: 0.62,
      raw: {
        source: 'text_query',
        initialConversationOnly: true,
      },
    },
    '有什么适合男生通勤穿的鞋吗 好的',
    { sortRule: 'relevance_desc' },
  );
  assert.equal(inferredShoeTurnProfile.category, 'shoe');
  assert.equal(inferredShoeTurnProfile.shoeType, null);
  assert.ok(inferredShoeTurnProfile.keywords.includes('鞋'));
  assert.equal(inferredShoeTurnProfile.keywords.includes('百货'), false);

  const explicitTurnBrandProfile = turns.buildTurnSearchProfile(
    memoryBrandProfile,
    '我想买耐克跑鞋',
    { sortRule: 'relevance_desc', categoryScope: 'shoe' },
  );
  assert.equal(explicitTurnBrandProfile.brand, 'Nike');

  assert.equal(
    turns.isSnapshotOnlySortTurn({
      filterPatch: { sortRule: 'relevance_desc' },
      filterRemove: [],
      shouldResetPreviousFilters: false,
    }),
    true,
  );
  assert.equal(
    turns.isSnapshotOnlySortTurn({
      filterPatch: { sortRule: 'relevance_desc', priceMax: '500' },
      filterRemove: [],
      shouldResetPreviousFilters: false,
    }),
    false,
  );
  assert.equal(
    turns.isSnapshotRefineTurn({
      filterPatch: { platformsExclude: ['xianyu'], priceMax: '500' },
      filterRemove: [],
      shouldResetPreviousFilters: false,
    }),
    false,
  );
  assert.equal(
    turns.isSnapshotRefineTurn({
      filterPatch: { brand: 'Nike' },
      filterRemove: [],
      shouldResetPreviousFilters: false,
    }),
    false,
  );
  const snapshotFiltered = turns.filterSnapshotItems(
    [
      makeCandidateItem({ id: 'xianyu', platformName: 'xianyu1', amount: '399' }),
      makeCandidateItem({ id: 'jd', platformName: '京冬', amount: '499' }),
      makeCandidateItem({ id: 'pdd', platformName: '拼夕夕', amount: '599' }),
    ],
    { platformsExclude: ['咸鱼'], priceMax: '500' },
  );
  assert.deepEqual(
    snapshotFiltered.map((item) => item.id),
    ['jd'],
  );
  const candidates = [makeCandidate(), makeCandidate('Nike 黑色板鞋')];
  const postSearch = turns.buildPostSearchAssistantMessage({
    message: '我想买一双 Nike 鞋',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { brand: 'Nike' },
    },
    candidates,
    fallback: null,
    effectiveFilter: { brand: 'Nike', sortRule: 'price_asc', categoryScope: 'shoe' },
  });
  assert.match(postSearch, /已为您搜索 Nike 相关鞋款/);
  assert.match(postSearch, /找到 2 个结果/);
  const postLaptopSearch = turns.buildPostSearchAssistantMessage({
    message: '我想买台笔记本电脑',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: {},
    },
    candidates: [makeCandidate('MacBook Pro 14')],
    fallback: null,
    effectiveFilter: { categoryScope: 'computer' },
  });
  assert.match(postLaptopSearch, /已为您搜索 笔记本电脑/);
  assert.doesNotMatch(postLaptopSearch, /鞋款/);
  const postLaptopBrandFilter = turns.buildPostSearchAssistantMessage({
    message: '只看 Apple',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { brand: 'Apple' },
    },
    candidates: [makeCandidate('MacBook Air')],
    fallback: null,
    effectiveFilter: { categoryScope: 'computer', brand: 'Apple' },
  });
  assert.match(postLaptopBrandFilter, /Apple 相关电脑/);
  assert.doesNotMatch(postLaptopBrandFilter, /鞋款/);
  const switchedLaptopProfile = turns.buildTurnSearchProfile(
    {
      category: 'shoe',
      brand: 'Nike',
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: '42',
      color: null,
      styleTags: [],
      sceneTags: [],
      keywords: ['Nike', '鞋'],
      confidence: 0.8,
      raw: {},
    },
    '换成笔记本电脑',
    { categoryScope: 'computer', brand: 'Nike', size: '42' },
  );
  assert.equal(switchedLaptopProfile.category, 'computer');
  assert.equal(switchedLaptopProfile.brand, null);
  assert.equal(switchedLaptopProfile.size, null);
  assert.ok(switchedLaptopProfile.keywords.includes('电脑'));
  assert.equal(switchedLaptopProfile.keywords.includes('鞋'), false);
  const switchedPhoneProfile = turns.buildTurnSearchProfile(
    {
      category: 'shoe',
      brand: 'Nike',
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: '42',
      color: null,
      styleTags: [],
      sceneTags: [],
      keywords: ['Nike', '鞋'],
      confidence: 0.8,
      raw: {},
    },
    '换成手机',
    { categoryScope: 'phone', brand: 'Nike', size: '42' },
  );
  assert.equal(switchedPhoneProfile.category, 'phone');
  assert.equal(switchedPhoneProfile.brand, null);
  assert.equal(switchedPhoneProfile.size, null);
  assert.ok(switchedPhoneProfile.keywords.includes('手机'));
  assert.equal(switchedPhoneProfile.keywords.includes('鞋'), false);

  const postPriceFilter = turns.buildPostSearchAssistantMessage({
    message: '只看500元以下的',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { priceMax: '500' },
    },
    candidates: [makeCandidate()],
    fallback: null,
    effectiveFilter: { priceMax: '500', sortRule: 'price_asc' },
  });
  assert.match(postPriceFilter, /已为您更新商品/);
  assert.match(postPriceFilter, /500元以下/);
  assert.doesNotMatch(postPriceFilter, /重新排序/);

  const postPlatformFilter = turns.buildPostSearchAssistantMessage({
    message: '只看京东',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { platformsInclude: ['jd'] },
    },
    candidates: [makeCandidate()],
    fallback: null,
    effectiveFilter: { platformsInclude: ['jd'], sortRule: 'price_asc' },
  });
  assert.match(postPlatformFilter, /京东平台/);

  const postSortFilter = turns.buildPostSearchAssistantMessage({
    message: '按价格从低到高',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { sortRule: 'price_asc' },
    },
    candidates: [makeCandidate()],
    fallback: null,
    effectiveFilter: { sortRule: 'price_asc' },
  });
  assert.match(postSortFilter, /按价格从低到高重新排序/);

  const noResult = turns.buildPostSearchAssistantMessage({
    message: '只看500元以下的',
    parsedTurn: {
      ...baseParsedTurn,
      intent: 'refine_filter',
      filterPatch: { priceMax: '500' },
    },
    candidates: [],
    fallback: { reason: 'NO_CANDIDATES_AFTER_FILTER' },
    effectiveFilter: { priceMax: '500' },
  });
  assert.match(noResult, /暂时没有找到合适商品/);
  assert.doesNotMatch(noResult, /图片识别失败/);

  const memoryAdapter = new StandardUserMemoryContextAdapterService();
  const preferredGenderContext = memoryAdapter.toContext({
    userId: 'user_smoke',
    category: 'shoe',
    blocks: [
      {
        id: 'block_1',
        blockType: 'profile',
        scope: 'global',
        payloadJson: JSON.stringify({
          gender: 'female',
          preferredGenderForProducts: '男',
        }),
        sensitivity: 'normal',
        schemaVersion: 'v1',
      } as never,
    ],
  });
  assert.equal(preferredGenderContext.derived.shoppingGender, 'male');

  const explicitGenderContext = memoryAdapter.toContext({
    userId: 'user_smoke',
    category: 'shoe',
    blocks: [
      {
        id: 'block_2',
        blockType: 'profile',
        scope: 'global',
        payloadJson: JSON.stringify({
          shoppingGender: 'female',
          preferredGenderForProducts: 'male',
          gender: 'male',
        }),
        sensitivity: 'normal',
        schemaVersion: 'v1',
      } as never,
    ],
  });
  assert.equal(explicitGenderContext.derived.shoppingGender, 'female');

  const memoryContextService = new (UserMemoryContextService as never as new (
    prisma: unknown,
    contextAdapter: unknown,
  ) => {
    getDefaultFilter(userId: string, category?: string): Promise<Record<string, unknown>>;
  })(
    {
      userProfileBlock: {
        findMany: async () => [
          {
            id: 'block_3',
            blockType: 'size_profile',
            scope: 'shoe',
            payloadJson: JSON.stringify({ shoeSize: '42' }),
            sensitivity: 'normal',
            schemaVersion: 'v1',
          },
          {
            id: 'block_4',
            blockType: 'brand_store_preferences',
            scope: 'global',
            payloadJson: JSON.stringify({ favoriteBrands: ['Nike'] }),
            sensitivity: 'normal',
            schemaVersion: 'v1',
          },
        ],
      },
    },
    memoryAdapter,
  );
  assert.equal((await memoryContextService.getDefaultFilter('user_smoke', 'shoe')).size, '42');
  const computerDefaultFilter = await memoryContextService.getDefaultFilter(
    'user_smoke',
    'computer',
  );
  assert.equal(computerDefaultFilter.size, undefined);
  assert.equal(computerDefaultFilter.brand, undefined);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
