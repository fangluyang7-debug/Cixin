import { common } from '@kit.AbilityKit';
import { ExperimentService } from '../services/ExperimentService';
import { promptAction, router } from '@kit.ArkUI';
import { ConstrainedPolicyMode, PolicyMetricsGroup } from 'scheduler';
import {
  AccuracyPreference,
  AppVisibility,
  Backend,
  DebugStatePatch,
  DeviceState,
  DeviceStateSource,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
  MemoryPressure,
  MetricsSnapshot,
  ModelTier,
  RemoteExecutionPlan,
  PolicyMode,
  QueueAction,
  SchedulerLogEntry,
  SchedulerService,
  TaskProfile,
  TaskRequest,
  TaskResult,
  TaskStatus,
  TaskType,
  ThermalLevel,
  Unsubscribe
} from 'scheduler';

interface PanelProbeInput {
  message: string;
  payloadKb: number;
}

interface PanelProbeScenario {
  title: string;
  description: string;
  capability: string;
  taskType: TaskType;
  accuracyPreference: AccuracyPreference;
  latencyBudgetMs: number;
  allowPause: boolean;
  timeoutMs: number;
  baseDurationMs: number;
  payloadKb: number;
}

@Entry
@Component
struct SchedulerPanelPage {
  private readonly schedulerService: SchedulerService = SchedulerService.getInstance();
  private stateUnsubscribe: Unsubscribe | null = null;
  private logUnsubscribe: Unsubscribe | null = null;
  private metricsRefreshTimerId: number = -1;

  @State experimentRunning: boolean = false;
  @State includeExperimentQualityIds: boolean = false;
  @State experimentMessage: string = '真实 CPU 负载采样；按实际策略与配置审计分组，旧模式标签不代表三种闭环策略';
  @State isReady: boolean = false;
  @State closedLoopMode: ConstrainedPolicyMode = ConstrainedPolicyMode.OBSERVE;
  @State closedLoopVersion: string = '';
  @State localFeedbackEnabled: boolean = false;
  @State policyStorageStatus: string = '';
  @State profileMetrics: PolicyMetricsGroup[] = [];
  @State isBusy: boolean = false;
  @State feedbackText: string = '';
  @State deviceState: DeviceState | null = null;
  @State policyMode: PolicyMode = PolicyMode.ADAPTIVE;
  @State metrics: MetricsSnapshot | null = null;
  @State logs: SchedulerLogEntry[] = [];
  @State metricsRefreshTick: number = 0;
  @State latestProbeResult: TaskResult<string> | null = null;
  @State latestPanelCapability: string = '';
  @State latestPanelStatusText: string = '';
  @State latestPanelExecutionText: string = '';
  @State latestPanelQueueText: string = '';
  @State debugInjectionStatusText: string = '当前注入：无，使用系统 API 实时监测';
  @State selectedEnvironmentScenario: string = '';
  @State selectedPressureScenario: string = '';
  @State selectedProbeIndex: number = 0;
  @State latestProbeScenarioTitle: string = '图片 Embedding 检索';

  private readonly probeScenarios: PanelProbeScenario[] = [
    {
      title: '图片 Embedding 检索',
      description: 'ROI 图像特征提取 + 256维相似向量匹配',
      capability: 'image_product_embedding_search',
      taskType: TaskType.USER_INITIATED,
      accuracyPreference: AccuracyPreference.QUALITY_FIRST,
      latencyBudgetMs: 160,
      allowPause: false,
      timeoutMs: 2000,
      baseDurationMs: 220,
      payloadKb: 3200
    },
    {
      title: '文字 Embedding 检索',
      description: '短文本语义解析 + 64维候选召回',
      capability: 'text_product_embedding_search',
      taskType: TaskType.USER_INITIATED,
      accuracyPreference: AccuracyPreference.SPEED_FIRST,
      latencyBudgetMs: 240,
      allowPause: false,
      timeoutMs: 2000,
      baseDurationMs: 140,
      payloadKb: 1200
    },
    {
      title: '后台索引更新',
      description: '离线向量归一化与缓存预热',
      capability: 'background_index_update',
      taskType: TaskType.BACKGROUND_BATCH,
      accuracyPreference: AccuracyPreference.SPEED_FIRST,
      latencyBudgetMs: 2000,
      allowPause: false,
      timeoutMs: 3000,
      baseDurationMs: 320,
      payloadKb: 5200
    }
  ];

  aboutToAppear(): void {
    this.connectScheduler();
  }

  aboutToDisappear(): void {
    if (this.experimentRunning) { ExperimentService.getInstance().cancel(); }
    this.disconnectScheduler();
  }

  private connectScheduler(): void {
    this.disconnectScheduler();
    if (!this.schedulerService.isInitialized()) {
      this.isReady = false;
      this.feedbackText = '调度中间件仍在初始化，请稍后点击刷新';
      this.startMetricsPolling();
      return;
    }

    this.isReady = true;
    this.feedbackText = '';
    this.stateUnsubscribe = this.schedulerService.registerStateCallback(
      (state: DeviceState, mode: PolicyMode): void => {
        this.deviceState = state;
        this.policyMode = mode;
        this.refreshMetricsAndLogs();
      }
    );
    this.logUnsubscribe = this.schedulerService.registerLogCallback(
      (_entry: SchedulerLogEntry): void => {
        this.refreshData();
      }
    );
    this.refreshData();
    this.startMetricsPolling();
  }

  private disconnectScheduler(): void {
    this.stopMetricsPolling();
    if (this.stateUnsubscribe !== null) {
      this.stateUnsubscribe();
      this.stateUnsubscribe = null;
    }
    if (this.logUnsubscribe !== null) {
      this.logUnsubscribe();
      this.logUnsubscribe = null;
    }
  }

  private refreshData(): void {
    if (!this.schedulerService.isInitialized()) {
      this.isReady = false;
      this.feedbackText = '调度中间件未初始化';
      return;
    }
    this.isReady = true;
    this.deviceState = this.schedulerService.getDeviceState();
    this.policyMode = this.schedulerService.getPolicyMode();
    this.refreshMetricsAndLogs();
  }

  private refreshMetricsAndLogs(): void {
    if (!this.schedulerService.isInitialized()) {
      return;
    }
    this.metrics = this.schedulerService.getMetricsSnapshot();
    const policy = this.schedulerService.getConstrainedPolicy();
    this.closedLoopMode = policy.mode;
    this.closedLoopVersion = policy.version;
    this.localFeedbackEnabled = this.schedulerService.isFeedbackEnabled();
    this.policyStorageStatus = this.schedulerService.getPolicyStorageStatus();
    this.profileMetrics = this.schedulerService.getPolicyMetrics();
    this.logs = this.schedulerService.getRecentLogs(20).slice().reverse();
    this.metricsRefreshTick++;
  }

  private startMetricsPolling(): void {
    this.stopMetricsPolling();
    this.metricsRefreshTimerId = setInterval(() => {
      if (!this.schedulerService.isInitialized()) {
        this.isReady = false;
        return;
      }
      if (!this.isReady) {
        this.connectScheduler();
        return;
      }
      this.refreshData();
    }, 500);
  }

  private stopMetricsPolling(): void {
    if (this.metricsRefreshTimerId >= 0) {
      clearInterval(this.metricsRefreshTimerId);
      this.metricsRefreshTimerId = -1;
    }
  }

