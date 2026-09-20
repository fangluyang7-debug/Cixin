import { StoreManager } from '../database/StoreManager';
import { Product } from '../models/Product';
import { DataInitService } from '../services/DataInitService';
import { ModelSearchResult, ModelSearchService } from '../services/ModelSearchService';
import { AiInferenceResult, ChatIntentResult, LocalAiModelEngine } from '../services/LocalAiModelEngine';
import { NeuralEmbeddingIndex } from '../services/NeuralEmbeddingIndex';
import { PrivacyAssessment, PrivacyGuard } from '../services/PrivacyGuard';
import { ModelEngineRegistry } from '../services/ModelEngineRegistry';
import hilog from '@ohos.hilog';
import { promptAction, router } from '@kit.ArkUI';
import {
  AccuracyPreference,
  DataResidencyPolicy,
  Backend,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
  RemoteExecutionPlan,
  SchedulerLogEntry,
  SchedulerService,
  TaskRequest,
  TaskResult,
  TaskStatus,
  TaskType
} from 'scheduler';

const PAGE_SIZE: number = 20;

enum SoleAiViewMode {
  HOME = 'HOME',
  LENS = 'LENS',
  CROPPING = 'CROPPING',
  CHAT = 'CHAT'
}

interface ProductSearchInput {
  keyword: string;
  limit: number;
  offset: number;
}

interface ProductSearchRequest extends TaskRequest<ProductSearchInput> {
}

interface QuickIntent {
  title: string;
  keyword: string;
}

interface HistoryItem {
  title: string;
  meta: string;
  active: boolean;
}

@Entry
@Component
struct Index {
  private readonly schedulerService: SchedulerService = SchedulerService.getInstance();
  private readonly modelSearchService: ModelSearchService = ModelSearchService.getInstance();
  private lastResolvedKeyword: string = '';
  private lastModelSearchSource: string = 'local_rule';
  private readonly quickIntents: QuickIntent[] = [
    { title: '拍鞋找同款', keyword: '运动鞋' },
    { title: '耐克 鞋推荐', keyword: '耐克 运动鞋' },
    { title: '运动鞋鞋', keyword: '运动鞋' },
    { title: '男生通勤鞋', keyword: '男鞋 通勤' }
  ];
  private readonly histories: HistoryItem[] = [
    { title: '我上传了一张图片，帮我找同款或相似商品', meta: '刚刚', active: true },
    { title: '我上传了一张图片，帮我找同款或相似商品', meta: '30 件候选 · 刚刚', active: false },
    { title: '请给我推荐一些适合学生用的电脑', meta: '1 件候选 · 26 天前', active: false },
    { title: '我上传了一张图片，帮我找同款或相似商品', meta: '云端会话 · 26 天前', active: false }
  ];

  @State viewMode: SoleAiViewMode = SoleAiViewMode.HOME;
  @State queryText: string = '';
  @State userPrompt: string = '';
  @State assistantText: string = '正在准备本地商品数据';
  @State productsCount: number = 0;
  @State products: Product[] = [];
  @State isLoading: boolean = false;
  @State showDrawer: boolean = false;
  @State showProfile: boolean = false;
  @State schedulerText: string = '调度层准备中';
  @State schedulerPlanText: string = '等待任务';
  @State routeText: string = '当前链路';
  @State showSchedulerFloatPanel: boolean = false;
  @State schedulerFloatLeftPercent: number = 70;
  @State schedulerFloatTopPercent: number = 66;
  @State activeCapabilityLabel: string = '文字关键词比价搜索';
  @State activeCapabilityName: string = 'local_product_search';
  @State activeTaskType: string = 'USER_INITIATED';
  @State activePriorityText: string = 'HIGH (高优先)';
  @State activeLatencyText: string = '预算 250 ms';
  @State latestLogs: SchedulerLogEntry[] = [];
  @State selectedProduct: Product | null = null;
  @State showProductDetailModal: boolean = false;
  private schedulerFloatStartLeftPercent: number = 70;
  private schedulerFloatStartTopPercent: number = 66;
  private schedulerFloatMoved: boolean = false;

  aboutToAppear(): void {
    this.loadInitialProducts();
    if (this.schedulerService.isInitialized()) {
      this.refreshHudLogs();
      this.schedulerService.registerLogCallback(() => {
        this.refreshHudLogs();
      });
      this.triggerBackgroundIndexTask();
    }
  }

  private refreshHudLogs(): void {
    if (this.schedulerService.isInitialized()) {
      this.latestLogs = this.schedulerService.getRecentLogs(2).slice().reverse();
    }
  }

  private async loadInitialProducts(): Promise<void> {
    this.isLoading = true;
    this.assistantText = '正在准备本地商品数据';
    try {
      await DataInitService.waitUntilReady();
      const storeManager: StoreManager = StoreManager.getInstance();
      this.productsCount = await storeManager.getProductCount();
      this.products = await storeManager.queryTopProducts(6);
      this.assistantText = `本地已准备 ${this.productsCount} 件商品`;
      this.schedulerText = '可以开始拍照、语音或文字搜索';
    } catch (error) {
      this.assistantText = '本地商品加载失败，请稍后重试';
      hilog.error(0x0000, 'IndexPage', `Initial product load failed: ${JSON.stringify(error)}`);
    } finally {
      this.isLoading = false;
    }
  }

  private async submitFromInput(): Promise<void> {
    const keyword: string = this.queryText.trim();
    if (keyword.length === 0 || this.isLoading) {
      return;
    }
    this.queryText = '';
    await this.performSearch(keyword, `帮我找：${keyword}`);
  }

  private async startQuickIntent(intent: QuickIntent): Promise<void> {
    if (intent.title === '拍鞋找同款') {
      this.openLens();
      return;
    }
    await this.performSearch(intent.keyword, intent.title);
  }

  private openLens(): void {
    this.viewMode = SoleAiViewMode.LENS;
    this.activeCapabilityLabel = '实时镜头与检测预览';
    this.activeCapabilityName = 'camera_lens_realtime';
    this.activeTaskType = 'FOREGROUND_REALTIME';
    this.activePriorityText = 'CRITICAL (最高优先)';
    this.activeLatencyText = '预算 80 ms';

    if (this.schedulerService.isInitialized()) {
      const request: TaskRequest<string> = {
        taskType: TaskType.FOREGROUND_REALTIME,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: 'camera_lens_realtime',
        input: 'lens-preview',
        accuracyPreference: AccuracyPreference.QUALITY_FIRST,
        latencyBudgetMs: 80,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 1500
      };
      this.schedulerService.runTask<string, string>(
        request,
        async (input: string, _plan: ExecutionPlan) => input
      ).then((res: TaskResult<string>) => {
        this.schedulerText = this.formatSchedulerResult(res);
        this.schedulerPlanText = this.formatPlanBadge(res.executionPlan);
        this.routeText = this.formatRouteText(res.executionPlan);
      }).catch(() => {});
    }
  }

  private closeLens(): void {
    this.viewMode = SoleAiViewMode.HOME;
    this.schedulerText = '已返回首页';
    this.schedulerPlanText = '等待任务';
  }

