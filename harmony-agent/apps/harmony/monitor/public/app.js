const connection = document.querySelector('#connection');
const pairDialog = document.querySelector('#pairDialog');
const pairForm = document.querySelector('#pairForm');
const pairCode = document.querySelector('#pairCode');
const pairError = document.querySelector('#pairError');
let token = sessionStorage.getItem('harmony-monitor-token') ?? '';
let lastReceivedAt = null;

document.querySelector('#pairButton').addEventListener('click', () => {
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

async function refresh() {
  if (!token) {
    connection.className = 'connection';
    connection.lastElementChild.textContent = '请先输入配对码';
    if (!pairDialog.open) pairDialog.showModal();
    return;
  }
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
    else setConnection('等待手机首次上报', '');
  } catch (error) {
    setConnection(error instanceof Error ? error.message : '监控服务不可达', 'offline');
    if (!token && !pairDialog.open) pairDialog.showModal();
  }
}

function render(snapshot, receivedAt) {
  const state = snapshot.state ?? {};
  const metrics = snapshot.metrics ?? {};
  document.querySelector('#cpu').textContent = percent(state.systemCpuUsage);
  document.querySelector('#appCpu').textContent = percent(state.appCpuUsage);
  document.querySelector('#cpuSource').textContent = `来源 ${state.source ?? '--'}`;
  document.querySelector('#memory').textContent = mb(state.availableMemoryMb);
  document.querySelector('#memoryState').textContent = state.memoryPressure ?? 'UNKNOWN';
  document.querySelector('#thermal').textContent = state.thermalLevel ?? 'UNKNOWN';
  document.querySelector('#battery').textContent = `电量 ${percent(state.batteryPercent)} · ${state.appVisibility ?? '--'}`;
  document.querySelector('#queue').textContent = `${value(metrics.runningCount)} / ${value(metrics.queuedCount)}`;
  document.querySelector('#paused').textContent = `暂停 ${value(metrics.pausedCount)}`;
  document.querySelector('#p95').textContent = milliseconds(metrics.p95LatencyMs);
  document.querySelector('#taskCount').textContent = `终态样本 ${value(metrics.taskCount)}`;
  document.querySelector('#mode').textContent = `${snapshot.policyMode ?? '--'} · ${snapshot.policyVersion ?? '--'}`;
  document.querySelector('#sequence').textContent = `序列 ${value(snapshot.sequence)}`;
  setConnection('手机遥测已连接', 'online');
  document.querySelector('#lastSeen').textContent = `最近收到 ${new Date(receivedAt).toLocaleTimeString('zh-CN', { hour12: false })} · ${new Date(snapshot.capturedAt).toLocaleTimeString('zh-CN', { hour12: false })} 采样`;
  renderTasks(snapshot.activeTasks ?? []);
  renderEvents(snapshot.events ?? []);
}

function renderTasks(tasks) {
  document.querySelector('#activeCount').textContent = `${tasks.length} 项`;
  const body = document.querySelector('#activeTasks');
  body.replaceChildren();
  if (!tasks.length) return emptyRow(body, 5, '当前没有活动任务');
  for (const task of tasks) {
    const profile = task.executionPlan?.executionProfile;
    const prediction = task.executionPlan?.prediction;
    const row = document.createElement('tr');
    addCell(row, task.capability ?? task.taskId, task.taskId);
    addStatus(row, task.status);
    addCell(row, profile?.id ?? task.executionPlan?.inferenceLocation ?? '--', task.executionPlan?.queueAction ?? '');
    addCell(row, `${profile?.workerCount ?? '--'} 线程 · ${profile?.backend ?? '--'}`,
      `${profile?.retrievalDimensions ?? '--'} 维 · 预测 ${milliseconds(prediction?.latencyMs)}`);
    addCell(row, `${milliseconds(task.targetLatencyMs)} / ${milliseconds(task.deadlineMs)}`,
      task.highQuality ? '高质量要求' : '默认质量要求');
    body.append(row);
  }
}

function renderEvents(events) {
  document.querySelector('#eventCount').textContent = `${events.length} 条`;
  const body = document.querySelector('#events');
  body.replaceChildren();
  if (!events.length) return emptyRow(body, 6, '尚无已完成事件');
  for (const event of events.slice().reverse()) {
    const row = document.createElement('tr');
    addCell(row, clock(event.finishedAt ?? event.startedAt ?? event.queuedAt), event.taskId);
    addCell(row, event.capability, event.taskType);
    addStatus(row, event.status);
    addCell(row, milliseconds(event.totalDurationMs), `排队 ${milliseconds(event.queueDurationMs)} · 执行 ${milliseconds(event.executionDurationMs)}`);
    addCell(row, event.executionPlan?.policyAudit?.actualProfileId ?? event.executionPlan?.executionProfile?.id ?? '--',
      `实际 ${event.telemetry?.actual?.profileId ?? '未确认'}`);
    addCell(row, event.executionPlan?.policyAudit?.fallbackReason ?? event.executionPlan?.reasonCodes?.join(' · ') ?? '--',
      event.errorCode ?? event.executionPlan?.policyAudit?.mode ?? '');
    body.append(row);
  }
}

function addCell(row, primary, secondary = '') {
  const cell = document.createElement('td');
  cell.textContent = String(primary ?? '--');
  if (secondary) {
    const small = document.createElement('span');
    small.className = 'sub';
    small.textContent = String(secondary);
    cell.append(small);
  }
  row.append(cell);
}

function addStatus(row, status) {
  const cell = document.createElement('td');
  const label = document.createElement('span');
  label.className = `state${['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status) ? ' bad' : ''}`;
  label.textContent = String(status ?? '--');
  cell.append(label);
  row.append(cell);
}

function emptyRow(body, span, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = span;
  cell.className = 'empty';
  cell.textContent = message;
  row.append(cell);
  body.append(row);
}

function setConnection(label, state) {
  connection.className = `connection ${state}`;
  connection.lastElementChild.textContent = label;
}

function value(value) { return value === undefined || value === null ? '--' : String(value); }
function percent(value) { return typeof value === 'number' ? `${value.toFixed(1)}%` : '--'; }
function mb(value) { return typeof value === 'number' ? `${value.toFixed(0)} MB` : '--'; }
function milliseconds(value) { return typeof value === 'number' ? `${Math.round(value)} ms` : '--'; }
function clock(value) { return typeof value === 'number' ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--'; }

window.setInterval(() => {
  void refresh();
  if (lastReceivedAt && Date.now() - lastReceivedAt > 3000) setConnection('手机遥测已中断', 'offline');
}, 750);
void refresh();
