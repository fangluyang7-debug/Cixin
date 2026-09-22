import { common } from '@kit.AbilityKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { FeedbackOption, FeedbackRequest, SchedulerService, TaskSignalType, TaskStatus, WorkflowHandle } from 'scheduler';
import { SchedulerMonitorPublisher } from '../services/SchedulerMonitorPublisher';
import { StoreManager } from '../database/StoreManager';
import { DataInitService } from '../services/DataInitService';
import { ShoppingTaskService } from '../services/ShoppingTaskService';
import { Product } from '../models/Product';
import { AssistantHome } from '../components/AssistantHome';
import { SearchResults } from '../components/SearchResults';
import { ProductDetail } from '../components/ProductDetail';
import { ExperienceFeedback } from '../components/ExperienceFeedback';
import { CommerceIconButton, ProductTile } from '../components/CommerceControls';
import { feedbackAvailabilityText } from '../services/FeedbackPresentation';
import { feedbackReceiptText, numericPrice, platformLabel, productKey, safeProductUrl } from '../services/CommercePresentation';

enum CommerceTab { HOME, CATALOG, RADAR, SAVED, PROFILE }

@Entry
@Component
struct Index {
  private readonly scheduler: SchedulerService = SchedulerService.getInstance();
  private readonly tasks: ShoppingTaskService = ShoppingTaskService.getInstance();
  private readonly monitor: SchedulerMonitorPublisher = SchedulerMonitorPublisher.getInstance();
  private activeSearch: WorkflowHandle<Product[]> | null = null;
  private generation: number = 0;
  private expiryTimer: number = -1;
  private readyTimer: number = -1;
  private photoGeneration: number = 0;
  private warming: boolean = false;
  private contentScroller: Scroller = new Scroller();
  @State feedbackStatus: string = '等待本次任务完成';
  @State tab: CommerceTab = CommerceTab.HOME;
  @State ready: boolean = false;
  @State query: string = '';
  @State lastQuery: string = '';
  @State products: Product[] = [];
  @State catalog: Product[] = [];
  @State saved: Product[] = [];
  @State histories: string[] = [];
  @State showHistory: boolean = false;
  @State selected: Product | null = null;
  @State loading: boolean = false;
  @State initialStatus: string = '正在准备本地商品';
  @State summary: string = '输入商品名称开始搜索';
  @State plan: string = '';
  @State highQuality: boolean = false;
  @State priceSorted: boolean = false;
  @State photoUri: string = '';
  @State feedback: FeedbackRequest | null = null;
  @State feedbackHidden: boolean = false;
  @State answering: boolean = false;
  @State feedbackEnabled: boolean = false;
  @State receiptText: string = '';
  @State contentHeight: number = 500;
  @State monitorEndpoint: string = '';
  @State monitorPairingCode: string = '';
  @State monitorEnabled: boolean = false;
  @State monitorSettingsLoaded: boolean = false;
  @State monitorStatus: string = '正在读取监控设置';