  private async captureAndSearch(): Promise<void> {
    if (this.isLoading) {
      return;
    }
    this.viewMode = SoleAiViewMode.CROPPING;
    this.activeCapabilityLabel = '图片主体框选与特征提取';
    this.activeCapabilityName = 'image_crop_detection';
    this.activeTaskType = 'FOREGROUND_REALTIME';
    this.activePriorityText = 'CRITICAL (最高优先)';
    this.activeLatencyText = '预算 100 ms';
    this.schedulerText = '正在运行图片检索交互原型（尚未接入真实相机帧）...';

    if (this.schedulerService.isInitialized()) {
      const request: TaskRequest<string> = {
        taskType: TaskType.FOREGROUND_REALTIME,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: 'image_crop_detection',
        input: 'crop-analyze',
        accuracyPreference: AccuracyPreference.QUALITY_FIRST,
        latencyBudgetMs: 100,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 2000
      };
      try {
        const cropRes: TaskResult<string> = await this.schedulerService.runTask<string, string>(
          request,
          async (input: string, _plan: ExecutionPlan) => input
        );
        this.schedulerText = `图片交互原型完成，${this.formatSchedulerResult(cropRes)}`;
        this.schedulerPlanText = this.formatPlanBadge(cropRes.executionPlan);
        this.routeText = this.formatRouteText(cropRes.executionPlan);
      } catch (err) {
        hilog.error(0x0000, 'IndexPage', `Image crop task failed: ${JSON.stringify(err)}`);
      }
    }

    await this.performSearch('运动鞋', '我上传了一张图片，帮我找同款或相似商品。');
  }

  private async triggerBackgroundIndexTask(): Promise<void> {
    if (!this.schedulerService.isInitialized()) {
      return;
    }
    this.activeCapabilityLabel = '离线向量索引预热更新';
    this.activeCapabilityName = 'background_index_update';
    this.activeTaskType = 'BACKGROUND_BATCH';
    this.activePriorityText = 'LOW (低优先)';
    const request: TaskRequest<string> = {
      taskType: TaskType.BACKGROUND_BATCH,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      capability: 'background_index_update',
      input: 'index-update',
      accuracyPreference: AccuracyPreference.SPEED_FIRST,
      latencyBudgetMs: 2000,
      allowDegrade: true,
      allowPause: true,
      timeoutMs: 5000
    };

    try {
      const indexRes: TaskResult<string> = await this.schedulerService.runTask<string, string>(
        request,
        async (_input: string, plan: ExecutionPlan): Promise<string> => {
          if (plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
            throw new Error('Background index update received a remote execution plan.');
          }
          const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
          const rebuiltCount: number = await NeuralEmbeddingIndex.getInstance()
            .rebuildNormalizationCache(256, localPlan.threadCount);
          return `normalized:${rebuiltCount}`;
        }
      );
      this.schedulerText = `后台任务完成：${this.formatSchedulerResult(indexRes)}`;
      this.schedulerPlanText = this.formatPlanBadge(indexRes.executionPlan);
      this.routeText = this.formatRouteText(indexRes.executionPlan);
    } catch (err) {
      hilog.error(0x0000, 'IndexPage', `Background index task failed: ${JSON.stringify(err)}`);
    }
  }

  private async performSearch(keyword: string, prompt: string): Promise<void> {
    if (this.isLoading) {
      return;
    }

    const isPhotoSearch: boolean = this.activeCapabilityName === 'image_crop_detection';
    const localKeyword: string = this.normalizeLocalSearchKeyword(keyword);
    const unsupportedLocalCategory: boolean = this.isUnsupportedLocalCategory(keyword);
    this.queryText = '';
    this.userPrompt = prompt;
    this.viewMode = SoleAiViewMode.CHAT;
    this.isLoading = true;
    this.assistantText = '正在识别图片并检索候选商品。';
    if (!isPhotoSearch) {
      this.schedulerText = localKeyword === keyword.trim() ? '正在请求模型检索接口' : `本地预解析为：${localKeyword}`;
      this.schedulerPlanText = '排队中';
    }

    try {
      this.products = await this.runScheduledProductSearch(keyword);
      if (unsupportedLocalCategory) {
        this.products = [];
        this.assistantText = '当前离线商品库以鞋类为主，暂不支持电脑品类，未返回不相关商品，也未发送到云端。';
        this.schedulerText = '本地品类覆盖检查：UNSUPPORTED_CATEGORY';
        this.schedulerPlanText = '端侧数据校验';
        this.routeText = '端侧意图解析 → 品类覆盖检查 → 停止';
        return;
      }

      if (this.schedulerService.isInitialized() && prompt.length > 0) {
        const privacyAssessment: PrivacyAssessment = PrivacyGuard.assessText(prompt);
        if (privacyAssessment.context.residencyPolicy === DataResidencyPolicy.LOCAL_ONLY) {
          this.assistantText = `隐私保护已启用：${privacyAssessment.context.reason}。本次请求仅在端侧处理，未发送到云端。`;
          this.schedulerText = '隐私策略：LOCAL_ONLY · 云端请求已阻断';
          this.schedulerPlanText = '端侧隐私保护';
          this.routeText = '端侧检索 → 隐私门控 → 禁止上云';
        } else {
        const chatRequest: TaskRequest<string> = {
          taskType: TaskType.USER_INITIATED,
          inferenceLocation: InferenceLocation.REMOTE_CLOUD,
          capability: 'chat_intent_reasoning',
          input: prompt,
          accuracyPreference: AccuracyPreference.QUALITY_FIRST,
          latencyBudgetMs: 15000,
          allowDegrade: true,
          allowPause: false,
          timeoutMs: 15000,
          privacyContext: privacyAssessment.context,
          remoteOptions: {
            provider: 'cloud_proxy',
            maxRetries: 1,
            maxConcurrency: 2,
            allowLocalFallback: true
          }
        };
        const chatRes = await this.schedulerService.runTask<string, ChatIntentResult>(
          chatRequest,
          async (inputPrompt: string, plan: ExecutionPlan) => {
            return ModelEngineRegistry.getInstance().getRemoteProvider().resolveChatIntentAndAnswer(inputPrompt, plan);
          }
        );
        if (chatRes.output !== null) {
          const chatResult: ChatIntentResult = chatRes.output;
          if (chatResult.actualInferenceLocation === InferenceLocation.LOCAL_DEVICE) {
            this.schedulerText = `云端计划未完成：${chatResult.fallbackReason}`;
            this.schedulerPlanText = '实际执行：端侧规则回退';
            this.routeText = '端侧检索 → 云端代理失败 → 端侧回答';
          } else {
            this.schedulerText = '端云协同 RAG 已完成';
            this.schedulerPlanText = '实际执行：云端答案生成';
            this.routeText = '端侧向量检索 → 隐私门控 → 云端生成';
          }
          // Update the assistant reply text
          if (chatResult.generatedAnswer.length > 0) {
            this.assistantText = chatResult.generatedAnswer;
          }
          // If the AI found relevant products, replace the product list with AI-ranked results
          if (chatResult.topProducts.length > 0) {
            this.products = chatResult.topProducts;
          }
        }
        }
      }
    } catch (error) {
      this.products = [];
      this.assistantText = '搜索失败，请稍后重试。';
      this.schedulerText = '调度任务失败';
      hilog.error(0x0000, 'IndexPage', `Product search failed: ${JSON.stringify(error)}`);
    } finally {
      this.isLoading = false;
    }
  }

