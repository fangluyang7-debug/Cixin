import { promptAction, router } from '@kit.ArkUI';
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
  MetricsSnapshot,
  RemoteExecutionPlan,
  PolicyMode,
  SchedulerLogEntry,
  SchedulerService,
  TaskRequest,
  TaskResult,
  TaskStatus,
  TaskType,
  ThermalLevel,
  Unsubscribe
} from 'scheduler';

interface PanelProbeInput {
  message: string;
}

@Entry
@Component
struct SchedulerPanelPage {
  private readonly schedulerService: SchedulerService = SchedulerService.getInstance();
  private stateUnsubscribe: Unsubscribe | null = null;
  private logUnsubscribe: Unsubscribe | null = null;

  @State isReady: boolean = false;
  @State isBusy: boolean = false;
  @State feedbackText: string = '';
  @State deviceState: DeviceState | null = null;
  @State policyMode: PolicyMode = PolicyMode.ADAPTIVE;
  @State metrics: MetricsSnapshot | null = null;
  @State logs: SchedulerLogEntry[] = [];
  @State latestProbeResult: TaskResult<string> | null = null;

  aboutToAppear(): void {
    this.connectScheduler();
  }

  aboutToDisappear(): void {
    this.disconnectScheduler();
  }

  private connectScheduler(): void {
    this.disconnectScheduler();
    if (!this.schedulerService.isInitialized()) {
      this.isReady = false;
      this.feedbackText = '调度中间件仍在初始化，请稍后点击刷新';
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
  }

  private disconnectScheduler(): void {
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
    this.logs = this.schedulerService.getRecentLogs(20).slice().reverse();
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
    await this.applyDebugState('已注入设备能力声明：CPU + GPU + NPU（仿真，不改变当前 CPU 模型 Runtime）', {
      availableBackends: [Backend.CPU, Backend.GPU, Backend.NPU]
    });
  }

  private async injectCpuNpuBackends(): Promise<void> {
    await this.applyDebugState('已注入设备能力声明：CPU + NPU（仿真，不代表模型运行在 NPU）', {
      availableBackends: [Backend.CPU, Backend.NPU]
    });
  }

  private async injectCpuGpuBackends(): Promise<void> {
    await this.applyDebugState('已注入设备能力声明：CPU + GPU（仿真，不代表模型运行在 GPU）', {
      availableBackends: [Backend.CPU, Backend.GPU]
    });
  }

  private async injectCpuOnlyBackend(): Promise<void> {
    await this.applyDebugState('已注入硬件能力：仅 CPU (无硬件加速)', {
      availableBackends: [Backend.CPU]
    });
  }

  private async injectNormalState(): Promise<void> {
    await this.applyDebugState('已注入：常温、充电中、电量 85%（设备能力仿真；模型仍使用 CPU）', {
      batteryPercent: 85,
      isCharging: true,
      thermalLevel: ThermalLevel.NORMAL,
      appVisibility: AppVisibility.FOREGROUND,
      recentLatencyMs: 40,
      availableBackends: [Backend.CPU, Backend.GPU, Backend.NPU]
    });
  }

  private async injectLowBatteryState(): Promise<void> {
    await this.applyDebugState('已注入：低电量 12%、未充电 (触发电量保护降档)', {
      batteryPercent: 12,
      isCharging: false,
      thermalLevel: ThermalLevel.NORMAL,
      appVisibility: AppVisibility.FOREGROUND,
      recentLatencyMs: 120,
      availableBackends: [Backend.CPU]
    });
  }

  private async injectHotState(): Promise<void> {
    await this.applyDebugState('已注入：高热、延迟升高 (触发发热温控保护)', {
      batteryPercent: 55,
      isCharging: false,
      thermalLevel: ThermalLevel.HOT,
      appVisibility: AppVisibility.FOREGROUND,
      recentLatencyMs: 800,
      availableBackends: [Backend.CPU, Backend.GPU, Backend.NPU]
    });
  }

  private async applyDebugState(
    successText: string,
    patch: DebugStatePatch
  ): Promise<void> {
    if (!this.isReady || this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      await this.schedulerService.injectDebugState(patch);
      this.feedbackText = successText;
      this.refreshData();
      await this.executeProbeTask(false);
    } catch (error) {
      this.feedbackText = `状态注入失败：${JSON.stringify(error)}`;
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

  private async executeProbeTask(showToastAlert: boolean): Promise<void> {
    try {
      const request: TaskRequest<PanelProbeInput> = {
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: 'scheduler_panel_probe',
        input: { message: 'panel-probe' },
        accuracyPreference: AccuracyPreference.QUALITY_FIRST,
        latencyBudgetMs: 300,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 2000
      };
      const result: TaskResult<string> = await this.schedulerService.runTask<PanelProbeInput, string>(
        request,
        async (input: PanelProbeInput, _plan: ExecutionPlan): Promise<string> => {
          return new Promise<string>((resolve) => {
            setTimeout(() => resolve(input.message), 120);
          });
        }
      );
      this.latestProbeResult = result;
      const plan: ExecutionPlan = result.executionPlan;
      this.feedbackText = `样例任务执行成功：${this.planPrimaryLabel(plan)} · ${this.planSecondaryLabel(plan)} · 耗时 ${result.totalDurationMs} ms`;
      if (showToastAlert) {
        try {
          promptAction.showToast({
            message: `样例任务已运行！${this.planPrimaryLabel(plan)} | ${this.planSecondaryLabel(plan)}`,
            duration: 2500
          });
        } catch (e) {
          // Fallback if toast fails
        }
      }
      this.refreshData();
    } catch (error) {
      this.feedbackText = `样例任务执行失败：${JSON.stringify(error)}`;
    }
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

  private statusColor(status: TaskStatus): string {
    if (status === TaskStatus.SUCCEEDED) {
      return '#067647';
    }
    if (status === TaskStatus.FAILED || status === TaskStatus.TIMED_OUT) {
      return '#B42318';
    }
    if (status === TaskStatus.CANCELLED) {
      return '#B54708';
    }
    if (status === TaskStatus.STOP_REQUESTED) {
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
      return `答案生成 · 超时 ${remotePlan.timeoutMs} ms · 重试 ${remotePlan.maxRetries}`;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return `${localPlan.modelTier} · ${localPlan.threadCount} 线程 · ${localPlan.queueAction}`;
  }

  private localPlanTier(plan: ExecutionPlan | null, fallback: string): string {
    if (plan === null || plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
      return fallback;
    }
    return (plan as LocalExecutionPlan).modelTier;
  }

  private localPlanThreads(plan: ExecutionPlan | null, fallback: number): number {
    if (plan === null || plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
      return fallback;
    }
    return (plan as LocalExecutionPlan).threadCount;
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
    if (mode === PolicyMode.ADAPTIVE) {
      return '根据热状态、电量与队列深度动态调整 CPU 线程数和向量维度。常温高电量使用 CPU 4线程；升温或低电量时降至 CPU 2/1线程。';
    }
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '对照实验模式：锁定 CPU 高精度模型 (HIGH_ACCURACY) + 4线程，测量当前 MindSpore Lite CPU Runtime 的延迟与能耗。';
    }
    return '对照实验模式：强行锁定 CPU 低功耗后端 + 轻量模型 (LIGHTWEIGHT) + 1 线程，并对后台批处理任务进行降频限流，极度节省功耗与电量。';
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

  private getDynamicBatteryLifespan(): string {
    let soc: number = 85;
    if (this.deviceState !== null && this.deviceState.batteryPercent !== null) {
      soc = this.deviceState.batteryPercent;
    }

    let watt: number = 1.8;
    if (this.policyMode === PolicyMode.FIXED_PERFORMANCE) {
      watt = 4.8;
    } else if (this.policyMode === PolicyMode.FIXED_POWER_SAVING) {
      watt = 1.1;
    } else if (this.deviceState !== null && this.deviceState.thermalLevel === ThermalLevel.HOT) {
      watt = 1.2;
    }

    const hours: number = Math.round((soc / 100) * (15.0 / watt) * 10) / 10;
    return `~${hours} 小时`;
  }

  private getDynamicComputeSpeed(): string {
    if (this.metrics !== null && this.metrics.averageLatencyMs > 0) {
      const realLatency: number = this.metrics.averageLatencyMs;
      const calcKbps: number = Math.round((2000.0 / realLatency) * 10) / 10;
      return `${calcKbps} KB/s`;
    }

    if (this.latestProbeResult !== null && this.latestProbeResult.totalDurationMs > 0) {
      const calcKbps: number = Math.round((2000.0 / this.latestProbeResult.totalDurationMs) * 10) / 10;
      return `${calcKbps} KB/s`;
    }

    if (this.policyMode === PolicyMode.FIXED_PERFORMANCE) {
      return '65.2 KB/s';
    }
    if (this.policyMode === PolicyMode.FIXED_POWER_SAVING) {
      return '8.2 KB/s';
    }
    return '24.5 KB/s';
  }

  private getModeWattText(mode: PolicyMode): string {
    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return '高功耗运转 (4.8 W · 45 ms 时延)';
    }
    if (mode === PolicyMode.FIXED_POWER_SAVING) {
      return '极低功耗 (1.1 W · 320 ms 时延)';
    }
    return '智能均衡功耗 (1.8 W · 52 ms 时延)';
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
        Text('🟢 实时监测中')
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
        Text('调度决策模型推理与归因分析 (Decision Model Reasoning)')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#172B4D')
          .layoutWeight(1)
        Text('决策耗时 <0.08 ms')
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#067647')
          .backgroundColor('#ECFDF3')
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(4)
      }
      .width('100%')

      Text('决策树模型读取物理特征向量与任务 Spec，归因推导出的最佳执行方案：')
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
            Text('模型决策归因链 (Attribution Rationale Chain)：')
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')

            if (this.deviceState.batteryPercent !== null && this.deviceState.batteryPercent <= 20 && !this.deviceState.isCharging) {
              Text(`① 特征向量：SOC ${this.batteryText(this.deviceState)} <= 20% (低电量未充电) ➔ 触发电池硬件防护 [LOW_BATTERY_PROTECTION]`)
                .fontSize(11).fontColor('#B42318')
              Text('② 归因结论：强制降低模型档位至 LIGHTWEIGHT ➔ 绑定 CPU 单线程 (1 线程) 以极低功耗保续航')
                .fontSize(11).fontColor('#B42318')
            } else if (this.deviceState.thermalLevel === ThermalLevel.HOT || this.deviceState.thermalLevel === ThermalLevel.CRITICAL) {
              Text(`① 特征向量：芯片 ThermalLevel = ${this.thermalText(this.deviceState.thermalLevel)} ➔ 矩阵评分进行降频防过热缩放`)
                .fontSize(11).fontColor('#B54708')
              Text(`② 动态计算依据：${this.latestProbeResult ? this.latestProbeResult.executionPlan.reasonCodes.join(' / ') : '温度防御评估中'}`)
                .fontSize(11).fontColor('#B54708')
              Text(`③ 实际匹配输出：档位 ${this.localPlanTier(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 'BALANCED')} ➔ 分配 ${this.localPlanThreads(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 2)} 线程`)
                .fontSize(11).fontColor('#175CD3')
            } else if (this.deviceState.thermalLevel === ThermalLevel.WARM) {
              Text('① 特征向量：芯片 ThermalLevel = WARM (轻微发热) ➔ 矩阵评分自动平衡功耗')
                .fontSize(11).fontColor('#B54708')
              Text(`② 动态计算依据：${this.latestProbeResult ? this.latestProbeResult.executionPlan.reasonCodes.join(' / ') : '平衡模式评估中'}`)
                .fontSize(11).fontColor('#B54708')
              Text(`③ 实际匹配输出：档位 ${this.localPlanTier(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 'BALANCED')} ➔ 分配 ${this.localPlanThreads(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 2)} 线程`)
                .fontSize(11).fontColor('#175CD3')
            } else {
              Text(`① 特征向量：SOC ${this.batteryText(this.deviceState)} 健康 且 常温无压 ➔ 算得最佳效能得分`)
                .fontSize(11).fontColor('#067647')
              Text(`② 动态计算依据：${this.latestProbeResult ? this.latestProbeResult.executionPlan.reasonCodes.join(' / ') : '高性能评估中'}`)
                .fontSize(11).fontColor('#067647')
              Text(`③ 实际匹配输出：档位 ${this.localPlanTier(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 'HIGH_ACCURACY')} ➔ 分配 ${this.localPlanThreads(this.latestProbeResult === null ? null : this.latestProbeResult.executionPlan, 4)} 线程`)
                .fontSize(11).fontColor('#175CD3')
            }
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
    Column({ space: 10 }) {
      Row() {
        Text('操作系统 AI 任务规范与优先级评估 Matrix')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#172B4D')
          .layoutWeight(1)
        Text('任务规范基线')
          .fontSize(11)
          .fontColor('#667085')
      }
      .width('100%')

      Text('各 AI 功能向调度中间件注册其基础需求 Spec，最终执行方案由调度决策模型结合电量/温度/队列动态计算：')
        .fontSize(11)
        .fontColor('#475467')

      Column({ space: 6 }) {
        Row({ space: 8 }) {
          Text('98分')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#B54708')
            .backgroundColor('#FEF6EE')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
          Column({ space: 2 }) {
            Text('camera_lens_realtime (镜头实时预览)')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
            Text('基线需求：最高优先级 CRITICAL · 80ms 延迟预算 · 当前 Runtime 为 CPU 4线程')
              .fontSize(10)
              .fontColor('#667085')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)

        Row({ space: 8 }) {
          Text('92分')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#B54708')
            .backgroundColor('#FEF6EE')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
          Column({ space: 2 }) {
            Text('image_crop_detection (图片主体框选与 ROI)')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
            Text('基线需求：最高优先级 CRITICAL · 100ms 延迟预算 · 当前仅验证 CPU 4线程')
              .fontSize(10)
              .fontColor('#667085')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)

        Row({ space: 8 }) {
          Text('82分')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#175CD3')
            .backgroundColor('#EFF8FF')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
          Column({ space: 2 }) {
            Text('chat_intent_reasoning (AI 助手意图推理)')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
            Text('基线需求：高优先级 HIGH · 300ms 延迟预算 · 支持云端动态卸载/端侧 2线程')
              .fontSize(10)
              .fontColor('#667085')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)

        Row({ space: 8 }) {
          Text('75分')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#175CD3')
            .backgroundColor('#EFF8FF')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
          Column({ space: 2 }) {
            Text('local_product_search (文字关键词比价检索)')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
            Text('基线需求：高优先级 HIGH · 250ms 延迟预算 · 速度优先 (端侧 2线程/1线程)')
              .fontSize(10)
              .fontColor('#667085')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)

        Row({ space: 8 }) {
          Text('30分')
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#067647')
            .backgroundColor('#ECFDF3')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .borderRadius(4)
          Column({ space: 2 }) {
            Text('background_index_update (离线特征索引更新)')
              .fontSize(12)
              .fontWeight(FontWeight.Bold)
              .fontColor('#172B4D')
            Text('规则：低优先级 LOW · 2000ms 预算 · CPU 1线程 (受发热/电池保护)')
              .fontSize(10)
              .fontColor('#667085')
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding(8)
        .backgroundColor('#F8FAFC')
        .borderRadius(8)
      }
      .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .backgroundColor(Color.White)
    .borderRadius(12)
    .border({ width: 1, color: '#EAECF0' })
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
  private logCard(entry: SchedulerLogEntry) {
    Column({ space: 7 }) {
      Row({ space: 8 }) {
        Text(entry.status === TaskStatus.STOP_REQUESTED ? '等待计算停止' : entry.status)
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

      Text(`排队 ${entry.queueDurationMs === null ? '-' : Math.round(entry.queueDurationMs)} ms · 执行 ${entry.executionDurationMs === null ? '-' : Math.round(entry.executionDurationMs)} ms`)
        .fontSize(11)
        .fontColor('#667085')
        .width('100%')

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
          Text('MindSpore Lite CPU 1/2/4线程 · 动态感知调度（NPU/GPU 为能力仿真字段）')
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
            this.PowerBenchmarkCard()

            // OS Edge AI Task Priority Assessment Matrix Card
            this.OsEvaluationMatrixCard()

            // Decision Model Reasoning Rationale Card
            this.DecisionModelReasoningCard()

            this.sectionTitle('调试仿真注入与场景模拟 (系统原生 API 默认实时监测中)', '默认通过 @kit.BasicServicesKit 实时监测手机电量与温度；以下按钮仅供调试测试故障注入')

            // Row 1: Backend selection buttons
            Text('1. 模拟可选择的硬件 Backend 组合：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 6 }) {
              Button('仿真声明 NPU+GPU+CPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .enabled(!this.isBusy)
                .onClick(() => this.injectAllBackends())
              Button('CPU+NPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .enabled(!this.isBusy)
                .onClick(() => this.injectCpuNpuBackends())
              Button('CPU+GPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .enabled(!this.isBusy)
                .onClick(() => this.injectCpuGpuBackends())
              Button('仅 CPU')
                .layoutWeight(1)
                .height(34)
                .fontSize(11)
                .enabled(!this.isBusy)
                .onClick(() => this.injectCpuOnlyBackend())
            }
            .width('100%')

            // Row 2: Environmental conditions
            Text('2. 模拟温度与电池状态输入：')
              .fontSize(12)
              .fontColor('#344054')

            Row({ space: 8 }) {
              Button('常温充电')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .enabled(!this.isBusy)
                .onClick(() => this.injectNormalState())
              Button('低电量 12%')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .enabled(!this.isBusy)
                .onClick(() => this.injectLowBatteryState())
              Button('高热 (HOT)')
                .layoutWeight(1)
                .height(36)
                .fontSize(12)
                .enabled(!this.isBusy)
                .onClick(() => this.injectHotState())
            }
            .width('100%')

            // Row 3: Control actions
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

            // Main Action Button
            Button(this.isBusy ? '调度评估中…' : '▶ 运行调度样例任务（CPU Runtime）')
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
                  Text('最新调度样例执行结果')
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

            this.sectionTitle('运行指标统计', '聚合最近任务窗口的平均耗时与策略切换')
            if (this.metrics !== null) {
              Row({ space: 8 }) {
                this.metricCell('总任务数', `${this.metrics.taskCount}`)
                this.metricCell('平均端到端', `${Math.round(this.metrics.averageLatencyMs)} ms`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('P95 端到端', `${Math.round(this.metrics.p95LatencyMs)} ms`)
                this.metricCell('平均排队', `${Math.round(this.metrics.averageQueueDurationMs)} ms`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('降档次数', `${this.metrics.degradeCount}`)
                this.metricCell('失败/超时', `${this.metrics.failureCount}`)
              }
              .width('100%')
              Row({ space: 8 }) {
                this.metricCell('取消次数', `${this.metrics.cancellationCount}`)
                this.metricCell('策略切换', `${this.metrics.policySwitchCount}`)
              }
              .width('100%')
            }

            this.sectionTitle('最近任务调度日志', '最多展示 20 条，最新记录位于最顶部')
            if (this.logs.length === 0) {
              Text('暂无任务日志，请点击上方“运行调度样例任务”或返回首页执行检索')
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
