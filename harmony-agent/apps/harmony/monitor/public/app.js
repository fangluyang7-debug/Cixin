const byId = (id) => document.getElementById(id);
const connection = byId('connection');
const pairDialog = byId('pairDialog');
const pairForm = byId('pairForm');
const pairCode = byId('pairCode');
const pairError = byId('pairError');
let token = sessionStorage.getItem('harmony-monitor-token') ?? '';
let lastReceivedAt = null;
let refreshing = false;

byId('pairButton').addEventListener('click', () => {
  pairCode.value = token;
  pairError.textContent = '';
  pairDialog.showModal();
});

pairForm.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  token = pairCode.value.trim();
  if (token.length < 12) {
    pairError.textContent = '配对码长度不足。';
    return;
  }
  sessionStorage.setItem('harmony-monitor-token', token);
  pairDialog.close();
  void refresh();
});

function setConnection(label, state = '') {
  connection.className = `connection ${state}`;
  connection.lastElementChild.textContent = label;
  byId('footerConnection').textContent = state === 'online' ? '遥测链路已同步' : label;
  byId('footerLed').className = `lens-led ${state === 'online' ? 'green' : state === 'offline' ? 'red' : 'off'}`;
}

async function refresh() {
  if (refreshing) return;
  if (!token) {
    setConnection('等待配对设置');
    if (!pairDialog.open) pairDialog.showModal();
    return;
  }
  refreshing = true;
  try {
    const response = await fetch('/api/snapshot', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401) {
      sessionStorage.removeItem('harmony-monitor-token');
      token = '';
      throw new Error('配对码无效');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    lastReceivedAt = result.receivedAt;
    if (result.snapshot) render(result.snapshot, result.receivedAt);
    else setConnection('等待手机首次上报');
  } catch (error) {
    setConnection(error instanceof Error ? error.message : '监控服务不可达', 'offline');
    if (!token && !pairDialog.open) pairDialog.showModal();
  } finally {
    refreshing = false;
  }
}

function render(snapshot, receivedAt) {
  const state = snapshot.state ?? {};
  const metrics = snapshot.metrics ?? {};
  const fresh = typeof receivedAt === 'number' && Date.now() - receivedAt <= 3000;
  byId('clockTick').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  byId('lastSeen').textContent = `接收 ${clock(receivedAt)} · 采样 ${clock(snapshot.capturedAt)}`;
  byId('receivedTime').textContent = clock(receivedAt);
  setConnection(fresh ? '手机遥测已连接' : '手机遥测已中断', fresh ? 'online' : 'offline');

  const battery = numberOrNull(state.batteryPercent);
  byId('metricBattery').textContent = battery === null ? '--' : battery.toFixed(0);
  setMeter('batteryBar', battery);
  byId('batteryState').textContent = state.isCharging === true ? '正在充电' :
    state.isCharging === false ? '未充电' : '充电状态未知';
  byId('batteryLed').className = `lens-led ${battery === null ? 'off' : battery < 15 ? 'red' : battery < 35 ? 'amber' : 'green'}`;

  const thermal = state.thermalLevel ?? 'UNKNOWN';
  byId('metricThermal').textContent = thermal;
  byId('thermalNote').textContent = thermal === 'UNKNOWN' ? '温度值未接入' : '系统热级 · 非摄氏温度';
  byId('thermalNote').className = `instrument-foot ${thermal === 'HOT' || thermal === 'CRITICAL' ? 'warning' : ''}`;
  byId('thermalLed').className = `lens-led ${thermalTone(thermal)}`;
  setMeter('thermalBar', ({ NORMAL: 25, WARM: 50, HOT: 75, CRITICAL: 100 })[thermal] ?? null);

  const systemCpu = numberOrNull(state.systemCpuUsage);
  const appCpu = numberOrNull(state.appCpuUsage);
  byId('metricCpu').textContent = systemCpu === null ? '--' : systemCpu.toFixed(1);
  byId('cpuSource').textContent = state.source ?? '--';
  byId('cpuSub').textContent = `App CPU ${appCpu === null ? '--' : `${appCpu.toFixed(1)}%`}`;
  setMeter('cpuBar', systemCpu);

  const available = numberOrNull(state.availableMemoryMb);
  const total = numberOrNull(state.totalMemoryMb);
  const free = numberOrNull(state.freeMemoryMb);
  byId('metricMemory').textContent = available === null ? '--' : available.toFixed(0);
  byId('memoryPressure').textContent = state.memoryPressure ?? 'UNKNOWN';
  byId('memoryInfo').textContent = `总量 ${total === null ? '--' : `${total.toFixed(0)} MB`} · 来源 ${state.source ?? '--'}`;
  setMeter('memoryBar', total !== null && total > 0 && free !== null ? Math.max(0, Math.min(100, (total - free) / total * 100)) : null);

  const running = numberOrNull(metrics.runningCount);
  const queued = numberOrNull(metrics.queuedCount);
  const paused = numberOrNull(metrics.pausedCount);
  byId('metricQueue').textContent = `${value(running)} / ${value(queued)}`;
  byId('queueSub').textContent = `暂停 ${value(paused)} · 深度 ${value(state.queueDepth)}`;
  byId('queueDepthLabel').textContent = `QUEUE DEPTH ${value(state.queueDepth)}`;
  byId('queueActivity').textContent = queued !== null && queued > 0 ? '存在排队任务' : running !== null && running > 0 ? '任务正在执行' : '当前无活动任务';
  byId('queueLed').className = `lens-led ${queued > 0 ? 'amber' : running > 0 ? 'green' : running === null ? 'off' : 'green'}`;

  const p95 = numberOrNull(metrics.p95LatencyMs);
  const average = numberOrNull(metrics.averageLatencyMs);
  byId('metricP95').textContent = p95 === null ? '--' : Math.round(p95).toString();
  byId('latencyInfo').textContent = `终态样本 ${value(metrics.taskCount)} · 平均 ${milliseconds(average)}`;
  byId('latencyIndicator').className = `lens-led ${p95 === null ? 'off' : 'cyan'}`;

  byId('policyMode').textContent = snapshot.policyMode ?? 'UNKNOWN';
  byId('policyModeFoot').textContent = snapshot.policyMode ?? 'UNKNOWN';
  byId('headerMode').textContent = snapshot.policyMode ?? 'UNKNOWN';
  byId('policyVersion').textContent = `VERSION ${snapshot.policyVersion || '--'}`;
  byId('sequence').textContent = value(snapshot.sequence);
  byId('footerSequence').textContent = value(snapshot.sequence);
  byId('policyLed').className = `lens-led ${fresh ? 'green' : 'amber'}`;

  byId('statEvaluations').textContent = value(metrics.evaluationCount);
  byId('statTasks').textContent = value(metrics.taskCount);
  byId('statAverage').textContent = milliseconds(average);
  byId('statQueueWait').textContent = milliseconds(numberOrNull(metrics.averageQueueDurationMs));
  byId('statDegrades').textContent = value(metrics.degradeCount);
  byId('statFailures').textContent = `${value(metrics.failureCount)} / ${value(metrics.cancellationCount)}`;
  byId('statSwitches').textContent = value(metrics.policySwitchCount);

  byId('sourceValue').textContent = state.source ?? 'UNKNOWN';
  byId('sampleTime').textContent = clock(state.capturedAt ?? state.sampledAt);
  byId('sourceThermal').textContent = thermal;
  byId('sourceMemory').textContent = state.memoryPressure ?? 'UNKNOWN';
  byId('stateCaptured').textContent = `CAPTURED ${clock(state.capturedAt)}`;
  setStateBadge(byId('visibilityBadge'), state.appVisibility ?? 'UNKNOWN');
  renderBackends(state.availableBackends ?? []);
  byId('healthCpu').textContent = percent(systemCpu);
  byId('healthCpuHint').textContent = `SYSTEM · ${state.source ?? '--'}`;
  byId('healthAppCpu').textContent = percent(appCpu);
  byId('healthMemory').textContent = available === null ? '--' : `${available.toFixed(0)} MB`;
  byId('healthMemoryHint').textContent = state.memoryPressure ?? 'UNKNOWN';
  byId('healthBattery').textContent = percent(battery);
  byId('healthCharging').textContent = state.isCharging === true ? 'CHARGING' : state.isCharging === false ? 'ON BATTERY' : 'UNKNOWN';
  byId('healthBackends').textContent = state.availableBackends?.length ? state.availableBackends.join(' / ') : '--';
  byId('healthFeedback').textContent = snapshot.feedbackEnabled === true ? 'ENABLED' : 'DISABLED';

  renderTasks(snapshot.activeTasks ?? []);
  renderEvents(snapshot.events ?? []);
}

function renderTasks(tasks) {
  byId('activeCount').textContent = `${tasks.length} ACTIVE`;
  const list = byId('activeTasks');
  list.replaceChildren();
  if (!tasks.length) {
    return emptyState(list, '当前没有活动任务');
  }
  for (const task of tasks) {
    const plan = task.executionPlan ?? {};
    const profile = plan.executionProfile ?? {};
    const prediction = plan.prediction ?? {};
    const row = document.createElement('article');
    row.className = 'task-row';

    const head = document.createElement('div');
    head.className = 'task-head';
    const name = document.createElement('span');
    name.className = 'task-name';
    name.textContent = task.capability ?? task.taskType ?? task.taskId ?? '--';
    const status = document.createElement('span');
    status.className = 'state-badge';
    setStateBadge(status, task.status ?? 'UNKNOWN');
    head.append(name, status);
    row.append(head);

    const id = document.createElement('div');
    id.className = 'task-id';
    id.textContent = task.taskId ?? '--';
    row.append(id);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    appendText(meta, `${task.taskType ?? '--'} · ${plan.queueAction ?? '--'}`);
    appendText(meta, `${milliseconds(prediction.latencyMs)} 预测`);
    row.append(meta);

    const config = document.createElement('div');
    config.className = 'task-plan';
    addChip(config, profile.id ?? plan.inferenceLocation ?? '--', true);
    addChip(config, `${profile.modelTier ?? '--'} · ${profile.backend ?? '--'}`);
    addChip(config, `${value(profile.workerCount)} WORKERS`);
    row.append(config);

    const foot = document.createElement('div');
    foot.className = 'task-foot';
    appendText(foot, `目标 ${milliseconds(task.targetLatencyMs)} · 截止 ${milliseconds(task.deadlineMs)}`);
    appendText(foot, task.highQuality ? 'QUALITY FLOOR' : 'STANDARD');
    row.append(foot);
    list.append(row);
  }
}

function renderEvents(events) {
  byId('eventCount').textContent = `${events.length} LOGS`;
  const list = byId('events');
  list.replaceChildren();
  if (!events.length) emptyState(list, '尚无已完成的调度事件');

  const newestFirst = events.slice().reverse();
  for (const event of newestFirst) {
    const row = document.createElement('article');
    row.className = 'event-row';
    row.dataset.status = event.status ?? 'UNKNOWN';

    const top = document.createElement('div');
    top.className = 'event-topline';
    const name = document.createElement('span');
    name.className = 'event-name';
    name.textContent = event.capability ?? event.taskType ?? event.taskId ?? '--';
    const time = document.createElement('time');
    time.className = 'event-time';
    time.textContent = clock(event.finishedAt ?? event.startedAt ?? event.queuedAt);
    top.append(name, time);
    row.append(top);

    const meta = document.createElement('div');
    meta.className = 'event-subline';
    appendText(meta, `${event.taskType ?? '--'} · ${event.status ?? '--'}`);
    appendText(meta, milliseconds(event.totalDurationMs));
    row.append(meta);

    const actual = event.telemetry?.actual ?? {};
    const plan = event.executionPlan ?? {};
    const audit = plan.policyAudit ?? {};
    const planned = plan.executionProfile?.id ?? '--';
    const executed = actual.profileId ?? (audit.actualConfirmed ? audit.actualProfileId : '未确认');
    const detail = document.createElement('div');
    detail.className = 'event-detail';
    detail.textContent = `排队 ${milliseconds(event.queueDurationMs)} · 执行 ${milliseconds(event.executionDurationMs)} · 计划 ${planned} / 实际 ${executed}`;
    row.append(detail);

    const reason = document.createElement('div');
    reason.className = 'event-reason';
    reason.textContent = audit.fallbackReason ?? plan.reasonCodes?.join(' · ') ?? '无额外策略原因码';
    row.append(reason);
    list.append(row);
  }

  renderLatestEvent(newestFirst[0] ?? null);
}

function renderLatestEvent(event) {
  const content = byId('latestDecision');
  const empty = byId('latestEmpty');
  if (!event) {
    content.hidden = true;
    empty.hidden = false;
    byId('latestStatus').textContent = '等待事件';
    byId('decisionTime').textContent = 'TIME --';
    return;
  }
  content.hidden = false;
  empty.hidden = true;
  const plan = event.executionPlan ?? {};
  const profile = plan.executionProfile ?? {};
  const prediction = plan.prediction ?? {};
  const audit = plan.policyAudit ?? {};
  const actual = event.telemetry?.actual ?? {};
  const confirmed = audit.actualConfirmed === true;

  byId('latestTaskTitle').textContent = `${event.capability ?? event.taskType ?? '--'} · ${event.status ?? '--'}`;
  byId('latestTaskMeta').textContent = `${event.taskId ?? '--'} · ${clock(event.finishedAt ?? event.startedAt ?? event.queuedAt)} · ${milliseconds(event.totalDurationMs)}`;
  byId('latestStatus').textContent = event.status ?? 'UNKNOWN';
  setStateBadge(byId('latestStatus'), event.status ?? 'UNKNOWN');
  byId('plannedProfile').textContent = profile.id ?? plan.inferenceLocation ?? '--';
  byId('plannedConfig').textContent = `${profile.modelTier ?? '--'} · ${profile.backend ?? '--'} · ${value(profile.workerCount)} workers · 预测 ${milliseconds(prediction.latencyMs)}`;
  byId('actualProfile').textContent = confirmed ? actual.profileId ?? audit.actualProfileId ?? '已确认' : '未确认';
  byId('actualConfig').textContent = confirmed ?
    `${actual.actualModelTier ?? '--'} · ${actual.actualBackend ?? '--'} · ${value(actual.actualThreads ?? actual.workerCount)} workers` :
    '没有执行器实际配置回执';
  byId('decisionReason').textContent = audit.fallbackReason ?? plan.reasonCodes?.join(' · ') ?? '未提供原因码';
  byId('decisionTime').textContent = `TIME ${clock(event.finishedAt ?? event.startedAt ?? event.queuedAt)}`;
  renderDecisionFlags(event);
}

function renderDecisionFlags(event) {
  const target = byId('decisionFlags');
  target.replaceChildren();
  const telemetry = event.telemetry ?? {};
  const flags = [];
  if (telemetry.deadlineMissed === true || telemetry.softDeadlineMissed === true) flags.push(['超出时限', 'warn']);
  if (telemetry.resultDisplayed === true) flags.push(['结果已展示', 'good']);
  if (telemetry.resultConsumed === true) flags.push(['结果已使用', 'good']);
  if (telemetry.mixedExecution === true) flags.push(['混合执行', 'warn']);
  if (!flags.length) flags.push(['无额外事件标记', '']);
  for (const [label, tone] of flags) {
    const chip = document.createElement('span');
    chip.className = `flag ${tone}`;
    chip.textContent = label;
    target.append(chip);
  }
}

function renderBackends(backends) {
  const target = byId('backendList');
  target.replaceChildren();
  if (!Array.isArray(backends) || !backends.length) {
    const empty = document.createElement('span');
    empty.className = 'muted-code';
    empty.textContent = 'UNKNOWN';
    target.append(empty);
    return;
  }
  for (const backend of backends) addChip(target, backend, backend === 'CPU');
}

function setStateBadge(element, value) {
  const state = String(value ?? 'UNKNOWN').toUpperCase();
  element.textContent = state;
  element.dataset.state = state;
}

function setMeter(id, value) {
  const meter = byId(id);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    meter.classList.add('is-unknown');
    meter.style.width = '0%';
    return;
  }
  meter.classList.remove('is-unknown');
  meter.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function thermalTone(level) {
  if (level === 'NORMAL') return 'green';
  if (level === 'WARM') return 'amber';
  if (level === 'HOT' || level === 'CRITICAL') return 'red';
  return 'off';
}

function emptyState(parent, message) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  parent.append(empty);
}

function addChip(parent, value, active = false) {
  const chip = document.createElement('span');
  chip.className = `data-chip${active ? ' active' : ''}`;
  chip.textContent = String(value ?? '--');
  parent.append(chip);
}

function appendText(parent, text) {
  const span = document.createElement('span');
  span.textContent = String(text ?? '--');
  parent.append(span);
}

function numberOrNull(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function value(value) { return value === undefined || value === null ? '--' : String(value); }
function percent(value) { return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '--'; }
function milliseconds(value) { return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : '--'; }
function clock(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

window.setInterval(() => {
  void refresh();
  if (lastReceivedAt && Date.now() - lastReceivedAt > 3000) setConnection('手机遥测已中断', 'offline');
}, 750);
void refresh();
