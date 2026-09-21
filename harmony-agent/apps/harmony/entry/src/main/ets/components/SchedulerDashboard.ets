import { ActiveTaskSnapshot, SchedulerLogEntry } from 'scheduler';
import { SchedulerLiveFeed, SchedulerLiveSnapshot } from '../services/SchedulerLiveFeed';

@Component
export struct SchedulerDashboard {
  @Prop feedbackStatus: string = '';
  onClose: () => void = () => {};
  onSettings: () => void = () => {};
  private feed: SchedulerLiveFeed = new SchedulerLiveFeed();
  @State snapshot: SchedulerLiveSnapshot | null = null;
  @State frozen: boolean = false;
  aboutToAppear(): void { this.feed.start((value: SchedulerLiveSnapshot) => { if (!this.frozen) { this.snapshot = value; } }); }
  aboutToDisappear(): void { this.feed.stop(); }
  private metric(value: number | null | undefined, unit: string): string {
    return value === null || value === undefined ? '--' : `${value.toFixed(1)}${unit}`;
  }
  @Builder
  private Instrument(title: string, value: string) {
    Column({ space: 5 }) {
      Text(title).fontSize(10).fontColor('#BAC9CC').width('100%')
      Text(value).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#F5CE62').maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
    }.width('48%').height(62).padding(8).border({ width: 1, color: '#47432B' }).borderRadius(4)
  }
  @Builder
  private ActiveTask(task: ActiveTaskSnapshot) {
    Column({ space: 4 }) {
      Text(`${task.capability} · ${task.status}`).fontSize(12).fontColor('#4EDEA3').width('100%')
      Text(`计划 ${task.executionPlan.executionProfile?.id ?? task.executionPlan.inferenceLocation} · ${task.executionPlan.queueAction}`)
        .fontSize(11).fontColor('#E2E2E6').width('100%')
      Text(`目标 ${task.targetLatencyMs ?? '--'} / 截止 ${task.deadlineMs ?? '--'} ms · 高质量 ${task.highQuality === true ? '是' : '否'}`)
        .fontSize(10).fontColor('#BAC9CC').width('100%')
      Text(task.taskId).fontSize(9).fontColor('#849396').width('100%')
    }.width('100%').padding({ top: 6, bottom: 6 })
  }
  @Builder
  private Event(entry: SchedulerLogEntry) {
    Column({ space: 4 }) {
      Text(`${entry.status} · ${entry.capability}`).fontSize(11).fontColor('#F5CE62').width('100%')
      Text(`计划 ${entry.executionPlan.executionProfile?.id ?? '--'} / 实际 ${entry.telemetry?.actual?.profileId ?? '未确认'}`)
        .fontSize(10).fontColor('#E2E2E6').width('100%')
      Text(`来源 ${entry.deviceState.source} · 总耗时 ${entry.totalDurationMs ?? '--'} ms · ${entry.executionPlan.policyAudit?.mode ?? 'LEGACY'}`)
        .fontSize(10).fontColor('#BAC9CC').width('100%')
      Text(entry.executionPlan.reasonCodes.join(' / ')).fontSize(9).fontColor('#849396').width('100%')
      if (entry.telemetry?.feedbackRequest !== undefined) {
        Text(`提问 P${entry.telemetry.feedbackRequest.priority ?? '--'} · ${entry.telemetry.feedbackRequest.selectionReason ?? '--'}`)
          .fontSize(9).fontColor('#BAC9CC').width('100%')
      }
      if (entry.telemetry?.feedbackReceipt !== undefined) {
        Text(`反馈 ${entry.telemetry.feedbackReceipt.effect} · 时延权重 ${entry.telemetry.feedbackReceipt.after?.latencyWeight ?? '--'}`)
          .fontSize(10).fontColor('#4EDEA3').width('100%')
      }
    }.width('100%').padding({ top: 8, bottom: 8 }).border({ width: { bottom: 1 }, color: '#333538' })
  }
  build() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('手机调度仪表盘').fontSize(14).fontWeight(FontWeight.Bold).fontColor('#F5CE62').layoutWeight(1)
        Button(this.frozen ? '恢复画面' : '冻结画面').fontSize(10).height(30).backgroundColor('#282A2D')
          .fontColor('#E2E2E6').onClick(() => { this.frozen = !this.frozen; })
        Button({ type: ButtonType.Circle }) {
          Image($r('sys.media.ohos_ic_public_close')).width(16).height(16).fillColor('#E2E2E6')
        }.width(30).height(30).backgroundColor('#282A2D').accessibilityText('关闭仪表盘').onClick(this.onClose)
      }.width('100%')
      Scroll() {
        Column({ space: 8 }) {
          Text(this.snapshot?.connected === true ?
            `${this.frozen ? '画面冻结' : '实时'} · ${this.snapshot.state?.source} · ${this.snapshot.policyMode} · ${new Date(this.snapshot.capturedAt).toLocaleTimeString()}` : '调度器未连接')
            .fontSize(11).fontColor('#4EDEA3').width('100%')
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            this.Instrument('电池电量', this.metric(this.snapshot?.state?.batteryPercent, '%'))
            this.Instrument('系统 CPU', this.metric(this.snapshot?.state?.systemCpuUsage, '%'))
            this.Instrument('可用内存', this.metric(this.snapshot?.state?.availableMemoryMb, ' MB'))
            this.Instrument('热状态级别', this.snapshot?.state?.thermalLevel ?? 'UNKNOWN')
          }.width('100%')
          Text(`运行 ${this.snapshot?.metrics?.runningCount ?? '--'} · 排队 ${this.snapshot?.metrics?.queuedCount ?? '--'} · 暂停 ${this.snapshot?.metrics?.pausedCount ?? '--'}`)
            .fontSize(12).fontColor('#E2E2E6').width('100%')
          Text(`窗口终态 ${this.snapshot?.metrics?.taskCount ?? 0} · P95 ${this.snapshot?.metrics?.taskCount ? this.metric(this.snapshot.metrics.p95LatencyMs, ' ms') : '--'}`)
            .fontSize(11).fontColor('#BAC9CC').width('100%')
          Text('NPU / GPU / 功率 / 云 RTT：无采集数据').fontSize(10).fontColor('#849396').width('100%')
          Text(this.feedbackStatus || '暂无体验题状态').fontSize(11).fontColor('#F5CE62').width('100%')
          Text('活动任务').fontSize(13).fontWeight(FontWeight.Bold).fontColor('#E2E2E6').width('100%')
          if ((this.snapshot?.activeTasks.length ?? 0) === 0) { Text('当前无活动任务').fontSize(11).fontColor('#849396').width('100%') }
          ForEach(this.snapshot?.activeTasks ?? [], (task: ActiveTaskSnapshot) => { this.ActiveTask(task) }, (task: ActiveTaskSnapshot) => task.taskId)
          Text('最近调度事件').fontSize(13).fontWeight(FontWeight.Bold).fontColor('#E2E2E6').width('100%')
          ForEach(this.snapshot?.events ?? [], (entry: SchedulerLogEntry) => { this.Event(entry) },
            (entry: SchedulerLogEntry, index: number) => `${entry.taskId}:${entry.status}:${index}`)
          Button('策略与实验控制台').fontSize(11).height(32).backgroundColor('#282A2D').fontColor('#E2E2E6').onClick(this.onSettings)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Auto)
    }.width('100%').height('100%').padding(10).backgroundColor('#111316').borderRadius(4)
      .border({ width: 1, color: '#71602A' })
  }
}