  aboutToAppear(): void { this.loadCatalog(); this.loadMonitorSettings(); this.watchReady(); }
  onPageShow(): void { this.watchReady(); }
  onPageHide(): void { this.invalidate(TaskSignalType.PAGE_LEFT); clearInterval(this.readyTimer); }
  aboutToDisappear(): void { this.invalidate(TaskSignalType.PAGE_LEFT); clearInterval(this.readyTimer); this.photoGeneration++; }
  onBackPress(): boolean {
    if (this.selected !== null) { this.selected = null; return true; }
    if (this.showHistory) { this.showHistory = false; return true; }
    if (this.tab !== CommerceTab.HOME) { this.navigate(CommerceTab.HOME); return true; }
    return false;
  }
  private watchReady(): void {
    clearInterval(this.readyTimer); this.refreshReady();
    this.readyTimer = setInterval(() => this.refreshReady(), 500);
  }
  private refreshReady(): void {
    this.ready = this.scheduler.isInitialized();
    if (!this.ready) { return; }
    this.feedbackEnabled = this.scheduler.isFeedbackEnabled();
    if (this.monitorEnabled && this.monitorSettingsLoaded) {
      this.monitor.start(this.monitorEndpoint, this.monitorPairingCode);
    }
    if (!this.feedbackEnabled && this.feedback !== null) { this.clearFeedback(); }
    this.refreshFeedbackStatus();
    if (!this.warming) {
      try { const handle = this.tasks.warmup(); this.warming = true; handle.result.catch(() => {}); }
      catch (_) { /* The host may still be registering its client. */ }
    }
  }
  private async loadCatalog(): Promise<void> {
    try {
      await DataInitService.waitUntilReady();
      const store = StoreManager.getInstance();
      const count = await store.getProductCount();
      this.catalog = await store.queryTopProducts(12);
      this.initialStatus = `本地 ${count} 件商品已就绪`;
    } catch (_) { this.initialStatus = '商品加载失败'; }
  }
  private async loadMonitorSettings(): Promise<void> {
    this.monitor.setStatusListener((status: string) => { this.monitorStatus = status; });
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const settings = await SchedulerMonitorPublisher.loadSettings(context);
      this.monitorEndpoint = settings.endpoint;
      this.monitorPairingCode = settings.pairingCode;
      this.monitorEnabled = settings.enabled;
    } catch (_) { this.monitorStatus = '监控设置读取失败'; }
    finally { this.monitorSettingsLoaded = true; }
    if (this.monitorEnabled && this.ready) { this.monitor.start(this.monitorEndpoint, this.monitorPairingCode); }
  }
  private async saveMonitorSettings(enabled: boolean): Promise<void> {
    const endpoint = this.monitorEndpoint.trim().replace(/\/$/, '');
    const pairingCode = this.monitorPairingCode.trim();
    if (enabled && (!SchedulerMonitorPublisher.isValidEndpoint(endpoint) ||
      !SchedulerMonitorPublisher.isValidPairingCode(pairingCode))) {
      this.monitorEnabled = false;
      this.monitorStatus = '请填写有效的电脑地址和配对码';
      this.notify('电脑地址或配对码格式不正确');
      return;
    }
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await SchedulerMonitorPublisher.saveSettings(context, { endpoint: endpoint, pairingCode: pairingCode, enabled: enabled });
      this.monitorEndpoint = endpoint;
      this.monitorPairingCode = pairingCode;
      this.monitorEnabled = enabled;
      if (enabled) { this.monitor.start(endpoint, pairingCode); }
      else { this.monitor.stop(); }
    } catch (_) {
      this.monitorEnabled = false;
      this.monitorStatus = '监控设置保存失败';
      this.notify('无法保存电脑监控设置');
    }
  }
  private clearFeedback(): void {
    clearTimeout(this.expiryTimer); this.feedback = null; this.feedbackHidden = false;
  }
  private invalidate(type: TaskSignalType = TaskSignalType.INPUT_REPLACED): void {
    this.generation++; this.clearFeedback();
    if (this.activeSearch !== null) { this.activeSearch.signal({ type: type }).catch(() => {}); this.activeSearch = null; }
    if (this.loading) { this.summary = '搜索已停止'; }
    this.loading = false;
  }
  private navigate(tab: CommerceTab): void {
    this.photoGeneration++;
    if (tab !== this.tab) { this.invalidate(TaskSignalType.PAGE_LEFT); }
    this.selected = null; this.showHistory = false; this.tab = tab;
  }
  private async search(value: string): Promise<void> {
    const query = value.trim();
    if (query === '') { return; }
    if (!this.ready) { this.notify('调度器仍在初始化，请稍后搜索'); return; }
    this.getUIContext().getFocusController().clearFocus();
    this.photoGeneration++;
    this.invalidate();
    const generation = this.generation;
    this.tab = CommerceTab.RADAR; this.selected = null; this.showHistory = false;
    this.query = ''; this.lastQuery = query; this.products = []; this.plan = ''; this.receiptText = '';
    this.summary = '正在检索本地商品'; this.loading = true;
    this.contentScroller.scrollTo({ xOffset: 0, yOffset: 0 });
    const started = Date.now();
    try {
      const handle = this.tasks.search(query, this.highQuality);
      this.activeSearch = handle;
      const result = await handle.result;
      if (generation !== this.generation) { await handle.signal({ type: TaskSignalType.RESULT_IGNORED }); return; }
      if (result.nodes.length > 0) {
        const audit = result.nodes[result.nodes.length - 1].executionPlan.policyAudit;
        this.plan = audit === undefined ? '本地执行' : `${audit.mode} · ${audit.actualProfileId}`;
      }
      if (result.status !== TaskStatus.SUCCEEDED || result.output === null) {
        this.summary = result.status === TaskStatus.CANCELLED ? '搜索已取消或过期' : '当前设备状态或任务约束不允许完成搜索';
        await handle.signal({ type: TaskSignalType.RESULT_IGNORED }); return;
      }
      this.products = result.output;
      this.summary = `找到 ${result.output.length} 件本地商品 · ${Date.now() - started} ms`;
      this.histories = [query].concat(this.histories.filter((item: string) => item !== query)).slice(0, 20);
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED,
        experience: { responseReadyMs: Date.now() - started } });
      if (generation === this.generation) { this.requestFeedback(); }
    } catch (_) {
      if (generation === this.generation) { this.summary = '搜索暂不可用，请稍后重试'; }
    } finally { if (generation === this.generation) { this.loading = false; } }
  }
  private requestFeedback(): void {
    if (this.activeSearch === null) { return; }
    clearTimeout(this.expiryTimer);
    this.feedback = this.tasks.feedbackRequest(this.activeSearch.workflowId);
    this.refreshFeedbackStatus();
    if (this.feedback !== null) {
      this.expiryTimer = setTimeout(() => { this.clearFeedback(); this.refreshFeedbackStatus(); }, Math.max(1, this.feedback.expiresAtMs - Date.now()));
    }
  }
  private refreshFeedbackStatus(): void {
    if (!this.ready) { this.feedbackStatus = '调度器尚未就绪'; return; }
    if (this.activeSearch === null) { this.feedbackStatus = this.feedbackEnabled ? '等待本次任务完成' : '体验题未开启：需要你的授权'; return; }
    try { this.feedbackStatus = feedbackAvailabilityText(this.tasks.feedbackAvailability(this.activeSearch.workflowId)); }
    catch (_) { this.feedbackStatus = '无法读取反馈状态'; }
  }
  private answer(option: FeedbackOption): void {
    if (this.answering || this.feedback === null || this.activeSearch === null) { return; }
    this.answering = true;
    try {
      const request = this.feedback;
      const receipt = this.tasks.submitFeedback(this.activeSearch.workflowId,
        { taskRunId: request.taskRunId, kind: request.kind, option: option });
      this.receiptText = feedbackReceiptText(receipt); this.clearFeedback();
      this.refreshFeedbackStatus();
    } catch (_) { this.receiptText = '反馈提交失败，请稍后重试'; }
    finally { this.answering = false; }
  }
  private setConsent(enabled: boolean): void {
    if (!this.ready) { return; }
    this.scheduler.setFeedbackEnabled(enabled); this.feedbackEnabled = enabled;
    if (!enabled) { this.clearFeedback(); }
    this.refreshFeedbackStatus();
    if (enabled && this.activeSearch !== null && !this.loading) { this.requestFeedback(); }
  }
  private openProduct(product: Product): void {
    this.selected = product;
    if (this.tab === CommerceTab.RADAR && this.activeSearch !== null) {
      this.activeSearch.signal({ type: TaskSignalType.RESULT_CONSUMED }).catch(() => {});
    }
  }
  private toggleSaved(product: Product): void {
    const key = productKey(product);
    this.saved = this.saved.some((item: Product) => productKey(item) === key) ?
      this.saved.filter((item: Product) => productKey(item) !== key) : this.saved.concat([product]);
  }
  private savedKeys(): string[] { return this.saved.map(productKey); }
  private visibleResults(): Product[] {
    return this.priceSorted ? this.products.slice().sort((a: Product, b: Product) => numericPrice(a) - numericPrice(b)) : this.products;
  }
  private async choosePhoto(): Promise<void> {
    this.invalidate(TaskSignalType.PAGE_LEFT);
    const generation = ++this.photoGeneration;
    try {
      const picker = new photoAccessHelper.PhotoViewPicker();
      const result = await picker.select({ MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1 });
      if (generation !== this.photoGeneration || result.photoUris.length === 0) { return; }
      this.photoUri = result.photoUris[0]; this.tab = CommerceTab.RADAR; this.selected = null;
      this.products = []; this.lastQuery = ''; this.plan = ''; this.receiptText = '';
      this.summary = '尚未接入图像识别，请输入图中商品名称进行文字搜索';
    } catch (_) { this.notify('未能打开图片选择器'); }
  }
  private async openSource(): Promise<void> {
    if (this.selected === null || !safeProductUrl(this.selected.productUrl)) {
      this.notify('暂无有效的 HTTPS 商品链接'); return;
    }
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await context.startAbility({ action: 'ohos.want.action.viewData', uri: this.selected.productUrl });
    } catch (_) { this.notify('无法打开商品来源页面'); }
  }
  private notify(message: string): void {
    try { this.getUIContext().getPromptAction().showToast({ message: message }); }
    catch (_) { this.receiptText = message; }
  }
  private openSchedulerSettings(): void {
    this.getUIContext().getRouter().pushUrl({ url: 'pages/SchedulerPanelPage' }).catch(() => this.notify('控制台打开失败'));
  }

  @Builder
  private Header() {
    Row({ space: 8 }) {
      CommerceIconButton({ icon: this.selected !== null ? $r('sys.media.ohos_ic_public_arrow_left') :
        $r('sys.media.ohos_ic_public_drawer_open'), label: this.selected !== null ? '返回商品列表' : '历史对话',
        action: () => {
          if (this.selected !== null) { this.selected = null; }
          else { this.invalidate(TaskSignalType.PAGE_LEFT); this.showHistory = !this.showHistory; }
        } })
      Text('S').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').textAlign(TextAlign.Center)
        .width(30).height(30).backgroundColor('#111111').borderRadius(15)
      Column({ space: 2 }) {
        Text(this.selected !== null ? '商品详情' : 'SoleAI').fontSize(19).fontWeight(FontWeight.Bold).maxLines(1)
        Text(this.ready ? '端侧商品助手' : '正在初始化').fontSize(10).fontColor('#747878')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%').padding(8).backgroundColor('#FFFFFF').borderRadius(32)
  }
  @Builder
  private Composer() {
    Row({ space: 8 }) {
      CommerceIconButton({ icon: $r('sys.media.ohos_ic_public_camera'), label: '选择商品图片', action: () => this.choosePhoto() })
      TextInput({ text: this.query, placeholder: '商品、品牌或预算...' }).layoutWeight(1).height(44).fontSize(14)
        .backgroundColor('#FFFFFF').enterKeyType(EnterKeyType.Search)
        .onChange((value: string) => {
          // ArkUI also reports changes caused by clearing the submitted draft.
          if (value === this.query) { return; }
          this.query = value;
          if (this.activeSearch !== null) { this.invalidate(); this.products = []; this.summary = '需求已更新，等待发送'; }
        }).onSubmit(() => this.search(this.query))
      Button({ type: ButtonType.Circle }) {
        Image($r('sys.media.ohos_ic_public_arrow_up')).width(22).height(22).fillColor('#FFFFFF')
      }.width(42).height(42).backgroundColor('#111111').accessibilityText('发送需求')
        .enabled(this.ready && this.query.trim() !== '').onClick(() => this.search(this.query))
    }.width('100%').padding(8).backgroundColor('#FFFFFF').borderRadius(30)
  }
  @Builder
  private TabItem(label: string, icon: Resource, tab: CommerceTab) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 4 }) {
        Image(icon).width(21).height(21).fillColor(this.tab === tab ? '#00513F' : '#747878')
        Text(label).fontSize(10).fontColor(this.tab === tab ? '#00513F' : '#747878')
      }
    }.layoutWeight(1).height(56).backgroundColor('#FFFFFF').onClick(() => this.navigate(tab))
  }
  @Builder
  private Tabs() {
    Row() {
      this.TabItem('助手', $r('sys.media.ohos_ic_public_text'), CommerceTab.HOME)
      this.TabItem('商品', $r('sys.media.ohos_ic_public_albums'), CommerceTab.CATALOG)
      this.TabItem('比价雷达', $r('sys.media.ohos_ic_public_search_filled'), CommerceTab.RADAR)
      this.TabItem('清单', $r('sys.media.ohos_ic_public_ok'), CommerceTab.SAVED)
      this.TabItem('我的', $r('sys.media.ohos_ic_public_more'), CommerceTab.PROFILE)
    }.width('100%').backgroundColor('#FFFFFF')
  }
  @Builder
  private Collection(items: Product[], title: string) {
    Column({ space: 16 }) {
      Text(title).fontSize(22).fontWeight(FontWeight.Bold).width('100%')
      if (items.length === 0) { Text('暂无商品').fontSize(14).fontColor('#747878').padding(32) }
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(items, (product: Product) => {
          Column() {
            ProductTile({ product: product, saved: this.savedKeys().indexOf(productKey(product)) >= 0,
              onOpen: (item: Product) => this.openProduct(item), onSave: (item: Product) => this.toggleSaved(item) })
          }.width('48%').margin({ bottom: 12 })
        }, productKey)
      }.width('100%')
    }.width('100%')
  }
  @Builder
  private Profile() {
    Column({ space: 20 }) {
      Text('本机偏好').fontSize(24).fontWeight(FontWeight.Bold).width('100%')
      Row() {
        Text('参与本地体验反馈').fontSize(16).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.feedbackEnabled }).selectedColor('#009576')
          .enabled(this.ready).onChange((value: boolean) => this.setConsent(value))
      }.width('100%')
      Text('仅记录结构化答案和调度指标，不记录搜索原文或图片，不自动上传。可随时关闭。')
        .fontSize(13).fontColor('#747878').width('100%')
      Divider().color('#E2E2E2')
      Text('电脑实时监控').fontSize(18).fontWeight(FontWeight.Medium).width('100%')
      Text('电脑和手机连接同一可信 Wi-Fi 后，运行电脑端监控服务，再填写电脑局域网地址与配对码。只推送调度状态、资源指标和任务事件，不包含搜索内容、图片或商品列表。')
        .fontSize(12).fontColor('#747878').width('100%')
      TextInput({ text: this.monitorEndpoint, placeholder: 'http://192.168.1.10:8765' }).width('100%').height(44)
        .fontSize(13).backgroundColor('#FFFFFF').onChange((value: string) => { this.monitorEndpoint = value; })
      TextInput({ text: this.monitorPairingCode, placeholder: '电脑终端显示的配对码' }).width('100%').height(44)
        .fontSize(13).backgroundColor('#FFFFFF').type(InputType.Password)
        .onChange((value: string) => { this.monitorPairingCode = value; })
      Row() {
        Text('向电脑推送实时遥测').fontSize(14).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.monitorEnabled }).selectedColor('#009576')
          .enabled(this.ready && this.monitorSettingsLoaded).onChange((value: boolean) => this.saveMonitorSettings(value))
      }.width('100%')
      Text(this.monitorStatus).fontSize(12).fontColor('#00513F').width('100%')
      Button('保存电脑连接信息').width('100%').backgroundColor('#E6F1EE').fontColor('#134E42')
        .onClick(() => this.saveMonitorSettings(this.monitorEnabled))
      Button('策略与实验控制台').width('100%').backgroundColor('#111111').fontColor('#FFFFFF')
        .onClick(() => this.openSchedulerSettings())
      Text(this.receiptText || '暂无反馈回执').fontSize(13).fontColor('#444748').width('100%')
      Text('清单与对话历史仅保留在本次运行中').fontSize(12).fontColor('#747878').width('100%')
      Button('清空本次清单与历史').fontSize(13).backgroundColor('#EEEEEE').fontColor('#1A1C1C')
        .onClick(() => { this.saved = []; this.histories = []; })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  private History() {
    Column({ space: 14 }) {
      Row() {
        Text('本次对话').fontSize(20).fontWeight(FontWeight.Bold).layoutWeight(1)
        CommerceIconButton({ icon: $r('sys.media.ohos_ic_public_close'), label: '关闭历史', action: () => { this.showHistory = false; } })
      }.width('100%')
      Button('开始新对话').backgroundColor('#111111').onClick(() => {
        this.navigate(CommerceTab.HOME); this.query = ''; this.photoUri = ''; this.receiptText = '';
      })
      if (this.histories.length === 0) { Text('暂无搜索记录').fontSize(14).fontColor('#747878') }
      ForEach(this.histories, (query: string) => {
        Button({ type: ButtonType.Normal }) {
          Text(query).fontSize(14).fontColor('#1A1C1C').maxLines(2).width('100%').textAlign(TextAlign.Start)
        }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(8).onClick(() => this.search(query))
      })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  private Body() {
    if (this.showHistory) { this.History() }
    else if (this.selected !== null) { ProductDetail({ product: this.selected }) }
    else if (this.tab === CommerceTab.HOME) {
      AssistantHome({ products: this.catalog, savedKeys: this.savedKeys(), status: this.initialStatus,
        onSearch: (value: string) => this.search(value), onFill: (value: string) => { this.query = value; },
        onPhoto: () => this.choosePhoto(), onOpen: (item: Product) => this.openProduct(item), onSave: (item: Product) => this.toggleSaved(item) })
    } else if (this.tab === CommerceTab.RADAR) {
      SearchResults({ products: this.visibleResults(), savedKeys: this.savedKeys(), query: this.lastQuery,
        summary: this.summary, plan: this.plan, busy: this.loading, photoUri: this.photoUri,
        highQuality: this.highQuality, priceSorted: this.priceSorted,
        onSort: () => { this.priceSorted = !this.priceSorted; },
        onQuality: (value: boolean) => {
          this.highQuality = value;
          if (this.lastQuery !== '') { this.search(this.lastQuery); }
        },
        onOpen: (item: Product) => this.openProduct(item), onSave: (item: Product) => this.toggleSaved(item),
        onRetry: () => this.search(this.lastQuery), onCancel: () => this.invalidate(TaskSignalType.CANCEL), onPhoto: () => this.choosePhoto() })
    } else if (this.tab === CommerceTab.CATALOG) { this.Collection(this.catalog, '本地商品') }
    else if (this.tab === CommerceTab.SAVED) { this.Collection(this.saved, `本次清单 · ${this.saved.length}`) }
    else { this.Profile() }
  }
  build() {
    Column({ space: 8 }) {
      this.Header()
      Stack({ alignContent: Alignment.Bottom }) {
        Scroll(this.contentScroller) {
          Column({ space: 16 }) {
            if (this.contentHeight < 300 && this.feedback !== null && !this.loading && !this.showHistory &&
              this.selected === null && this.tab === CommerceTab.RADAR) {
              if (this.feedbackHidden) {
                Button('体验反馈').height(36).fontSize(12).backgroundColor('#D7F8ED').fontColor('#00513F')
                  .onClick(() => { this.feedbackHidden = false; })
              } else {
                ExperienceFeedback({ request: this.feedback, submitting: this.answering, maxRise: 0,
                  onAnswer: (option: FeedbackOption) => this.answer(option), onDismiss: () => { this.feedbackHidden = true; } })
              }
            }
            if (this.tab === CommerceTab.RADAR) {
              if (!this.feedbackEnabled && this.ready) {
                Row() {
                  Text('偶尔回答使用感受（可选）').fontSize(12).layoutWeight(1)
                  Toggle({ type: ToggleType.Switch, isOn: this.feedbackEnabled }).selectedColor('#009576')
                    .onChange((value: boolean) => this.setConsent(value))
                }.width('100%')
                Text('仅保存在本机，不记录搜索内容或图片。').fontSize(11).fontColor('#747878').width('100%')
              } else if (this.feedback === null && this.feedbackStatus === '可以回答本次体验题') {
                Button('回答本次体验题').height(36).fontSize(12).onClick(() => this.requestFeedback())
              }
            }
            if (this.receiptText !== '' && this.tab !== CommerceTab.PROFILE) {
              Text(this.receiptText).fontSize(12).fontColor('#00513F').width('100%').padding(12).backgroundColor('#D7F8ED')
            }
            this.Body()
          }.width('100%').padding({ top: 12, bottom: this.contentHeight >= 300 && this.feedback !== null &&
            !this.feedbackHidden ? 270 : 20 })
        }.width('100%').height('100%').scrollBar(BarState.Off)
        if (this.contentHeight >= 300 && this.feedback !== null && !this.loading && !this.showHistory &&
          this.selected === null && this.tab === CommerceTab.RADAR) {
          if (this.feedbackHidden) {
            Button('体验反馈').height(36).fontSize(12).backgroundColor('#D7F8ED').fontColor('#00513F')
              .onClick(() => { this.feedbackHidden = false; }).margin({ bottom: 8 })
          } else {
            ExperienceFeedback({ request: this.feedback, submitting: this.answering, maxRise: Math.max(0, this.contentHeight - 270),
              onAnswer: (option: FeedbackOption) => this.answer(option), onDismiss: () => { this.feedbackHidden = true; } })
          }
        }
      }.layoutWeight(1).width('100%').clip(true).onAreaChange((_old: Area, area: Area) => { this.contentHeight = Number(area.height); })
      if (this.selected !== null) {
        Row({ space: 10 }) {
          CommerceIconButton({ icon: this.savedKeys().indexOf(productKey(this.selected)) >= 0 ?
            $r('sys.media.ohos_ic_public_ok') : $r('sys.media.ohos_ic_public_add'), label: '切换清单收藏',
            action: () => { if (this.selected !== null) { this.toggleSaved(this.selected); } } })
          Button(`前往${platformLabel(this.selected.platform)}查看`).layoutWeight(1).height(48).fontSize(15)
            .backgroundColor('#111111').onClick(() => this.openSource())
        }.width('100%').padding({ bottom: 8 })
      } else {
        if (this.tab === CommerceTab.HOME || this.tab === CommerceTab.RADAR) { this.Composer() }
        this.Tabs()
      }
    }.width('100%').height('100%').padding({ left: 12, right: 12, top: 8 }).backgroundColor('#F9F9F9')
  }
}