  private async runScheduledProductSearch(keyword: string): Promise<Product[]> {
    await DataInitService.waitUntilReady();
    const modelResult: ModelSearchResult = await this.modelSearchService.resolveTextQuery(keyword, PAGE_SIZE);
    const localKeyword: string = modelResult.normalizedKeyword.length > 0 ?
      modelResult.normalizedKeyword :
      this.normalizeLocalSearchKeyword(keyword);
    this.lastResolvedKeyword = localKeyword;
    this.lastModelSearchSource = modelResult.source;
    const sourceLabel: string = modelResult.source === 'model' ? '模型接口' : '本地规则';

    if (!this.schedulerService.isInitialized()) {
      this.schedulerText = `调度层尚未初始化，本次使用${sourceLabel}后直连本地搜索`;
      this.schedulerPlanText = '直连数据库';
      return StoreManager.getInstance().searchProducts(localKeyword, PAGE_SIZE, 0);
    }

    const isPhotoSearch: boolean = this.activeCapabilityName === 'image_crop_detection';
    if (!isPhotoSearch) {
      this.activeCapabilityLabel = '文字关键词比价搜索';
      this.activeCapabilityName = 'local_product_search';
      this.activeTaskType = 'USER_INITIATED';
      this.activePriorityText = 'HIGH (高优先)';
      this.activeLatencyText = '预算 250 ms';
    }

    const input: ProductSearchInput = {
      keyword: localKeyword,
      limit: PAGE_SIZE,
      offset: 0
    };
    const request: ProductSearchRequest = {
      taskType: TaskType.USER_INITIATED,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      capability: 'local_product_search',
      input: input,
      accuracyPreference: AccuracyPreference.SPEED_FIRST,
      latencyBudgetMs: 120,
      allowDegrade: true,
      allowPause: false,
      timeoutMs: 3000
    };

    const result: TaskResult<Product[]> = await this.schedulerService.runTask<ProductSearchInput, Product[]>(
      request,
      async (input: ProductSearchInput, plan: ExecutionPlan): Promise<Product[]> => {
        if (plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
          throw new Error('Local product search received a remote execution plan.');
        }
        const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
        hilog.info(
          0x0000,
          'IndexPage',
          `Scheduler plan for search: tier=${localPlan.modelTier}, threads=${localPlan.threadCount}, backend=${localPlan.backend}`
        );
        const rawProducts: Product[] = await StoreManager.getInstance().searchProducts(input.keyword, input.limit, input.offset);
        const aiResult: AiInferenceResult = await ModelEngineRegistry.getInstance().getLocalVectorProvider().runVectorInference(input.keyword, rawProducts, localPlan);
        return aiResult.topProducts;
      }
    );

    if (!isPhotoSearch) {
      this.schedulerText = this.formatSchedulerResult(result);
      this.schedulerText = `${this.schedulerText}，${sourceLabel}：${localKeyword}`;
      this.schedulerPlanText = this.formatPlanBadge(result.executionPlan);
      this.routeText = this.formatRouteText(result.executionPlan);
    }

    if (result.status !== TaskStatus.SUCCEEDED || result.output === null) {
      return [];
    }
    return result.output;
  }

  private normalizeLocalSearchKeyword(keyword: string): string {
    const rawKeyword: string = keyword.trim();
    const lowerKeyword: string = rawKeyword.toLowerCase();
    if (lowerKeyword.indexOf('电脑') >= 0 || lowerKeyword.indexOf('笔记本') >= 0 ||
      lowerKeyword.indexOf('laptop') >= 0 || lowerKeyword.indexOf('computer') >= 0) {
      return '电脑';
    }
    if (lowerKeyword.indexOf('耐克') >= 0 || lowerKeyword.indexOf('nike') >= 0) {
      return '耐克';
    }
    if (lowerKeyword.indexOf('通勤') >= 0 && (lowerKeyword.indexOf('男') >= 0 || lowerKeyword.indexOf('鞋') >= 0)) {
      return '男鞋';
    }
    if (lowerKeyword.indexOf('运动') >= 0 || lowerKeyword.indexOf('跑步') >= 0) {
      return '运动鞋';
    }
    if (lowerKeyword.indexOf('鞋') >= 0) {
      return '鞋';
    }
    return rawKeyword;
  }

  private isUnsupportedLocalCategory(keyword: string): boolean {
    const lowerKeyword: string = keyword.toLowerCase();
    return lowerKeyword.indexOf('电脑') >= 0 || lowerKeyword.indexOf('笔记本') >= 0 ||
      lowerKeyword.indexOf('laptop') >= 0 || lowerKeyword.indexOf('computer') >= 0;
  }

  private openSchedulerPanel(): void {
    router.pushUrl({ url: 'pages/SchedulerPanelPage' }).catch((error: Error) => {
      hilog.error(0x0000, 'IndexPage', `Open scheduler panel failed: ${error.message}`);
    });
  }

  private toggleSchedulerFloatPanel(): void {
    this.showSchedulerFloatPanel = !this.showSchedulerFloatPanel;
  }

  private closeSchedulerFloatPanel(): void {
    this.showSchedulerFloatPanel = false;
  }

  private beginSchedulerFloatDrag(): void {
    this.schedulerFloatStartLeftPercent = this.schedulerFloatLeftPercent;
    this.schedulerFloatStartTopPercent = this.schedulerFloatTopPercent;
    this.schedulerFloatMoved = false;
  }

  private updateSchedulerFloatDrag(offsetX: number, offsetY: number): void {
    if (Math.abs(offsetX) > 2 || Math.abs(offsetY) > 2) {
      this.schedulerFloatMoved = true;
    }
    this.schedulerFloatLeftPercent = this.clampPercent(this.schedulerFloatStartLeftPercent + offsetX / 3.8, 3, 72);
    this.schedulerFloatTopPercent = this.clampPercent(this.schedulerFloatStartTopPercent + offsetY / 8.2, 12, 82);
  }

  private endSchedulerFloatDrag(): void {
    this.schedulerFloatStartLeftPercent = this.schedulerFloatLeftPercent;
    this.schedulerFloatStartTopPercent = this.schedulerFloatTopPercent;
  }