  private async changePolicy(mode: PolicyMode): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      await this.schedulerService.setPolicyMode(mode);
      this.policyMode = mode;
      this.feedbackText = `策略已切换为：${this.policyModeText(mode)} (已自动重新评估样例调度)`;
      this.refreshData();
      await this.executeProbeTask(false);
    } catch (error) {
      this.feedbackText = `策略切换失败：${JSON.stringify(error)}`;
    } finally {
      this.isBusy = false;
    }
  }

  private async injectAllBackends(): Promise<void> {
    await this.applyDebugState('已注入硬件能力：CPU + GPU + NPU (全异构加速)', {
      availableBackends: [Backend.CPU, Backend.GPU, Backend.NPU]
    });
  }

  private async injectCpuNpuBackends(): Promise<void> {
    await this.applyDebugState('已注入硬件能力：CPU + NPU 神经网络加速', {
      availableBackends: [Backend.CPU, Backend.NPU]
    });
  }

  private async injectCpuGpuBackends(): Promise<void> {
    await this.applyDebugState('已注入硬件能力：CPU + GPU 图形加速', {
      availableBackends: [Backend.CPU, Backend.GPU]
    });
  }

  private async injectCpuOnlyBackend(): Promise<void> {
    await this.applyDebugState('已注入硬件能力：仅 CPU (无硬件加速)', {
      availableBackends: [Backend.CPU]
    });
  }

  private async injectNormalState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：常温、充电中、电量 85%', {
      batteryPercent: 85,
      isCharging: true,
      thermalLevel: ThermalLevel.NORMAL,
      appVisibility: AppVisibility.FOREGROUND
    });
    if (applied) {
      this.selectedEnvironmentScenario = 'NORMAL_CHARGING';
    }
  }

  private async injectLowBatteryState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：低电量 12%、未充电', {
      batteryPercent: 12,
      isCharging: false,
      thermalLevel: ThermalLevel.NORMAL,
      appVisibility: AppVisibility.FOREGROUND
    });
    if (applied) {
      this.selectedEnvironmentScenario = 'LOW_BATTERY';
    }
  }

  private async injectHotState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：高热、未充电、电量 55%', {
      batteryPercent: 55,
      isCharging: false,
      thermalLevel: ThermalLevel.HOT,
      appVisibility: AppVisibility.FOREGROUND
    });
    if (applied) {
      this.selectedEnvironmentScenario = 'HOT';
    }
  }

  private async injectQueuePressureState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：队列繁忙、近期耗时略超预算', {
      queueDepth: 3,
      recentLatencyMs: 260,
      memoryPressure: MemoryPressure.NORMAL,
      availableMemoryMb: 1536
    });
    if (applied) {
      this.selectedPressureScenario = 'QUEUE_BUSY';
    }
  }

  private async injectMemoryPressureState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：内存占用较高、可用内存 320 MB', {
      queueDepth: 1,
      memoryPressure: MemoryPressure.HIGH,
      availableMemoryMb: 320,
      recentLatencyMs: 180
    });
    if (applied) {
      this.selectedPressureScenario = 'MEMORY_HIGH';
    }
  }

  private async injectCriticalMemoryState(): Promise<void> {
    const applied: boolean = await this.applyDebugState('组合条件已更新：内存临界、可用内存 128 MB', {
      memoryPressure: MemoryPressure.CRITICAL,
      availableMemoryMb: 128,
      recentLatencyMs: 900,
      queueDepth: 4
    });
    if (applied) {
      this.selectedPressureScenario = 'MEMORY_CRITICAL';
    }
  }

  private async applyDebugState(
    successText: string,
    patch: DebugStatePatch
  ): Promise<boolean> {
    if (!this.isReady || this.isBusy) {
      return false;
    }
    this.isBusy = true;
    try {
      await this.schedulerService.injectDebugState(patch);
      this.debugInjectionStatusText = successText;
      this.feedbackText = successText;
      this.refreshData();
      await this.executeProbeTask(false);
      return true;
    } catch (error) {
      this.feedbackText = `状态注入失败：${JSON.stringify(error)}`;
      return false;
    } finally {
      this.isBusy = false;
    }
  }

  private async clearDebugState(): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      await this.schedulerService.clearDebugState();
      this.debugInjectionStatusText = '当前注入：无，已恢复系统 API 实时监测';
      this.selectedEnvironmentScenario = '';
      this.selectedPressureScenario = '';
      this.feedbackText = '调试覆盖已清除，恢复真实系统传感器状态';
      this.refreshData();
      await this.executeProbeTask(false);
    } catch (error) {
      this.feedbackText = `清除调试状态失败：${JSON.stringify(error)}`;
    } finally {
      this.isBusy = false;
    }
  }

  private async pauseBackgroundTasks(): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      const count: number = await this.schedulerService.pauseBackgroundTasks('PANEL_MANUAL_PAUSE');
      this.feedbackText = `已暂停 ${count} 个排队中的后台批处理任务`;
      this.refreshData();
    } catch (error) {
      this.feedbackText = `暂停后台任务失败：${JSON.stringify(error)}`;
    } finally {
      this.isBusy = false;
    }
  }

  private async resumeBackgroundTasks(): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      const count: number = await this.schedulerService.resumeBackgroundTasks();
      this.feedbackText = `已恢复 ${count} 个后台任务执行`;
      this.refreshData();
    } catch (error) {
      this.feedbackText = `恢复后台任务失败：${JSON.stringify(error)}`;
    } finally {
      this.isBusy = false;
    }
  }

  private async runProbeTask(): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      await this.executeProbeTask(true);
    } finally {
      this.isBusy = false;
    }
  }

  private async changeProbeScenario(index: number): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.selectedProbeIndex = index;
    const scenario: PanelProbeScenario = this.getSelectedProbeScenario();
    this.latestProbeScenarioTitle = scenario.title;
    this.isBusy = true;
    try {
      await this.executeProbeTask(false);
    } finally {
      this.isBusy = false;
    }
  }

  private async executeProbeTask(showToastAlert: boolean): Promise<void> {
    try {
      const scenario: PanelProbeScenario = this.getSelectedProbeScenario();
      const request: TaskRequest<PanelProbeInput> = {
        taskType: scenario.taskType,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: scenario.capability,
        input: {
          message: scenario.title,
          payloadKb: scenario.payloadKb
        },
        accuracyPreference: scenario.accuracyPreference,
        latencyBudgetMs: scenario.latencyBudgetMs,
        allowDegrade: true,
        allowPause: scenario.allowPause,
        timeoutMs: scenario.timeoutMs
      };
      this.latestProbeResult = null;
      this.latestPanelCapability = scenario.capability;
      this.latestPanelStatusText = '排队';
      this.latestPanelExecutionText = '0 ms';
      this.latestPanelQueueText = '0 ms';
      this.refreshData();
      const previewPlan: ExecutionPlan = this.schedulerService.evaluate(this.createProbeTaskProfile(request));
      if (previewPlan.queueAction === QueueAction.PAUSE || previewPlan.queueAction === QueueAction.REJECT) {
        this.latestPanelStatusText = previewPlan.queueAction === QueueAction.PAUSE ? '暂停' : '拒绝';
        this.latestPanelExecutionText = '-';
        this.latestPanelQueueText = '0 ms';
        this.feedbackText = `${scenario.title}当前${this.latestPanelStatusText}：${previewPlan.reasonCodes.join(' / ')}`;
        this.refreshData();
        return;
      }
      const result: TaskResult<string> = await this.schedulerService.runTask<PanelProbeInput, string>(
        request,
        async (input: PanelProbeInput, plan: ExecutionPlan): Promise<string> => {
          this.latestPanelStatusText = '运行中';
          const simulatedDurationMs: number = this.resolveProbeDurationMs(plan, scenario);
          return new Promise<string>((resolve) => {
            setTimeout(() => resolve(`${input.message} · ${input.payloadKb}KB`), simulatedDurationMs);
          });
        }
      );
      this.latestProbeResult = result;
      this.latestProbeScenarioTitle = scenario.title;
      this.latestPanelStatusText = this.taskStatusShortText(result.status);
      this.latestPanelExecutionText = `${Math.round(result.executionDurationMs)} ms`;
      this.latestPanelQueueText = `${Math.round(result.queueDurationMs)} ms`;
      const plan: ExecutionPlan = result.executionPlan;
      this.feedbackText = `模拟任务${scenario.title}：${this.taskStatusShortText(result.status)} · ${this.planPrimaryLabel(plan)} · ${this.planSecondaryLabel(plan)} · 耗时 ${result.totalDurationMs} ms`;
      if (showToastAlert) {
        try {
          promptAction.showToast({
            message: `模拟任务${scenario.title}：${this.taskStatusShortText(result.status)} · ${this.planPrimaryLabel(plan)} | ${this.planSecondaryLabel(plan)}`,
            duration: 2500
          });
        } catch (e) {
          // Fallback if toast fails
        }
      }
      this.refreshData();
    } catch (error) {
      this.latestPanelStatusText = '失败';
      this.feedbackText = `样例任务执行失败：${JSON.stringify(error)}`;
    }
  }

  private createProbeTaskProfile(request: TaskRequest<PanelProbeInput>): TaskProfile {
    return {
      taskType: request.taskType,
      inferenceLocation: request.inferenceLocation,
      capability: request.capability,
      accuracyPreference: request.accuracyPreference,
      latencyBudgetMs: request.latencyBudgetMs === undefined ? null : request.latencyBudgetMs,
      allowDegrade: request.allowDegrade,
      allowPause: request.allowPause,
      timeoutMs: request.timeoutMs,
      remoteOptions: request.remoteOptions
    };
  }

  private getSelectedProbeScenario(): PanelProbeScenario {
    if (this.selectedProbeIndex < 0 || this.selectedProbeIndex >= this.probeScenarios.length) {
      return this.probeScenarios[0];
    }
    return this.probeScenarios[this.selectedProbeIndex];
  }

  private resolveProbeDurationMs(plan: ExecutionPlan, scenario: PanelProbeScenario): number {
    if (plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
      return scenario.baseDurationMs;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    let tierFactor: number = 2.3;
    if (localPlan.modelTier === ModelTier.HIGH_ACCURACY) {
      tierFactor = 0.58;
    } else if (localPlan.modelTier === ModelTier.BALANCED) {
      tierFactor = 1.0;
    }

    let backendFactor: number = 1.18;
    if (localPlan.backend === Backend.NPU) {
      backendFactor = 0.56;
    } else if (localPlan.backend === Backend.NNRT) {
      backendFactor = 0.66;
    } else if (localPlan.backend === Backend.GPU) {
      backendFactor = 0.78;
    }

    let thermalFactor: number = 1.0;
    if (this.deviceState !== null && this.deviceState.thermalLevel === ThermalLevel.HOT) {
      thermalFactor = 1.35;
    } else if (this.deviceState !== null && this.deviceState.thermalLevel === ThermalLevel.WARM) {
      thermalFactor = 1.14;
    }

    let batteryFactor: number = 1.0;
    if (this.deviceState !== null && this.deviceState.batteryPercent !== null &&
      this.deviceState.batteryPercent <= 20 && this.deviceState.isCharging !== true) {
      batteryFactor = 1.28;
    }

    const threadFactor: number = localPlan.threadCount === 4 ? 0.76 :
      (localPlan.threadCount === 2 ? 0.92 : 1.18);
    const durationMs: number = scenario.baseDurationMs * tierFactor * backendFactor *
      thermalFactor * batteryFactor * threadFactor;
    const maxDurationMs: number = Math.max(120, scenario.timeoutMs - 100);
    return Math.min(maxDurationMs, Math.max(120, Math.round(durationMs)));
  }

  private getLatestPlanReasonText(): string {
    if (this.latestProbeResult === null || this.latestProbeResult.executionPlan.reasonCodes.length === 0) {
      return '等待运行样例任务';
    }
    return this.latestProbeResult.executionPlan.reasonCodes.join(' / ');
  }

  private getLatestPlanOutputText(): string {
    if (this.latestProbeResult === null) {
      return '尚无输出';
    }
    return `${this.planPrimaryLabel(this.latestProbeResult.executionPlan)} · ${this.planSecondaryLabel(this.latestProbeResult.executionPlan)}`;
  }

  private policyModeText(mode: PolicyMode): string {
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '固定高性能模式';
    }
    if (mode === PolicyMode.FIXED_POWER_SAVING) {
      return '固定省电模式';
    }
    return '自适应模式';
  }

  private batteryText(state: DeviceState): string {
    return state.batteryPercent === null ? '未知' : `${state.batteryPercent}%`;
  }

  private chargingText(state: DeviceState): string {
    if (state.isCharging === null) {
      return '未知';
    }
    return state.isCharging ? '充电中' : '未充电';
  }

  private thermalText(level: ThermalLevel): string {
    if (level === ThermalLevel.NORMAL) {
      return '正常 (常温)';
    }
    if (level === ThermalLevel.WARM) {
      return '温热 (轻微升温)';
    }
    if (level === ThermalLevel.HOT) {
      return '高热 (触发降级)';
    }
    if (level === ThermalLevel.CRITICAL) {
      return '临界保护 (关速/拒载)';
    }
    return '未知';
  }

  private visibilityText(visibility: AppVisibility): string {
    return visibility === AppVisibility.FOREGROUND ? '前台运行' : '后台运行';
  }

  private sourceText(source: DeviceStateSource): string {
    if (source === DeviceStateSource.INJECTED) {
      return '调试注入';
    }
    if (source === DeviceStateSource.MIXED) {
      return '真实 + 调试';
    }
    return '真实设备数据';
  }

  private latencyText(state: DeviceState): string {
    return state.recentLatencyMs === null ? '未知' : `${Math.round(state.recentLatencyMs)} ms`;
  }

  private cpuUsageText(value: number | null): string {
    return value === null ? '未知' : `${Math.round(value * 10) / 10}%`;
  }

  private memoryRuntimeText(state: DeviceState): string {
    if (state.availableMemoryMb === null && state.totalMemoryMb === null) {
      return '未知';
    }
    const available: string = state.availableMemoryMb === null ? '-' : `${Math.round(state.availableMemoryMb)} MB`;
    const total: string = state.totalMemoryMb === null ? '-' : `${Math.round(state.totalMemoryMb)} MB`;
    return `${available} / ${total}`;
  }

  private memoryPressureText(state: DeviceState): string {
    if (state.memoryPressure === MemoryPressure.NORMAL) {
      return state.availableMemoryMb === null ? '正常' : `正常 · ${Math.round(state.availableMemoryMb)} MB`;
    }
    if (state.memoryPressure === MemoryPressure.MODERATE) {
      return state.availableMemoryMb === null ? '中等压力' : `中等 · ${Math.round(state.availableMemoryMb)} MB`;
    }
    if (state.memoryPressure === MemoryPressure.HIGH) {
      return state.availableMemoryMb === null ? '高压力' : `高压 · ${Math.round(state.availableMemoryMb)} MB`;
    }
    if (state.memoryPressure === MemoryPressure.CRITICAL) {
      return state.availableMemoryMb === null ? '严重不足' : `严重 · ${Math.round(state.availableMemoryMb)} MB`;
    }
    return state.availableMemoryMb === null ? '未知' : `未知 · ${Math.round(state.availableMemoryMb)} MB`;
  }

  private debugInjectionRuntimeText(): string {
    if (this.deviceState === null) {
      return '等待设备状态刷新';
    }
    return `${this.sourceText(this.deviceState.source)} · SOC ${this.batteryText(this.deviceState)} · ${this.chargingText(this.deviceState)} · ${this.thermalText(this.deviceState.thermalLevel)} · 队列 ${this.deviceState.queueDepth} · ${this.memoryPressureText(this.deviceState)}`;
  }

  private canChangeBackendSimulation(): boolean {
    return !this.isBusy && this.policyMode !== PolicyMode.FIXED_POWER_SAVING;
  }

  private backendSimulationButtonColor(): string {
    return this.policyMode === PolicyMode.FIXED_POWER_SAVING ? '#D0D5DD' : '#0A66F5';
  }

  private backendSimulationFontColor(): string {
    return this.policyMode === PolicyMode.FIXED_POWER_SAVING ? '#667085' : '#FFFFFF';
  }

  private scenarioButtonColor(selectedScenario: string, scenario: string): string {
    return selectedScenario === scenario ? '#0A66F5' : '#DCE9FF';
  }

  private scenarioButtonFontColor(selectedScenario: string, scenario: string): string {
    return selectedScenario === scenario ? '#FFFFFF' : '#175CD3';
  }

  private latestRuntimeLog(): SchedulerLogEntry | null {
    for (let index: number = 0; index < this.logs.length; index++) {
      const entry: SchedulerLogEntry = this.logs[index];
      if (this.isObservableLog(entry)) {
        return entry;
      }
    }
    return null;
  }

  private latestTaskMetricText(): string {
    if (this.latestPanelCapability.length > 0) {
      return this.capabilityShortText(this.latestPanelCapability);
    }
    const entry: SchedulerLogEntry | null = this.latestRuntimeLog();
    if (entry === null) {
      return '无';
    }
    return this.capabilityShortText(entry.capability);
  }

  private latestTaskStatusText(): string {
    if (this.latestPanelCapability.length > 0 && this.latestPanelStatusText.length > 0) {
      return this.latestPanelStatusText;
    }
    const entry: SchedulerLogEntry | null = this.latestRuntimeLog();
    if (entry === null) {
      return '无';
    }
    return this.taskStatusShortText(entry.status);
  }

  private capabilityShortText(capability: string): string {
    if (capability.indexOf('image') >= 0 || capability.indexOf('crop') >= 0 || capability.indexOf('camera') >= 0) {
      return '图片任务';
    }
    if (capability.indexOf('text') >= 0 || capability.indexOf('product_search') >= 0 ||
      capability.indexOf('keyword') >= 0) {
      return '文字搜索';
    }
    if (capability.indexOf('chat') >= 0 || capability.indexOf('intent') >= 0) {
      return '意图推理';
    }
    if (capability.indexOf('background') >= 0 || capability.indexOf('index') >= 0) {
      return '后台索引';
    }
    return capability.length > 8 ? capability.substring(0, 8) : capability;
  }

  private taskStatusShortText(status: TaskStatus): string {
    if (status === TaskStatus.STOP_REQUESTED) { return '等待停止'; }
    if (status === TaskStatus.CREATED || status === TaskStatus.QUEUED) {
      return '排队';
    }
    if (status === TaskStatus.RUNNING) {
      return '运行中';
    }
    if (status === TaskStatus.SUCCEEDED) {
      return '完成';
    }
    if (status === TaskStatus.TIMED_OUT) {
      return '超时';
    }
    if (status === TaskStatus.CANCELLED) {
      return '取消';
    }
    return '失败';
  }

  private isObservableLog(entry: SchedulerLogEntry): boolean {
    return entry.status === TaskStatus.CREATED ||
      entry.status === TaskStatus.QUEUED ||
      entry.status === TaskStatus.RUNNING ||
      entry.status === TaskStatus.STOP_REQUESTED ||
      this.isTerminalStatus(entry.status);
  }

  private latestExecutionMetricText(): string {
    if (this.latestPanelCapability.length > 0 && this.latestPanelExecutionText.length > 0) {
      return this.latestPanelExecutionText;
    }
    const entry: SchedulerLogEntry | null = this.latestRuntimeLog();
    if (entry !== null) {
      return this.executionDurationText(entry);
    }
    if (this.metrics !== null) {
      return `${Math.round(this.metrics.averageLatencyMs)} ms`;
    }
    return '0 ms';
  }

  private latestQueueMetricText(): string {
    if (this.latestPanelCapability.length > 0 && this.latestPanelQueueText.length > 0) {
      return this.latestPanelQueueText;
    }
    const entry: SchedulerLogEntry | null = this.latestRuntimeLog();
    if (entry !== null) {
      return this.queueDurationText(entry);
    }
    if (this.metrics !== null) {
      return `${Math.round(this.metrics.averageQueueDurationMs)} ms`;
    }
    return '0 ms';
  }

  private executionDurationText(entry: SchedulerLogEntry): string {
    const tick: number = this.metricsRefreshTick;
    if (entry.executionDurationMs !== null) {
      return `${Math.round(entry.executionDurationMs)} ms`;
    }
    if ((entry.status === TaskStatus.RUNNING || entry.status === TaskStatus.STOP_REQUESTED) && entry.startedAt !== null) {
      return `${Math.max(0, Math.round(Date.now() - entry.startedAt + tick * 0))} ms`;
    }
    if (entry.status === TaskStatus.CREATED || entry.status === TaskStatus.QUEUED) {
      return '0 ms';
    }
    return '-';
  }

  private queueDurationText(entry: SchedulerLogEntry): string {
    const tick: number = this.metricsRefreshTick;
    if (entry.queueDurationMs !== null) {
      return `${Math.round(entry.queueDurationMs)} ms`;
    }
    if (entry.startedAt === null) {
      return `${Math.max(0, Math.round(Date.now() - entry.queuedAt + tick * 0))} ms`;
    }
    return `${Math.max(0, Math.round(entry.startedAt - entry.queuedAt))} ms`;
  }

  private isTerminalStatus(status: TaskStatus): boolean {
    return status === TaskStatus.SUCCEEDED ||
      status === TaskStatus.FAILED ||
      status === TaskStatus.TIMED_OUT ||
      status === TaskStatus.CANCELLED;
  }

  private statusColor(status: TaskStatus): string {
    if (status === TaskStatus.STOP_REQUESTED) { return '#B54708'; }
    if (status === TaskStatus.SUCCEEDED) {
      return '#067647';
    }
    if (status === TaskStatus.FAILED || status === TaskStatus.TIMED_OUT) {
      return '#B42318';
    }
    if (status === TaskStatus.CANCELLED) {
      return '#B54708';
    }
    if (status === TaskStatus.RUNNING) {
      return '#175CD3';
    }
    return '#475467';
  }

  private planPrimaryLabel(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return `云端 · ${(plan as RemoteExecutionPlan).provider}`;
    }
    return `端侧 · ${this.backendShortLabel((plan as LocalExecutionPlan).backend)}`;
  }

  private planSecondaryLabel(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      const remotePlan: RemoteExecutionPlan = plan as RemoteExecutionPlan;
      return `云端任务 · 超时 ${remotePlan.timeoutMs} ms · 探测重试 ${remotePlan.maxRetries}`;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return `${localPlan.modelTier} · ${localPlan.threadCount} 线程 · ${localPlan.queueAction}`;
  }

  private planFontColor(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return '#6941C6';
    }
    return this.backendFontColor((plan as LocalExecutionPlan).backend);
  }

  private planBgColor(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return '#F4F3FF';
    }
    return this.backendBgColor((plan as LocalExecutionPlan).backend);
  }

  private formatCsvPlan(plan: ExecutionPlan): string {
    if (plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      const remotePlan: RemoteExecutionPlan = plan as RemoteExecutionPlan;
      return `${plan.inferenceLocation},,,,${remotePlan.provider}`;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return `${plan.inferenceLocation},${localPlan.backend},${localPlan.threadCount},${localPlan.modelTier},`;
  }

  private backendLabel(backend: Backend): string {
    if (backend === Backend.NPU) {
      return 'NPU (神经网络)';
    }
    if (backend === Backend.GPU) {
      return 'GPU (图形加速)';
    }
    if (backend === Backend.NNRT) {
      return 'NNRT (NPU/GPU)';
    }
    return 'CPU (多线程)';
  }

  private backendShortLabel(backend: Backend): string {
    if (backend === Backend.NPU) {
      return 'NPU 硬件加速';
    }
    if (backend === Backend.GPU) {
      return 'GPU 硬件加速';
    }
    if (backend === Backend.NNRT) {
      return 'NNRT 加速';
    }
    return 'CPU 多线程';
  }

  private backendFontColor(backend: Backend): string {
    if (backend === Backend.NPU) {
      return '#6941C6';
    }
    if (backend === Backend.GPU) {
      return '#0369A1';
    }
    if (backend === Backend.NNRT) {
      return '#3538CD';
    }
    return '#175CD3';
  }

  private backendBgColor(backend: Backend): string {
    if (backend === Backend.NPU) {
      return '#F4EBFF';
    }
    if (backend === Backend.GPU) {
      return '#E0F2FE';
    }
    if (backend === Backend.NNRT) {
      return '#EEF4FF';
    }
    return '#EFF8FF';
  }

  private policyBannerTitle(mode: PolicyMode): string {
    if (mode === PolicyMode.ADAPTIVE) {
      return '自适应模式机制：';
    }
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '固定高性能模式机制：';
    }
    return '固定省电模式机制：';
  }

  private policyBannerTitleColor(mode: PolicyMode): string {
    if (mode === PolicyMode.ADAPTIVE) {
      return '#175CD3';
    }
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '#B54708';
    }
    return '#067647';
  }

  private policyBannerDesc(mode: PolicyMode): string {
    if (mode === PolicyMode.ADAPTIVE) { return '根据真实或明确标注的注入状态，选择已声明的 CPU 线程与检索维度；保护即时生效，升档等待稳定窗口。'; }
    if (mode === PolicyMode.FIXED_PERFORMANCE) { return '偏向高质量与较高 CPU 线程配置，仍遵守设备保护和能力约束；性能需通过真实负载实验测量。'; }
    return '偏向低开销 CPU 配置；后台在分块边界让出或保护暂停。不控制硬件频率，不预设节能效果。';
  }

  private policyBannerBgColor(mode: PolicyMode): string {
    if (mode === PolicyMode.ADAPTIVE) {
      return '#EFF8FF';
    }
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '#FEF6EE';
    }
    return '#ECFDF3';
  }

  private getDynamicBatteryLifespan(): string { return '未测量'; }
  private getDynamicComputeSpeed(): string { return '见真实实验导出'; }
  private getModeWattText(_mode: PolicyMode): string { return '功耗未测量；不使用预设功率/时延'; }

  private async runRealExperiment(): Promise<void> {
    if (this.isBusy || this.experimentRunning) { return; }
    this.experimentRunning = true; this.isBusy = true;
    this.experimentMessage = '正在执行真实任务，请勿切换模式或注入状态；可停止并导出已有结果。';
    try {
      const count: number = await ExperimentService.getInstance().run();
      this.experimentMessage = `实验结束：${count} 条搜索记录。请导出 JSON，结果包含失败与取消。`;
    } catch (error) { this.experimentMessage = `实验未完成：${error}`; }
    finally { this.experimentRunning = false; this.isBusy = false; this.refreshData(); }
  }

  private async exportRealExperiment(): Promise<void> {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.experimentMessage = await ExperimentService.getInstance().save(context, this.includeExperimentQualityIds);
    } catch (error) { this.experimentMessage = `导出失败：${error}`; }
  }

  private getModeBadgeTitle(mode: PolicyMode): string {
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '当前：固定高性能模式';
    }
    if (mode === PolicyMode.FIXED_POWER_SAVING) {
      return '当前：固定省电模式';
    }
    return '当前：自适应模式 (自动变档)';
  }

  @Builder
  private PowerBenchmarkCard() {
    Column({ space: 12 }) {
      Row() {
        Text('电池续航与手机计算速度')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#172B4D')
          .layoutWeight(1)

        Text(this.getModeBadgeTitle(this.policyMode))
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#175CD3')
          .backgroundColor('#EFF8FF')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .borderRadius(6)
      }
      .width('100%')

      Row({ space: 12 }) {
        // Battery Card Box
        Column({ space: 6 }) {
          Row({ space: 4 }) {
            Text('🔋')
              .fontSize(16)
            Text('电池续航')
              .fontSize(12)
              .fontColor('#344054')
              .fontWeight(FontWeight.Medium)
          }

          Text(this.getDynamicBatteryLifespan())
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#067647')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .padding(14)
        .backgroundColor('#ECFDF3')
        .borderRadius(12)
        .border({ width: 1, color: '#ABE5C6' })

        // Computing Speed Box
        Column({ space: 6 }) {
          Row({ space: 4 }) {
            Text('⚡')
              .fontSize(16)
            Text('计算速度')
              .fontSize(12)
              .fontColor('#344054')
              .fontWeight(FontWeight.Medium)
          }

          Text(this.getDynamicComputeSpeed())
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#175CD3')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .padding(14)
        .backgroundColor('#EFF8FF')
        .borderRadius(12)
        .border({ width: 1, color: '#B2DDFF' })
      }
      .width('100%')

      Row() {
        Text(this.getModeWattText(this.policyMode))
          .fontSize(11)
          .fontColor('#667085')
        Blank()
        Text('无功耗采样')
          .fontSize(11)
          .fontColor('#067647')
          .fontWeight(FontWeight.Medium)
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .border({ width: 1, color: '#EAECF0' })
  }

  @Builder
  private DecisionModelReasoningCard() {
    Column({ space: 10 }) {
      Row() {
        Text('调度规则与原因（模拟任务）')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#172B4D')
          .layoutWeight(1)
        Text('决策耗时未测量')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#067647')
          .backgroundColor('#ECFDF3')
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(4)
      }
      .width('100%')

      Text('此区域展示旧兼容接口的模拟等待任务。真实语义工作流请使用上方对照实验，配置不代表系统线程采样。')
        .fontSize(11)
        .fontColor('#475467')

      if (this.deviceState !== null) {
        Column({ space: 6 }) {
          Row({ space: 6 }) {
            Text(`SOC: ${this.batteryText(this.deviceState)}`)
              .fontSize(10)
              .fontWeight(FontWeight.Bold)
              .fontColor('#175CD3')
              .backgroundColor('#EFF8FF')
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .borderRadius(4)
            Text(`温控: ${this.thermalText(this.deviceState.thermalLevel)}`)
              .fontSize(10)
              .fontWeight(FontWeight.Bold)
              .fontColor('#B54708')
              .backgroundColor('#FEF6EE')
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .borderRadius(4)
            Text(`数据源: ${this.sourceText(this.deviceState.source)}`)
              .fontSize(10)
              .fontWeight(FontWeight.Bold)
              .fontColor('#344054')
              .backgroundColor('#F2F4F7')
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .borderRadius(4)
          }
          .width('100%')

          Column({ space: 4 }) {
            Text('模拟计划原因：')
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')

            Text(`① 模拟等待任务：${this.getSelectedProbeScenario().title} · ${this.getSelectedProbeScenario().description}`)
              .fontSize(11)
              .fontColor('#344054')
            Text(`② 状态向量：SOC ${this.batteryText(this.deviceState)} · ${this.chargingText(this.deviceState)} · ${this.thermalText(this.deviceState.thermalLevel)} · 队列 ${this.deviceState.queueDepth} · ${this.memoryPressureText(this.deviceState)}`)
              .fontSize(11)
              .fontColor('#344054')
            Text(`③ 任务 Spec：${this.getSelectedProbeScenario().capability} · ${this.getSelectedProbeScenario().taskType} · ${this.getSelectedProbeScenario().accuracyPreference} · 预算 ${this.getSelectedProbeScenario().latencyBudgetMs} ms`)
              .fontSize(11)
              .fontColor('#344054')
            Text(`④ 规则原因：${this.getLatestPlanReasonText()}`)
              .fontSize(11)
              .fontColor('#B54708')
            Text(`⑤ 模拟任务计划：${this.getLatestPlanOutputText()}`)
              .fontSize(11)
              .fontColor('#175CD3')
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(10)
          .backgroundColor('#F8FAFC')
          .borderRadius(8)
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(12)
    .border({ width: 1, color: '#EAECF0' })
  }

  @Builder
  private OsEvaluationMatrixCard() {
    Column({ space: 8 }) {
      Text('真实能力范围').fontSize(14).fontWeight(FontWeight.Bold)
      Text('已接入：CPU 文本编码、向量检索、128 行分块缓存。优先级由业务约束与状态决定，不使用固定业务评分。').fontSize(12)
      Text('未接入：图像识别、GPU/NPU 推理、硬件频率控制。下面的硬件注入仅测试策略分支。').fontSize(12)
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(12)
  }

  private formatTime(timestamp: number): string {
    const time: Date = new Date(timestamp);
    return `${this.twoDigits(time.getHours())}:${this.twoDigits(time.getMinutes())}:${this.twoDigits(time.getSeconds())}`;
  }

  private twoDigits(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
  }

  @Builder
  private sectionTitle(title: string, description: string) {
    Column({ space: 3 }) {
      Text(title)
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor('#172B4D')
        .width('100%')
      Text(description)
        .fontSize(12)
        .fontColor('#667085')
        .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  private stateCell(label: string, value: string) {
    Column({ space: 4 }) {
      Text(label)
        .fontSize(11)
        .fontColor('#667085')
      Text(value)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor('#172B4D')
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
    .padding(10)
    .backgroundColor('#F8FAFC')
    .borderRadius(10)
  }

  @Builder
  private metricCell(label: string, value: string) {
    Column({ space: 4 }) {
      Text(value)
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor('#175CD3')
      Text(label)
        .fontSize(11)
        .fontColor('#667085')
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
    .padding(10)
    .backgroundColor('#EEF4FF')
    .borderRadius(10)
  }

  @Builder
  private debugInjectionStatusBar() {
    Column({ space: 5 }) {
      Text('当前组合注入状态')
        .fontSize(12)
        .fontWeight(FontWeight.Bold)
        .fontColor('#172B4D')
      Text(this.debugInjectionStatusText)
        .fontSize(12)
        .fontColor('#175CD3')
      Text(this.debugInjectionRuntimeText())
        .fontSize(11)
        .fontColor('#475467')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(10)
    .backgroundColor('#F8FAFC')
    .border({ width: 1, color: '#D0D5DD' })
    .borderRadius(8)
  }

  @Builder
  private policyButton(label: string, mode: PolicyMode) {
    Button(label)
      .layoutWeight(1)
      .height(40)
      .fontSize(13)
      .fontWeight(this.policyMode === mode ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(this.policyMode === mode ? Color.White : '#344054')
      .backgroundColor(this.policyMode === mode ? '#175CD3' : '#F2F4F7')
      .enabled(this.isReady && !this.isBusy)
      .onClick(() => {
        this.changePolicy(mode);
      })
  }

  @Builder
  private probeButton(label: string, index: number) {
    Button(label)
      .layoutWeight(1)
      .height(36)
      .fontSize(11)
      .fontWeight(this.selectedProbeIndex === index ? FontWeight.Bold : FontWeight.Normal)
      .fontColor(this.selectedProbeIndex === index ? Color.White : '#344054')
      .backgroundColor(this.selectedProbeIndex === index ? '#175CD3' : '#F2F4F7')
      .enabled(this.isReady && !this.isBusy)
      .onClick(() => {
        this.changeProbeScenario(index);
      })
  }

  @Builder
  private logCard(entry: SchedulerLogEntry) {
    Column({ space: 7 }) {
      Row({ space: 8 }) {
        Text(entry.status)
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.statusColor(entry.status))
        Text(entry.capability)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor('#172B4D')
          .layoutWeight(1)
        Text(this.formatTime(entry.queuedAt))
          .fontSize(11)
          .fontColor('#98A2B3')
      }
      .width('100%')

      Row({ space: 6 }) {
        Text(this.planPrimaryLabel(entry.executionPlan))
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.planFontColor(entry.executionPlan))
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor(this.planBgColor(entry.executionPlan))
          .borderRadius(4)

        Text(this.planSecondaryLabel(entry.executionPlan))
          .fontSize(12)
          .fontColor('#475467')
      }

      Text(`排队 ${this.queueDurationText(entry)} · 执行 ${this.executionDurationText(entry)}`)
        .fontSize(11)
        .fontColor('#667085')
        .width('100%')

      if (entry.executionPlan.policyAudit !== undefined) {
        Text(`${entry.executionPlan.policyAudit.mode} / ${entry.executionPlan.policyAudit.version}`)
          .fontSize(11).width('100%').fontColor('#344054')
        Text(`基线 ${entry.executionPlan.policyAudit.baselineProfileId} · 影子 ${entry.executionPlan.policyAudit.shadowProfileId ?? '-'} · 执行 ${entry.executionPlan.policyAudit.actualProfileId}`)
          .fontSize(11).width('100%').fontColor('#344054')
        Text(`预测 ${Math.round(entry.executionPlan.prediction?.latencyMs ?? 0)} ms · 实际 ${entry.executionDurationMs ?? '-'} ms · 配置确认 ${entry.executionPlan.policyAudit.actualConfirmed === true ? '是' : '否'}`)
          .fontSize(11).width('100%').fontColor('#475467')
        Text(`回退 ${entry.executionPlan.policyAudit.fallbackReason ?? '无'} · 反馈 ${entry.telemetry?.userFeedback?.option ?? '无'}`)
          .fontSize(11).width('100%').fontColor('#475467')
      }

      if (entry.telemetry?.actual?.cloudRunId !== undefined) {
        Text(`云端 runId：${entry.telemetry?.actual?.cloudRunId}`)
          .fontSize(11).width('100%').fontColor('#344054').copyOption(CopyOptions.LocalDevice)
        Text(`关联 taskId：${entry.telemetry?.actual?.cloudTaskId ?? '未记录'}`)
          .fontSize(11).width('100%').fontColor('#344054').copyOption(CopyOptions.LocalDevice)
        Text(`请求 ${entry.telemetry?.actual?.cloudTiming?.requestMs ?? '未观测'} ms · 上传 ${entry.telemetry?.actual?.cloudTiming?.uploadMs ?? '未观测'} ms · 下载 ${entry.telemetry?.actual?.cloudTiming?.downloadMs ?? '未观测'} ms`)
          .fontSize(11).width('100%').fontColor('#475467')
      }

      if (entry.executionPlan.reasonCodes.length > 0) {
        Text(entry.executionPlan.reasonCodes.join(' / '))
          .fontSize(10)
          .fontColor('#667085')
          .maxLines(2)
          .width('100%')
      }
      if (entry.errorCode !== undefined) {
        Text(`错误：${entry.errorCode}`)
          .fontSize(11)
          .fontColor('#B42318')
          .width('100%')
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .backgroundColor(Color.White)
    .borderRadius(12)
    .border({ width: 1, color: '#EAECF0' })
  }

  build() {
    Column() {
      Row({ space: 10 }) {
        Button('返回')
          .height(36)
          .fontSize(13)
          .fontColor('#175CD3')
          .backgroundColor('#EEF4FF')
          .onClick(() => {
            router.back();
          })
        Column({ space: 2 }) {
          Text('调度中间件控制台')
            .fontSize(21)
            .fontWeight(FontWeight.Bold)
            .fontColor('#172B4D')
          Text('本地 CPU 任务 · 资源状态 · 受约束策略')
            .fontSize(11)
            .fontColor('#667085')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Button('刷新')
          .height(36)
          .fontSize(13)
          .fontColor('#344054')
          .backgroundColor('#F2F4F7')
          .onClick(() => {
            this.connectScheduler();
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 12 })
      .backgroundColor(Color.White)

      Scroll() {
        Column({ space: 16 }) {
          if (!this.isReady) {
            Column({ space: 10 }) {
              Text('调度中间件尚未就绪')
                .fontSize(18)
                .fontWeight(FontWeight.Bold)
                .fontColor('#B42318')
              Text(this.feedbackText)
                .fontSize(13)
                .fontColor('#667085')
              Button('重新连接')
                .onClick(() => {
                  this.connectScheduler();
                })
            }
            .width('100%')
            .padding(20)
            .backgroundColor('#FEF3F2')
            .borderRadius(14)
          } else {
            if (this.feedbackText.length > 0) {
              Text(this.feedbackText)
                .fontSize(12)
                .fontColor('#175CD3')
                .fontWeight(FontWeight.Medium)
                .width('100%')
                .padding(10)
                .backgroundColor('#EEF4FF')
                .borderRadius(8)
            }

            Column({ space: 10 }) {
              Text('策略闭环').fontSize(17).fontWeight(FontWeight.Bold).width('100%')
              Select([{ value: 'OBSERVE' }, { value: 'SHADOW' }])
                .enabled(!this.experimentRunning)
                .selected(this.closedLoopMode === ConstrainedPolicyMode.SHADOW ? 1 : 0)
                .value(this.closedLoopMode)
                .onSelect((index: number) => {
                  const policy = this.schedulerService.getConstrainedPolicy();
                  policy.version = `panel-${Date.now()}`;
                  policy.mode = index === 1 ? ConstrainedPolicyMode.SHADOW : ConstrainedPolicyMode.OBSERVE;
                  policy.rules = [{ capability: 'vector_retrieve',
                    allowedProfileIds: ['SEARCH_HIGH', 'SEARCH_SAFE', 'SEARCH_BALANCED', 'SEARCH_FAST'],
                    preferredProfileId: 'SEARCH_BALANCED' }];
                  policy.rolloutPercent = 0;
                  this.schedulerService.configureConstrainedPolicy(policy);
                  this.refreshMetricsAndLogs();
                })
              Text(`${this.closedLoopVersion} · ${this.policyStorageStatus}`).fontSize(11).width('100%')
              Text('CANARY / ACTIVE：待真机基线与质量验收').fontSize(12).fontColor('#667085').width('100%')
              Button('停用策略优化').fontSize(12).onClick(() => {
                this.schedulerService.disablePolicyOptimization(); this.refreshMetricsAndLogs();
              })
              Row() {
                Text('本地体验反馈').fontSize(14).layoutWeight(1)
                Toggle({ type: ToggleType.Switch, isOn: this.localFeedbackEnabled }).onChange((enabled: boolean) => {
                  this.schedulerService.setFeedbackEnabled(enabled); this.localFeedbackEnabled = enabled;
                })
              }.width('100%')
              Text('选项答案仅用于本机分析，不采集搜索词、图片或商品结果，不上传云端。')
                .fontSize(11).fontColor('#667085').width('100%')
              ForEach(this.profileMetrics.slice(-8), (group: PolicyMetricsGroup) => {
                Text(`${group.profileId} / ${group.cohort} / n=${group.count}\nP50 ${Math.round(group.p50Ms)} ms · P95 ${Math.round(group.p95Ms)} ms · 成功 ${Math.round(group.successRate * 100)}% · 回退 ${group.fallbackCount}`)
                  .fontSize(11).width('100%')
              })
            }.width('100%').alignItems(HorizontalAlign.Start)

            this.sectionTitle('设备状态 & 可用硬件后端', '感知端侧硬件能力与系统温度、电量')
            if (this.deviceState !== null) {
              Row({ space: 8 }) {
                this.stateCell('电量 SOC', this.batteryText(this.deviceState))
                this.stateCell('充电状态', this.chargingText(this.deviceState))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.stateCell('热等级 Thermal', this.thermalText(this.deviceState.thermalLevel))
                this.stateCell('应用状态', this.visibilityText(this.deviceState.appVisibility))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.stateCell('队列深度', `${this.deviceState.queueDepth}`)
                this.stateCell('近期耗时', this.latencyText(this.deviceState))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.stateCell('系统 CPU', this.cpuUsageText(this.deviceState.systemCpuUsage))
                this.stateCell('应用 CPU', this.cpuUsageText(this.deviceState.appCpuUsage))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.stateCell('系统内存', this.memoryRuntimeText(this.deviceState))
                this.stateCell('内存压力', this.memoryPressureText(this.deviceState))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.stateCell('空闲内存', this.deviceState.freeMemoryMb === null ? '未知' : `${Math.round(this.deviceState.freeMemoryMb)} MB`)
                this.stateCell('状态来源', this.sourceText(this.deviceState.source))
              }
              .width('100%')

              Column({ space: 6 }) {
                Text('可用硬件')
                  .fontSize(11)
                  .fontColor('#667085')
                Row({ space: 6 }) {
                  ForEach(this.deviceState.availableBackends, (backend: Backend) => {
                    Text(this.backendLabel(backend))
                      .fontSize(11)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(this.backendFontColor(backend))
                      .backgroundColor(this.backendBgColor(backend))
                      .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                      .borderRadius(6)
                  })
                }
                .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
              .padding(10)
              .backgroundColor('#F8FAFC')
              .borderRadius(10)
            }

            this.sectionTitle('策略模式切换', '固定模式用于对照实验，自适应模式用于主功能')
            Row({ space: 8 }) {
              this.policyButton('自适应模式', PolicyMode.ADAPTIVE)
              this.policyButton('固定高性能', PolicyMode.FIXED_PERFORMANCE)
              this.policyButton('固定省电', PolicyMode.FIXED_POWER_SAVING)
            }
            .width('100%')

            // Strategy Description Banner
            Column({ space: 5 }) {
              Text(this.policyBannerTitle(this.policyMode))
                .fontSize(13)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.policyBannerTitleColor(this.policyMode))

              Text(this.policyBannerDesc(this.policyMode))
                .fontSize(11)
                .fontColor('#475467')
                .lineHeight(16)
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(12)
            .backgroundColor(this.policyBannerBgColor(this.policyMode))
            .borderRadius(10)

            // Power & Battery Lifespan Benchmark Comparison Card
            this.sectionTitle('真实负载采样实验', 'CPU 文本推理、向量检索与分块缓存；不包含模拟等待任务')
            Text(this.experimentMessage).fontSize(13).width('100%')
            Button('运行真实采样实验').enabled(!this.isBusy).onClick(() => { this.runRealExperiment(); })
            Button('停止实验').enabled(this.experimentRunning).onClick(() => { ExperimentService.getInstance().cancel(); })
            Row() {
              Text('导出质量评测结果 ID（仅固定测试语料）').fontSize(13).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.includeExperimentQualityIds })
                .enabled(!this.experimentRunning)
                .onChange((enabled: boolean) => { this.includeExperimentQualityIds = enabled; })
            }.width('100%')
            Button('导出实验 JSON').enabled(!this.experimentRunning).onClick(() => { this.exportRealExperiment(); })
            this.PowerBenchmarkCard()

            // OS Edge AI Task Priority Assessment Matrix Card
            this.OsEvaluationMatrixCard()

            // Decision Model Reasoning Rationale Card
            this.DecisionModelReasoningCard()

            this.sectionTitle('调试仿真注入与场景模拟 (系统原生 API 默认实时监测中)', '默认通过 @kit.BasicServicesKit 实时监测手机电量与温度；以下按钮仅供调试测试故障注入')

            this.debugInjectionStatusBar()

            // Row 1: Backend selection buttons
            Text('1. 模拟可选择的硬件 Backend 组合：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 6 }) {
              Button('全异构 (NPU+GPU+CPU)')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .fontColor(this.backendSimulationFontColor())
                .backgroundColor(this.backendSimulationButtonColor())
                .enabled(this.canChangeBackendSimulation())
                .onClick(() => this.injectAllBackends())
              Button('CPU+NPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .fontColor(this.backendSimulationFontColor())
                .backgroundColor(this.backendSimulationButtonColor())
                .enabled(this.canChangeBackendSimulation())
                .onClick(() => this.injectCpuNpuBackends())
              Button('CPU+GPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .fontColor(this.backendSimulationFontColor())
                .backgroundColor(this.backendSimulationButtonColor())
                .enabled(this.canChangeBackendSimulation())
                .onClick(() => this.injectCpuGpuBackends())
              Button('仅 CPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .fontColor(this.backendSimulationFontColor())
                .backgroundColor(this.backendSimulationButtonColor())
                .enabled(this.canChangeBackendSimulation())
                .onClick(() => this.injectCpuOnlyBackend())
            }
            .width('100%')

            if (this.policyMode === PolicyMode.FIXED_POWER_SAVING) {
              Text('固定省电模式下轻量档绑定 CPU，硬件后端组合不会改变执行计划，因此暂时置灰。')
                .fontSize(11)
                .fontColor('#667085')
            }

            // Row 2: Environmental conditions
            Text('2. 电池与温度条件（可与第 3 组组合）：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 8 }) {
              Button('常温充电')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedEnvironmentScenario, 'NORMAL_CHARGING'))
                .backgroundColor(this.scenarioButtonColor(this.selectedEnvironmentScenario, 'NORMAL_CHARGING'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectNormalState())
              Button('低电量 12%')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedEnvironmentScenario, 'LOW_BATTERY'))
                .backgroundColor(this.scenarioButtonColor(this.selectedEnvironmentScenario, 'LOW_BATTERY'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectLowBatteryState())
              Button('高热 (HOT)')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedEnvironmentScenario, 'HOT'))
                .backgroundColor(this.scenarioButtonColor(this.selectedEnvironmentScenario, 'HOT'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectHotState())
            }
            .width('100%')

            Text('3. 负载与内存条件（与第 2 组叠加）：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 8 }) {
              Button('队列繁忙')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedPressureScenario, 'QUEUE_BUSY'))
                .backgroundColor(this.scenarioButtonColor(this.selectedPressureScenario, 'QUEUE_BUSY'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectQueuePressureState())
              Button('内存高压')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedPressureScenario, 'MEMORY_HIGH'))
                .backgroundColor(this.scenarioButtonColor(this.selectedPressureScenario, 'MEMORY_HIGH'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectMemoryPressureState())
              Button('内存临界')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .fontColor(this.scenarioButtonFontColor(this.selectedPressureScenario, 'MEMORY_CRITICAL'))
                .backgroundColor(this.scenarioButtonColor(this.selectedPressureScenario, 'MEMORY_CRITICAL'))
                .enabled(!this.isBusy)
                .onClick(() => this.injectCriticalMemoryState())
            }
            .width('100%')

            // Row 4: Control actions
            Row({ space: 8 }) {
              Button('清除注入')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .backgroundColor('#475467')
                .enabled(!this.isBusy)
                .onClick(() => this.clearDebugState())
              Button('暂停后台任务')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .backgroundColor('#B54708')
                .enabled(!this.isBusy)
                .onClick(() => this.pauseBackgroundTasks())
              Button('恢复后台任务')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .backgroundColor('#067647')
                .enabled(!this.isBusy)
                .onClick(() => this.resumeBackgroundTasks())
            }
            .width('100%')

            Text('4. 选择要验证的 AI 任务画像：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 8 }) {
              this.probeButton('图片 Embedding', 0)
              this.probeButton('文字 Embedding', 1)
              this.probeButton('后台索引', 2)
            }
            .width('100%')

            // Main Action Button
            Button(this.isBusy ? '调度评估中…' : `▶ 运行${this.getSelectedProbeScenario().title}`)
              .width('100%')
              .height(44)
              .fontSize(14)
              .fontWeight(FontWeight.Bold)
              .backgroundColor('#175CD3')
              .enabled(!this.isBusy)
              .onClick(() => this.runProbeTask())

            // Latest Execution Result Card
            if (this.latestProbeResult !== null) {
              Column({ space: 8 }) {
                Row() {
                  Text(`最新调度结果：${this.latestProbeScenarioTitle}`)
                    .fontSize(14)
                    .fontWeight(FontWeight.Bold)
                    .fontColor('#172B4D')
                    .layoutWeight(1)
                  Text(this.latestProbeResult.status)
                    .fontSize(12)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.statusColor(this.latestProbeResult.status))
                    .padding({ left: 8, right: 8, top: 2, bottom: 2 })
                    .backgroundColor('#ECFDF3')
                    .borderRadius(6)
                }
                .width('100%')

                Row({ space: 8 }) {
                  Text(this.planPrimaryLabel(this.latestProbeResult.executionPlan))
                    .fontSize(12)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.planFontColor(this.latestProbeResult.executionPlan))
                    .backgroundColor(this.planBgColor(this.latestProbeResult.executionPlan))
                    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                    .borderRadius(6)

                  Text(this.planSecondaryLabel(this.latestProbeResult.executionPlan))
                    .fontSize(12)
                    .fontWeight(FontWeight.Medium)
                    .fontColor('#344054')
                }

                Text(`排队耗时：${Math.round(this.latestProbeResult.queueDurationMs)} ms | 推理耗时：${Math.round(this.latestProbeResult.executionDurationMs)} ms | 总耗时：${Math.round(this.latestProbeResult.totalDurationMs)} ms`)
                  .fontSize(11)
                  .fontColor('#667085')

                if (this.latestProbeResult.executionPlan.reasonCodes.length > 0) {
                  Text(`决策依据：${this.latestProbeResult.executionPlan.reasonCodes.join(' / ')}`)
                    .fontSize(11)
                    .fontColor('#475467')
                }
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
              .padding(14)
              .backgroundColor(Color.White)
              .borderRadius(12)
              .border({ width: 1, color: '#D0D5DD' })
            }

            this.sectionTitle('运行指标统计', '最新任务即时反馈 + 最近窗口聚合')
            if (this.metrics !== null) {
              Row({ space: 8 }) {
                this.metricCell('最新任务', this.latestTaskMetricText())
                this.metricCell('最新状态', this.latestTaskStatusText())
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('调度评估', `${this.metrics.evaluationCount}`)
                this.metricCell('策略切换', `${this.metrics.policySwitchCount}`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('系统 CPU', this.deviceState === null ? '未知' : this.cpuUsageText(this.deviceState.systemCpuUsage))
                this.metricCell('可用内存', this.deviceState === null ? '未知' : this.memoryRuntimeText(this.deviceState))
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('运行中', `${this.metrics.runningCount}`)
                this.metricCell('排队/暂停', `${this.metrics.queuedCount}/${this.metrics.pausedCount}`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('最新执行', this.latestExecutionMetricText())
                this.metricCell('最新排队', this.latestQueueMetricText())
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('终态任务', `${this.metrics.taskCount}`)
                this.metricCell('P95 总耗时', `${Math.round(this.metrics.p95LatencyMs)} ms`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('降档次数', `${this.metrics.degradeCount}`)
                this.metricCell('失败/取消', `${this.metrics.failureCount}/${this.metrics.cancellationCount}`)
              }
              .width('100%')
            }

            this.sectionTitle('最近任务调度日志', '最多展示 20 条，最新记录位于最顶部')
            if (this.logs.length === 0) {
              Text('暂无任务日志，请点击上方“运行模拟调度任务”或返回首页执行检索')
                .fontSize(13)
                .fontColor('#667085')
                .width('100%')
                .padding(16)
                .backgroundColor(Color.White)
                .borderRadius(12)
            } else {
              ForEach(this.logs, (entry: SchedulerLogEntry) => {
                this.logCard(entry)
              }, (entry: SchedulerLogEntry) => `${entry.taskId}-${entry.status}-${entry.queuedAt}`)
            }
          }
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, top: 16, bottom: 32 })
      }
      .layoutWeight(1)
      .width('100%')
      .backgroundColor('#F5F7FA')
      .scrollBar(BarState.Auto)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F7FA')
  }
}