  private clampPercent(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private openDrawer(): void {
    this.showDrawer = true;
  }

  private closeDrawer(): void {
    this.showDrawer = false;
  }

  private openProfile(): void {
    this.showDrawer = false;
    this.showProfile = true;
  }

  private closeProfile(): void {
    this.showProfile = false;
  }

  private formatSchedulerResult<T>(result: TaskResult<T>): string {
    return `调度：${this.formatPlanBadge(result.executionPlan)} / ${result.executionPlan.queueAction}，耗时 ${result.totalDurationMs} ms`;
  }

  private formatPlanBadge(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      const remotePlan: RemoteExecutionPlan = plan as RemoteExecutionPlan;
      return `云端 · ${remotePlan.provider} · 超时${remotePlan.timeoutMs}ms`;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return `端侧 · ${localPlan.backend} · ${localPlan.threadCount}线程 · ${localPlan.modelTier}`;
  }

  private formatRouteText(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return '云端答案生成链路';
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    if (localPlan.backend === Backend.NPU ||
      localPlan.backend === Backend.GPU ||
      localPlan.backend === Backend.NNRT) {
      return '端侧硬件加速链路';
    }
    return '端侧 CPU 多线程链路';
  }

  private getPriceText(product: Product): string {
    if (product.currency === 'CNY') {
      return `¥${product.price}`;
    }
    return `${product.currency} ${product.price}`;
  }

  @Builder
  private HeaderBar() {
    Row() {
      Button('☰')
        .width(64)
        .height(64)
        .fontSize(30)
        .fontColor('#111111')
        .backgroundColor('#FFFFFF')
        .borderRadius(32)
        .onClick(() => {
          this.openDrawer();
        })

      Column({ space: 2 }) {
        Text('SoleAI')
          .fontSize(32)
          .fontWeight(FontWeight.Bold)
          .fontColor('#111111')
          .maxLines(1)
        if (this.viewMode === SoleAiViewMode.CHAT || this.isLoading) {
          Text(this.isLoading ? '正在处理您的需求' : '购物对话')
            .fontSize(16)
            .fontColor('#777777')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ left: 18 })

      Row({ space: 8 }) {
        Text(this.isLoading ? '●' : '●')
          .fontSize(16)
          .fontColor(this.isLoading ? '#D6A117' : '#55C7A1')
        Text(this.isLoading ? '处理中' : '在线')
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor('#555555')
      }
      .height(46)
      .padding({ left: 18, right: 18 })
      .margin({ left: 12 })
      .backgroundColor('#FFFFFF')
      .border({ width: 1, color: '#E4E4E4' })
      .borderRadius(23)
    }
    .width('100%')
    .padding({ left: 24, right: 24, top: 42, bottom: 24 })
    .backgroundColor('#FFFFFF')
  }

  @Builder
  private HomeContent() {
    Column() {
      this.HeaderBar()

      Scroll() {
        Column({ space: 20 }) {
          Column({ space: 18 }) {
            Text('▧')
              .fontSize(54)
              .fontColor('#767676')
            Text('今天想找什么？')
              .fontSize(36)
              .fontWeight(FontWeight.Bold)
              .fontColor('#111111')
            Text('拍照找同款，或直接说出预算、品牌、场景')
              .fontSize(20)
              .fontColor('#777777')
              .textAlign(TextAlign.Center)
          }
          .width('100%')
          .margin({ top: 42, bottom: 10 })

          ForEach(this.quickIntents, (intent: QuickIntent) => {
            Button() {
              Text(intent.title)
                .fontSize(24)
                .fontWeight(FontWeight.Bold)
                .fontColor('#222222')
                .textAlign(TextAlign.Center)
              .width('100%')
            }
            .height(74)
            .width('100%')
            .backgroundColor('#FFFFFF')
            .border({ width: 1, color: '#E3E3E3' })
            .borderRadius(37)
            .onClick(() => {
              this.startQuickIntent(intent);
            })
          }, (intent: QuickIntent) => intent.title)
        }
        .width('100%')
        .padding({ left: 30, right: 30, bottom: 18 })
      }
      .layoutWeight(1)
      .width('100%')

      Column() {
        this.BottomComposer()
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
      .padding({ bottom: 22 })
    }
    .height('100%')
    .width('100%')
    .backgroundColor('#F8F8F6')
  }

  @Builder
  private ChatContent() {
    Column() {
      this.HeaderBar()

      Scroll() {
        Column({ space: 26 }) {
          Row() {
            Blank()
            Text(this.userPrompt)
              .fontSize(22)
              .fontColor('#111111')
              .lineHeight(34)
              .padding({ left: 24, right: 24, top: 20, bottom: 20 })
              .backgroundColor('#F0F0ED')
              .border({ width: 1, color: '#E2E2DE' })
              .borderRadius(22)
              .width('78%')
          }
          .width('100%')

          Row({ space: 18 }) {
            Text('S')
              .width(54)
              .height(54)
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Center)
              .backgroundColor('#111111')
              .borderRadius(27)
            Text(this.isLoading ? '正在识别图片并检索候选商品。' : this.assistantText)
              .fontSize(24)
              .fontColor('#111111')
              .lineHeight(34)
              .layoutWeight(1)
          }
          .alignItems(VerticalAlign.Center)
          .width('100%')

          if (this.isLoading) {
            Row({ space: 18 }) {
              Text('S')
                .width(54)
                .height(54)
                .fontSize(24)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
                .textAlign(TextAlign.Center)
                .backgroundColor('#111111')
                .borderRadius(27)
              Text('·    正在整理结果')
                .fontSize(24)
                .fontColor('#777777')
                .layoutWeight(1)
            }
            .width('100%')
          }

          if (!this.isLoading && this.products.length > 0) {
            Grid() {
              ForEach(this.products.slice(0, 6), (item: Product) => {
                GridItem() {
                  this.ProductCard(item)
                }
              }, (item: Product) => item.externalId)
            }
            .columnsTemplate('1fr 1fr')
            .columnsGap(14)
            .rowsGap(14)
            .width('100%')
          }
        }
        .width('100%')
        .padding({ left: 26, right: 26, top: 34, bottom: 24 })
      }
      .layoutWeight(1)
      .width('100%')

      Column() {
        this.BottomComposer()
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
      .padding({ bottom: 22 })
    }
    .height('100%')
    .width('100%')
    .backgroundColor('#FFFFFF')
  }

  @Builder
  private SchedulerFloatIcon() {
    Stack() {
      Text('')
        .width(2)
        .height(34)
        .backgroundColor('#5F6468')
        .borderRadius(2)

      Text('')
        .width(12)
        .height(12)
        .backgroundColor('#5F6468')
        .borderRadius(6)

      Text('')
        .width(13)
        .height(2)
        .backgroundColor('#5F6468')
        .borderRadius(2)
        .translate({ x: -12, y: -12 })
        .rotate({ angle: -42 })
      Text('')
        .width(13)
        .height(2)
        .backgroundColor('#5F6468')
        .borderRadius(2)
        .translate({ x: 12, y: -12 })
        .rotate({ angle: 42 })
      Text('')
        .width(13)
        .height(2)
        .backgroundColor('#5F6468')
        .borderRadius(2)
        .translate({ x: -12, y: 12 })
        .rotate({ angle: 42 })
      Text('')
        .width(13)
        .height(2)
        .backgroundColor('#5F6468')
        .borderRadius(2)
        .translate({ x: 12, y: 12 })
        .rotate({ angle: -42 })

      Text('')
        .width(8)
        .height(8)
        .backgroundColor('#FFFFFF')
        .border({ width: 2, color: '#5F6468' })
        .borderRadius(4)
        .translate({ x: -20, y: -18 })
      Text('')
        .width(8)
        .height(8)
        .backgroundColor('#FFFFFF')
        .border({ width: 2, color: '#5F6468' })
        .borderRadius(4)
        .translate({ x: 20, y: -18 })
      Text('')
        .width(8)
        .height(8)
        .backgroundColor('#FFFFFF')
        .border({ width: 2, color: '#5F6468' })
        .borderRadius(4)
        .translate({ x: -20, y: 18 })
      Text('')
        .width(8)
        .height(8)
        .backgroundColor('#FFFFFF')
        .border({ width: 2, color: '#5F6468' })
        .borderRadius(4)
        .translate({ x: 20, y: 18 })
    }
    .width(46)
    .height(44)
  }

  @Builder
  private SchedulerFloatingButton() {
    Stack() {
      Button() {
        Row({ space: 8 }) {
          this.SchedulerFloatIcon()
          Text('系统智能调度')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor('#111111')
            .maxLines(1)
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
      }
      .width(214)
      .height(54)
      .padding({ left: 12, right: 16 })
      .backgroundColor('#F8F8F8')
      .border({ width: 1, color: '#E4E4E4' })
      .borderRadius(27)
      .shadow({ radius: 14, color: '#20000000', offsetY: 6 })
      .onClick(() => {
        this.toggleSchedulerFloatPanel();
      })
    }
    .width(214)
    .height(54)
    .position({
      x: `${this.schedulerFloatLeftPercent}%`,
      y: `${this.schedulerFloatTopPercent}%`
    })
    .gesture(
      PanGesture()
        .onActionStart(() => {
          this.beginSchedulerFloatDrag();
        })
        .onActionUpdate((event: GestureEvent) => {
          this.updateSchedulerFloatDrag(event.offsetX, event.offsetY);
        })
        .onActionEnd(() => {
          this.endSchedulerFloatDrag();
        })
    )
    .zIndex(9999)
  }

  private formatTaskTypeName(type: string): string {
    if (type === 'FOREGROUND_REALTIME') {
      return '前台实时 (最高优先)';
    }
    if (type === 'USER_INITIATED') {
      return '用户触发 (高优先)';
    }
    return '后台批处理 (低优先)';
  }

  private formatTaskTypeColor(type: string): string {
    if (type === 'FOREGROUND_REALTIME') {
      return '#B54708';
    }
    if (type === 'USER_INITIATED') {
      return '#175CD3';
    }
    return '#067647';
  }

  private formatTaskTypeBg(type: string): string {
    if (type === 'FOREGROUND_REALTIME') {
      return '#FEF6EE';
    }
    if (type === 'USER_INITIATED') {
      return '#EFF8FF';
    }
    return '#ECFDF3';
  }

  @Builder
  private SchedulerDecisionPanel() {
    Stack() {
      Column({ space: 10 }) {
        // Header
        Row({ space: 8 }) {
          Text('🟢 系统全自动感知调度')
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor('#172B4D')
            .layoutWeight(1)

          Button('×')
            .width(32)
            .height(32)
            .fontSize(20)
            .fontColor('#555555')
            .backgroundColor('#F1F1F1')
            .borderRadius(16)
            .onClick(() => {
              this.closeSchedulerFloatPanel();
            })
        }
        .width('100%')

        // Real-time Capability & Priority Card
        Row({ space: 8 }) {
          Text(this.activeCapabilityLabel)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#172B4D')
            .layoutWeight(1)

          Text(this.formatTaskTypeName(this.activeTaskType))
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.formatTaskTypeColor(this.activeTaskType))
            .backgroundColor(this.formatTaskTypeBg(this.activeTaskType))
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)

        // Hardware Execution Link (Concise, labels removed)
        Row({ space: 8 }) {
          Text(this.routeText)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor('#175CD3')

          Text(`· ${this.schedulerPlanText}`)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor('#344054')
            .layoutWeight(1)

          Text(this.activeLatencyText)
            .fontSize(10)
            .fontColor('#667085')
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#EEF4FF')
        .borderRadius(8)

        // Real-time Sensor Status
        Row({ space: 6 }) {
          Text('SOC 85%')
            .fontSize(10)
            .fontColor('#067647')
            .backgroundColor('#ECFDF3')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)

          Text('温度: 正常')
            .fontSize(10)
            .fontColor('#175CD3')
            .backgroundColor('#EFF8FF')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)

          Text('前台')
            .fontSize(10)
            .fontColor('#344054')
            .backgroundColor('#F2F4F7')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
        }
        .width('100%')

        // Interactive Feature Triggers for Auto Mode Testing
        Row({ space: 6 }) {
          Button('测试【拍照识别】')
            .layoutWeight(1)
            .height(30)
            .fontSize(10)
            .fontColor('#B54708')
            .backgroundColor('#FEF6EE')
            .onClick(() => {
              this.captureAndSearch();
            })

          Button('测试【文字比价】')
            .layoutWeight(1)
            .height(30)
            .fontSize(10)
            .fontColor('#175CD3')
            .backgroundColor('#EFF8FF')
            .onClick(() => {
              this.performSearch('男鞋', '帮我找男鞋');
            })

          Button('测试【后台批处理】')
            .layoutWeight(1)
            .height(30)
            .fontSize(10)
            .fontColor('#067647')
            .backgroundColor('#ECFDF3')
            .onClick(() => {
              this.triggerBackgroundIndexTask();
            })
        }
        .width('100%')

        // Live Log Stream
        if (this.latestLogs.length > 0) {
          Column({ space: 4 }) {
            ForEach(this.latestLogs, (entry: SchedulerLogEntry) => {
              Row({ space: 6 }) {
                Text(entry.status)
                  .fontSize(9)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(entry.status === TaskStatus.SUCCEEDED ? '#067647' : '#B42318')
                Text(entry.capability)
                  .fontSize(10)
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#172B4D')
                  .layoutWeight(1)
                Text(this.formatPlanBadge(entry.executionPlan))
                  .fontSize(9)
                  .fontColor('#667085')
              }
              .width('100%')
              .padding(5)
              .backgroundColor('#F8FAFC')
              .borderRadius(6)
            })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        }

        Button('打开高级调度实验控制台')
          .height(36)
          .width('100%')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .backgroundColor('#175CD3')
          .borderRadius(18)
          .onClick(() => {
            this.openSchedulerPanel();
          })
      }
      .width('88%')
      .padding(14)
      .backgroundColor(Color.White)
      .border({ width: 1, color: '#D0D5DD' })
      .borderRadius(16)
      .shadow({ radius: 20, color: '#33000000', offsetY: 6 })
    }
    .position({
      x: `${this.schedulerFloatLeftPercent}%`,
      y: `${this.schedulerFloatTopPercent}%`
    })
    .gesture(
      PanGesture()
        .onActionStart(() => {
          this.beginSchedulerFloatDrag();
        })
        .onActionUpdate((event: GestureEvent) => {
          this.updateSchedulerFloatDrag(event.offsetX, event.offsetY);
        })
        .onActionEnd(() => {
          this.endSchedulerFloatDrag();
        })
    )
  }

  @Builder
  private SchedulerDecisionRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor('#777777')
      Blank()
      Text(value)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor('#111111')
        .maxLines(2)
        .textAlign(TextAlign.End)
        .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .backgroundColor('#F8F8F6')
    .borderRadius(14)
  }

  private openProductDetail(product: Product): void {
    this.selectedProduct = product;
    this.showProductDetailModal = true;

    if (this.schedulerService.isInitialized()) {
      this.activeCapabilityLabel = '商品端侧AI特征与价格深度对比';
      this.activeCapabilityName = 'category_rerank_sort';
      this.activeTaskType = 'USER_INITIATED';
      this.activePriorityText = 'HIGH (高优先)';
      this.activeLatencyText = '预算 150 ms';

      const request: TaskRequest<string> = {
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: 'category_rerank_sort',
        input: product.externalId,
        accuracyPreference: AccuracyPreference.SPEED_FIRST,
        latencyBudgetMs: 150,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 2000
      };
      this.schedulerService.runTask<string, string>(
        request,
        async (input: string, _plan: ExecutionPlan) => input
      ).then((res: TaskResult<string>) => {
        this.schedulerPlanText = this.formatPlanBadge(res.executionPlan);
        this.routeText = this.formatRouteText(res.executionPlan);
      }).catch(() => {});
    }
  }

  private closeProductDetail(): void {
    this.showProductDetailModal = false;
    this.selectedProduct = null;
  }

  private getPlatformName(platform: string): string {
    if (platform === 'tb') {
      return '淘宝';
    }
    if (platform === 'jd') {
      return '京东';
    }
    if (platform === 'pdd') {
      return '拼多多';
    }
    if (platform === 'vip') {
      return '唯品会';
    }
    return platform.toUpperCase();
  }

  private getPlatformBgColor(platform: string): string {
    if (platform === 'tb') {
      return '#FFF2E8';
    }
    if (platform === 'jd') {
      return '#FEF0F0';
    }
    if (platform === 'pdd') {
      return '#F6FFED';
    }
    return '#F0F5FF';
  }

  private getPlatformTextColor(platform: string): string {
    if (platform === 'tb') {
      return '#FA541C';
    }
    if (platform === 'jd') {
      return '#F5222D';
    }
    if (platform === 'pdd') {
      return '#52C41A';
    }
    return '#2F54EB';
  }

  @Builder
  private ProductCard(item: Product) {
    Column({ space: 10 }) {
      Stack() {
        Text('✦')
          .width(54)
          .height(54)
          .fontSize(24)
          .fontColor('#FFFFFF')
          .textAlign(TextAlign.Center)
          .backgroundColor('#111111')
          .borderRadius(27)
      }
      .width('100%')
      .height(130)
      .backgroundColor('#FAFAFA')
      .border({ width: 1, color: '#E8E8E8' })
      .borderRadius(20)

      Text(item.title)
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor('#111111')
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')

      Row() {
        Text(this.getPriceText(item))
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor('#B54708')

        Blank()

        Text(this.getPlatformName(item.platform))
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.getPlatformTextColor(item.platform))
          .backgroundColor(this.getPlatformBgColor(item.platform))
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(4)
      }
      .width('100%')

      Text('点击查看详情 >')
        .fontSize(10)
        .fontColor('#175CD3')
        .width('100%')
    }
    .padding(12)
    .backgroundColor('#FFFFFF')
    .border({ width: 1, color: '#EAECF0' })
    .borderRadius(18)
    .shadow({ radius: 8, color: '#10000000', offsetY: 2 })
    .onClick(() => {
      this.openProductDetail(item);
    })
  }

  @Builder
  private ProductDetailSheet() {
    if (this.selectedProduct !== null) {
      Stack() {
        // Modal Overlay Backdrop
        Column()
          .height('100%')
          .width('100%')
          .backgroundColor('#66000000')
          .onClick(() => {
            this.closeProductDetail();
          })

        // Bottom Sheet Card
        Column({ space: 14 }) {
          // Header
          Row() {
            Text('🛍️ 端侧 AI 深度商品详情')
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
              .layoutWeight(1)

            Button('×')
              .width(36)
              .height(36)
              .fontSize(22)
              .fontColor('#555555')
              .backgroundColor('#F1F1F1')
              .borderRadius(18)
              .onClick(() => {
                this.closeProductDetail();
              })
          }
          .width('100%')

          // Product Banner Card
          Column({ space: 8 }) {
            Row({ space: 8 }) {
              Text(this.getPlatformName(this.selectedProduct.platform))
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.getPlatformTextColor(this.selectedProduct.platform))
                .backgroundColor(this.getPlatformBgColor(this.selectedProduct.platform))
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .borderRadius(6)

              Text(this.selectedProduct.shopName.length > 0 ? this.selectedProduct.shopName : '官方直营店')
                .fontSize(12)
                .fontColor('#475467')
                .layoutWeight(1)

              Text('现货速发')
                .fontSize(11)
                .fontColor('#067647')
                .backgroundColor('#ECFDF3')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(4)
            }
            .width('100%')

            Text(this.selectedProduct.title)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
              .lineHeight(22)
              .width('100%')

            Row({ space: 10 }) {
              Text(this.getPriceText(this.selectedProduct))
                .fontSize(26)
                .fontWeight(FontWeight.Bold)
                .fontColor('#B54708')

              Text('券后全网最低')
                .fontSize(11)
                .fontColor('#B54708')
                .backgroundColor('#FEF6EE')
                .padding({ left: 6, right: 6, top: 3, bottom: 3 })
                .borderRadius(4)

              Blank()

              Text('销量 10000+')
                .fontSize(11)
                .fontColor('#667085')
            }
            .width('100%')
          }
          .width('100%')
          .padding(14)
          .backgroundColor('#F8FAFC')
          .borderRadius(14)

          // AI Smart Analysis Card
          Column({ space: 6 }) {
            Text('🤖 端侧 AI 智能匹配分析')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#175CD3')

            Row({ space: 6 }) {
              Text('外观与意图匹配 98.5%')
                .fontSize(11)
                .fontColor('#175CD3')
                .backgroundColor('#EFF8FF')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(4)

              Text('历史低价')
                .fontSize(11)
                .fontColor('#067647')
                .backgroundColor('#ECFDF3')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(4)

              Text('已过安检风险')
                .fontSize(11)
                .fontColor('#344054')
                .backgroundColor('#F2F4F7')
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(4)
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(10)
          .backgroundColor('#EEF4FF')
          .borderRadius(10)

          // Multi-Platform Price Comparison List
          Column({ space: 6 }) {
            Text('📊 全网实时比价信息')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#344054')

            Row() {
              Text('淘宝平台')
                .fontSize(12)
                .fontColor('#475467')
              Blank()
              Text(this.getPriceText(this.selectedProduct))
                .fontSize(13)
                .fontWeight(FontWeight.Bold)
                .fontColor('#B54708')
            }
            .width('100%')
            .padding({ left: 8, right: 8, top: 6, bottom: 6 })

            Row() {
              Text('京东平台 (自营限时)')
                .fontSize(12)
                .fontColor('#475467')
              Blank()
              Text(`¥${(Number(this.selectedProduct.price) * 1.04).toFixed(0)}`)
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor('#344054')
            }
            .width('100%')
            .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(10)
          .backgroundColor('#F8FAFC')
          .borderRadius(10)

          // Action Buttons
          Row({ space: 10 }) {
            Button(`前往【${this.getPlatformName(this.selectedProduct.platform)}】查看`)
              .layoutWeight(1)
              .height(44)
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
              .backgroundColor('#175CD3')
              .borderRadius(22)
              .onClick(() => {
                try {
                  promptAction.showToast({
                    message: `正在打开 ${this.getPlatformName(this.selectedProduct!.platform)}：${this.selectedProduct!.title}`,
                    duration: 2500
                  });
                } catch (e) {}
              })

            Button('AI 降价监控')
              .height(44)
              .padding({ left: 16, right: 16 })
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#067647')
              .backgroundColor('#ECFDF3')
              .borderRadius(22)
              .onClick(() => {
                try {
                  promptAction.showToast({
                    message: `已为此商品开启端侧 AI 价格波动与降载监控！`,
                    duration: 2500
                  });
                } catch (e) {}
              })
          }
          .width('100%')
        }
        .width('100%')
        .padding(20)
        .backgroundColor(Color.White)
        .borderRadius({ topLeft: 24, topRight: 24 })
        .shadow({ radius: 24, color: '#44000000', offsetY: -6 })
        .position({ x: '6%', y: '12%' })
        .zIndex(10000)
      }
      .width('100%')
      .height('100%')
    }
  }

  @Builder
  private LensContent() {
    Stack() {
      // Dark Camera Lens Background Overlay
      Column() {
        // Camera Header Bar
        Row() {
          Button('×')
            .width(44)
            .height(44)
            .fontSize(28)
            .fontColor('#FFFFFF')
            .backgroundColor('#33000000')
            .borderRadius(22)
            .onClick(() => {
              this.closeLens();
            })

          Blank()

          Row({ space: 8 }) {
            Text('✦')
              .fontSize(16)
              .fontColor('#FFD778')
            Text('图片检索交互原型（未接真实相机）')
              .fontSize(15)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor('#2B303B')
          .borderRadius(20)

          Blank()

          Button('⚡')
            .width(44)
            .height(44)
            .fontSize(18)
            .fontColor('#FFFFFF')
            .backgroundColor('#33000000')
            .borderRadius(22)
        }
        .width('100%')
        .padding({ left: 20, right: 20, top: 40 })

        Blank()

        // Camera Viewfinder Box with Object ROI Bounding Box
        Stack() {
          // Bounding Box Reticle Frame
          Column() {
            Row() {
              Text('🎯 演示分类：鞋类/运动鞋（固定样例 ROI）')
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
                .backgroundColor('#175CD3')
                .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                .borderRadius(6)
              Blank()
              Text('演示数据')
                .fontSize(11)
                .fontColor('#55C7A1')
                .fontWeight(FontWeight.Bold)
            }
            .width('100%')

            Blank()

            Row() {
              Text('点击框选物体范围 >')
                .fontSize(11)
                .fontColor('#FFD778')
              Blank()
              Text('未接入图像模型')
                .fontSize(10)
                .fontColor('#D6D8DF')
            }
            .width('100%')
          }
          .width('82%')
          .height(320)
          .padding(14)
          .border({ width: 3, color: '#FFD778' })
          .borderRadius(20)
          .backgroundColor('#FFFFFF15')
        }
        .width('100%')
        .height(340)

        Blank()

        // Shutter Button & Album Bar
        Column({ space: 16 }) {
          // Shutter Button
          Button() {
            Column() {
              Text('📷')
                .fontSize(28)
              Text('演示拍照流程')
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
          }
          .width(130)
          .height(130)
          .backgroundColor('#175CD3')
          .border({ width: 8, color: '#FFFFFF' })
          .borderRadius(65)
          .shadow({ radius: 12, color: '#44000000', offsetY: 4 })
          .onClick(() => {
            this.captureAndSearch();
          })

          // Album Upload Button
          Row({ space: 10 }) {
            Text('🖼️')
              .fontSize(18)
            Text('相册接入待完成')
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor('#FFFFFF')
          }
          .height(44)
          .padding({ left: 20, right: 20 })
          .backgroundColor('#242A36')
          .borderRadius(22)
          .onClick(() => {
            this.captureAndSearch();
          })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ bottom: 36 })
      }
      .height('100%')
      .width('100%')
      .backgroundColor('#0D111B')
    }
    .height('100%')
    .width('100%')
  }

  @Builder
  private CroppingContent() {
    Stack() {
      // Dark Overlay Backdrop
      Column()
        .height('100%')
        .width('100%')
        .backgroundColor('#CC000000')

      Column({ space: 16 }) {
        // Header Bar
        Row() {
          Text('✂️ 物品截取与框选范围 (ROI Target Selection)')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .layoutWeight(1)

          Button('×')
            .width(36)
            .height(36)
            .fontSize(22)
            .fontColor('#FFFFFF')
            .backgroundColor('#33FFFFFF')
            .borderRadius(18)
            .onClick(() => {
              this.closeLens();
            })
        }
        .width('100%')

        Text('拖拽下方选框，精准框选图中需比价识别的商品主体：')
          .fontSize(12)
          .fontColor('#D6D8DF')
          .width('100%')

        // Interactive Object Crop Box
        Stack() {
          Column() {
            // Corner Reticles
            Row() {
              Text('┌')
                .fontSize(24)
                .fontColor('#FFD778')
              Blank()
              Text('┐')
                .fontSize(24)
                .fontColor('#FFD778')
            }
            .width('100%')

            Blank()

            Text('🎯 演示目标：运动鞋固定样例\n(ROI 尺寸: 240 × 240px)')
              .fontSize(13)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Center)
              .backgroundColor('#175CD3D0')
              .padding(10)
              .borderRadius(10)

            Blank()

            Row() {
              Text('└')
                .fontSize(24)
                .fontColor('#FFD778')
              Blank()
              Text('┘')
                .fontSize(24)
                .fontColor('#FFD778')
            }
            .width('100%')
          }
          .width('85%')
          .height(280)
          .padding(12)
          .border({ width: 3, color: '#FFD778' })
          .borderRadius(16)
          .backgroundColor('#FFFFFF10')
        }
        .width('100%')
        .height(300)

        // Action Buttons
        Row({ space: 12 }) {
          Button('重新拍摄')
            .layoutWeight(1)
            .height(44)
            .fontSize(14)
            .fontColor('#FFFFFF')
            .backgroundColor('#475467')
            .borderRadius(22)
            .onClick(() => {
              this.openLens();
            })

          Button('按演示关键词进行端侧检索')
            .layoutWeight(2)
            .height(44)
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .backgroundColor('#175CD3')
            .borderRadius(22)
            .onClick(() => {
              this.performSearch('运动鞋', '已框选目标主体区域 [ROI: 240x240]，正在进行端侧 AI 向量匹配与全网比价。');
            })
        }
        .width('100%')
      }
      .width('100%')
      .height('100%')
      .padding({ left: 24, right: 24, top: 48, bottom: 36 })
    }
    .height('100%')
    .width('100%')
  }

  @Builder
  private CameraGlyph() {
    Stack() {
      Text('')
        .width(30)
        .height(22)
        .border({ width: 3, color: '#333333' })
        .borderRadius(5)
        .margin({ top: 7 })

      Text('')
        .width(9)
        .height(9)
        .backgroundColor('#333333')
        .borderRadius(5)
        .margin({ top: 7 })

      Text('')
        .width(12)
        .height(5)
        .backgroundColor('#333333')
        .borderRadius(2)
        .align(Alignment.Top)
        .margin({ top: 4 })
    }
    .width(40)
    .height(38)
  }

  @Builder
  private BottomComposer() {
    Row({ space: 18 }) {
      Button() {
        this.CameraGlyph()
      }
        .width(52)
        .height(52)
        .backgroundColor('#00000000')
        .onClick(() => {
          this.openLens();
        })

      TextInput({ placeholder: '描述想找的商品', text: this.queryText })
        .layoutWeight(1)
        .height(58)
        .fontSize(21)
        .placeholderColor('#B8B8B8')
        .backgroundColor('#FFFFFF')
        .onChange((value: string) => {
          this.queryText = value;
        })
        .onSubmit(() => {
          this.submitFromInput();
        })

      Button('↑')
        .width(76)
        .height(76)
        .fontSize(34)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .backgroundColor('#111111')
        .borderRadius(38)
        .enabled(!this.isLoading && this.queryText.trim().length > 0)
        .onClick(() => {
          this.submitFromInput();
        })
    }
    .height(96)
    .width('89%')
    .padding({ left: 18, right: 12 })
    .backgroundColor('#FFFFFF')
    .border({ width: 1, color: '#E7E7E7' })
    .borderRadius(48)
    .shadow({ radius: 18, color: '#12000000', offsetY: 6 })
  }

  @Builder
  private DrawerOverlay() {
    Row() {
      Column() {
        Row() {
          Text('S')
            .width(68)
            .height(68)
            .fontSize(30)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .textAlign(TextAlign.Center)
            .backgroundColor('#111111')
            .borderRadius(34)
          Column({ space: 2 }) {
            Text('SoleAI')
              .fontSize(32)
              .fontWeight(FontWeight.Bold)
              .fontColor('#111111')
            Text('购物对话')
              .fontSize(17)
              .fontColor('#777777')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ left: 18 })
          Button('×')
            .width(62)
            .height(62)
            .fontSize(36)
            .fontColor('#555555')
            .backgroundColor('#FFFFFF')
            .borderRadius(31)
            .onClick(() => {
              this.closeDrawer();
            })
        }
        .width('100%')

        Button() {
          Row() {
            Text('+')
              .width(52)
              .height(52)
              .fontSize(36)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Center)
              .backgroundColor('#111111')
              .borderRadius(26)
            Text('开始新对话')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor('#111111')
              .margin({ left: 20 })
            Blank()
            Text('→')
              .fontSize(34)
              .fontColor('#999999')
          }
          .width('100%')
        }
        .height(86)
        .margin({ top: 40, bottom: 42 })
        .backgroundColor('#FFFFFF')
        .border({ width: 1, color: '#E5E5E5' })
        .borderRadius(22)
        .onClick(() => {
          this.viewMode = SoleAiViewMode.HOME;
          this.closeDrawer();
        })

        Text('最近对话')
          .fontSize(20)
          .fontWeight(FontWeight.Medium)
          .fontColor('#888888')
          .width('100%')
          .margin({ bottom: 18 })

        ForEach(this.histories, (item: HistoryItem) => {
          Row({ space: 18 }) {
            Text(item.active ? '□' : '↺')
              .width(56)
              .height(56)
              .fontSize(24)
              .fontColor(item.active ? '#FFFFFF' : '#777777')
              .textAlign(TextAlign.Center)
              .backgroundColor(item.active ? '#111111' : '#F1F1F1')
              .borderRadius(28)
            Column({ space: 4 }) {
              Text(item.title)
                .fontSize(20)
                .fontWeight(item.active ? FontWeight.Bold : FontWeight.Medium)
                .fontColor('#222222')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(item.meta)
                .fontSize(16)
                .fontColor('#999999')
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
          }
          .width('100%')
          .padding({ left: 14, right: 14, top: 14, bottom: 14 })
          .backgroundColor(item.active ? '#FFFFFF' : '#00000000')
          .borderRadius(20)
        }, (item: HistoryItem) => item.title + item.meta)

        Blank()

        Row() {
          Text('●')
            .width(62)
            .height(62)
            .fontSize(30)
            .fontColor('#FFFFFF')
            .textAlign(TextAlign.Center)
            .backgroundColor('#111111')
            .borderRadius(31)
          Column({ space: 2 }) {
            Text('User_8921')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor('#111111')
            Text('用户画像')
              .fontSize(16)
              .fontColor('#888888')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ left: 18 })
          Text('›')
            .fontSize(40)
            .fontColor('#999999')
        }
        .width('100%')
        .padding({ top: 18, bottom: 18 })
        .onClick(() => {
          this.openProfile();
        })
      }
      .height('100%')
      .width('86%')
      .padding({ left: 26, right: 26, top: 56, bottom: 24 })
      .backgroundColor('#FFFFFF')
      .borderRadius({ topRight: 36, bottomRight: 36 })

      Blank()
        .layoutWeight(1)
        .height('100%')
        .backgroundColor('#88000000')
        .onClick(() => {
          this.closeDrawer();
        })
    }
    .height('100%')
    .width('100%')
    .backgroundColor('#66000000')
  }

  @Builder
  private ProfileSheet() {
    Column() {
      Blank()
        .layoutWeight(1)
        .width('100%')
        .backgroundColor('#66000000')
        .onClick(() => {
          this.closeProfile();
        })

      Column({ space: 24 }) {
        Row() {
          Text('●')
            .width(70)
            .height(70)
            .fontSize(32)
            .fontColor('#FFFFFF')
            .textAlign(TextAlign.Center)
            .backgroundColor('#111111')
            .borderRadius(35)
          Column({ space: 2 }) {
            Text('用户画像')
              .fontSize(32)
              .fontWeight(FontWeight.Bold)
              .fontColor('#111111')
            Text('User_8921')
              .fontSize(18)
              .fontColor('#777777')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ left: 18 })
          Button('×')
            .width(62)
            .height(62)
            .fontSize(36)
            .fontColor('#444444')
            .backgroundColor('#FFFFFF')
            .borderRadius(31)
            .onClick(() => {
              this.closeProfile();
            })
          Button('✓ 保存')
            .height(62)
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .backgroundColor('#111111')
            .borderRadius(31)
            .margin({ left: 10 })
            .onClick(() => {
              this.closeProfile();
            })
        }
        .width('100%')

        this.ProfileSection('基础信息', '昵称', '谢路遥', '城市', '上海', '常穿鞋码', '42')
        this.ProfileSection('购物偏好', '偏好品牌', '耐克', '偏好风格', '运动鞋', '决策优先', '外观匹配')
      }
      .width('100%')
      .height('78%')
      .padding({ left: 26, right: 26, top: 34, bottom: 34 })
      .backgroundColor('#FFFFFF')
      .borderRadius({ topLeft: 36, topRight: 36 })
    }
    .height('100%')
    .width('100%')
  }

  @Builder
  private ProfileSection(
    title: string,
    labelOne: string,
    valueOne: string,
    labelTwo: string,
    valueTwo: string,
    labelThree: string,
    valueThree: string
  ) {
    Column({ space: 18 }) {
      Text(title)
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor('#111111')
        .width('100%')
      this.ProfileField(labelOne, valueOne)
      this.ProfileField(labelTwo, valueTwo)
      this.ProfileField(labelThree, valueThree)
    }
    .width('100%')
    .padding(22)
    .border({ width: 1, color: '#E5E5E5' })
    .borderRadius(24)
  }

  @Builder
  private ProfileField(label: string, value: string) {
    Column({ space: 4 }) {
      Text(label)
        .fontSize(16)
        .fontColor('#777777')
        .margin({ left: 20 })
      Row({ space: 16 }) {
        Text('■')
          .fontSize(20)
          .fontColor('#465057')
        Text(value)
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor('#111111')
      }
      .width('100%')
      .height(68)
      .padding({ left: 22, right: 22 })
      .border({ width: 1, color: '#E3E3E3' })
      .borderRadius(18)
    }
    .width('100%')
  }

  build() {
    Stack() {
      if (this.viewMode === SoleAiViewMode.LENS) {
        this.LensContent()
      } else if (this.viewMode === SoleAiViewMode.CROPPING) {
        this.CroppingContent()
      } else if (this.viewMode === SoleAiViewMode.CHAT) {
        this.ChatContent()
      } else {
        this.HomeContent()
      }

      if (this.showDrawer) {
        this.DrawerOverlay()
      }

      if (this.showProfile) {
        this.ProfileSheet()
      }

      if (this.showProductDetailModal) {
        this.ProductDetailSheet()
      }

      if (this.showSchedulerFloatPanel) {
        this.SchedulerDecisionPanel()
      } else {
        this.SchedulerFloatingButton()
      }
    }
    .height('100%')
    .width('100%')
    .backgroundColor('#FFFFFF')
  }
}
