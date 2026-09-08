import './runtime-monitor.css';
import { readRuntimeRunId } from './runtime-plan';

type JsonRecord = Record<string, unknown>;
type ApiEnvelope<T> = { success: boolean; data: T | null; error?: { message?: string; code?: string } | null };

interface TaskNode {
  taskId: string;
  toolId: string;
  inputRef: string;
  dependencies?: string[];
}

interface ScoreBreakdown {
  latencyScore?: number;
  qualityScore?: number;
  energyScore?: number;
  reliabilityScore?: number;
  totalScore?: number;
}

interface Assignment {
  taskId: string;
  toolId: string;
  executorId: string;
  placement: string;
  backend: string;
  score: ScoreBreakdown;
  reasons?: string[];
}

interface Evaluation {
  executorId: string;
  placement: string;
  backend: string;
  accepted: boolean;
  reasons: string[];
  score?: ScoreBreakdown | null;
}

interface ExecutionPlan {
  status: string;
  executionOrder: string[];
  parallelGroups: string[][];
  assignments: Assignment[];
  missingRequirements: Requirement[];
  evaluations: Record<string, Evaluation[]>;
  generatedAt: string;
}

interface Requirement { code: string; message: string; taskId?: string }
interface TelemetryRecord {
  taskId: string;
  toolId: string;
  executorId: string;
  latencyMs: number;
  memoryPeakMb: number;
  quality?: number | null;
  success: boolean;
  fallbackOccurred: boolean;
  finishedAt: string;
}
interface VerificationEvent { taskId: string; toolId: string; passed: boolean; reasons: string[]; recordedAt: string }
interface ReplanEvent { reason: string; telemetryCount: number; recordedAt: string }
interface OperationStep {
  key: string;
  label: string;
  durationMs: number;
  status: string;
}
interface MetricObservation {
  value?: number | null;
  available?: boolean;
  reason?: string;
  source?: string;
}
interface PlatformSnapshot {
  profile: {
    platformId: string;
    available: boolean;
    os: string | null;
    arch: string | null;
    cpuLogicalCores: number | null;
    totalMemoryMb: number | null;
    missingCapabilities: string[];
  };
  state: JsonRecord;
  executors: Array<{
    executorId: string;
    backend: string;
    placement: string;
    available: boolean;
    availabilityReason?: string;
    supportedComputeClasses: string[];
  }>;
}
interface RuntimeRun {
  runId: string;
  goal: string;
  status: string;
  taskGraph: { graphId: string; goal: string; nodes: TaskNode[] } | null;
  executionPlan: ExecutionPlan | null;
  telemetry: TelemetryRecord[];
  operationTimeline?: OperationStep[];
  verifications: VerificationEvent[];
  replanEvents: ReplanEvent[];
  outcome?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
interface RuntimeSnapshot {
  platforms: PlatformSnapshot[];
  performanceSamples: Array<{ toolId: string; executorId: string; sampleCount: number; p50LatencyMs: number | null; quality: number | null }>;
  missingRequirements: Requirement[];
  activeRun: RuntimeRun | null;
  recentRuns: RuntimeRun[];
  capturedAt: string;
}

type StageStatus = 'pending' | 'active' | 'done' | 'blocked' | 'skipped' | 'failed';
interface LifecycleStage {
  id: 'plan' | 'execute' | 'observe' | 'verify' | 'replan';
  label: string;
  status: StageStatus;
  detail: string;
}

const POLL_INTERVAL_MS = 1000;
const EVENT_TYPES = [
  'task_graph_received',
  'candidate_evaluated',
  'executor_selected',
  'plan_blocked',
  'telemetry_recorded',
  'verification_failed',
  'replan_requested',
] as const;
const compactWindow = new URLSearchParams(window.location.search).has('window');
const embedMode = new URLSearchParams(window.location.search).has('embed');
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root not found.');

const initialApiBase = localStorage.getItem('debug-api-base') ?? import.meta.env.PUBLIC_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
app.classList.toggle('compact-window', compactWindow || embedMode);
app.classList.toggle('embed-mode', embedMode);
document.body.classList.toggle('embed-mode', embedMode);
app.innerHTML = `
  <main class="runtime-shell">
    <header class="runtime-topbar">
      <div class="brand-block">
        <p class="eyebrow">Agentic Runtime / Local Edge Platform</p>
        <h1>运行调度盘</h1>
      </div>
      <nav class="runtime-nav" aria-label="Runtime navigation">
        <a href="/">测试入口</a>
        <a href="/debug.html">图片搜索</a>
        <a class="active" href="/runtime.html">调度盘</a>
      </nav>
      <div class="runtime-actions">
        <label>API Base<input id="apiBase" value="${escapeHtml(initialApiBase)}" /></label>
        <button id="refreshButton" type="button">刷新快照</button>
      </div>
    </header>
    <section class="runtime-content">
      <div class="connection-line">
        <span id="connectionDot" class="status-dot pending"></span>
        <span id="connectionText">正在读取 Runtime snapshot</span>
        <span id="pollHint">snapshot 1s · SSE /runtime/events</span>
        <span id="capturedAt"></span>
      </div>
      <section class="panel event-log-panel">
        <div class="panel-heading">
          <h2>实时调度事件</h2>
          <span id="liveHint">等待 SSE</span>
        </div>
        <div id="eventLog" class="event-log"></div>
      </section>
      <section id="runSummary" class="run-summary empty-panel"><p>尚未捕获运行轨迹</p></section>
      <section class="panel lifecycle-panel">
        <div class="panel-heading">
          <h2>plan → execute → observe → verify → replan</h2>
          <span id="lifecycleHint">等待首次规划</span>
        </div>
        <div id="lifecycle" class="lifecycle-track"></div>
      </section>
      <div class="monitor-grid">
        <section class="panel platform-panel">
          <div class="panel-heading"><h2>CPU / 内存 / 网络 / GPU / NPU</h2><span id="platformCount">0 platforms</span></div>
          <div id="resourceGrid" class="resource-grid"></div>
          <div id="platforms"></div>
        </section>
        <section class="panel requirements-panel">
          <div class="panel-heading"><h2>缺失能力 / 阻断原因</h2><span id="requirementCount">0</span></div>
          <div id="requirements"></div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-heading"><h2>Goal / Task Graph</h2><span id="planStatus">-</span></div>
        <div id="taskGraph"></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>候选执行器评分表</h2><span id="evaluationCount">0</span></div>
        <div id="evaluations"></div>
      </section>
      <div class="monitor-grid">
        <section class="panel">
          <div class="panel-heading"><h2>最近 Telemetry 样本</h2><span id="telemetryCount">0 samples</span></div>
          <div id="telemetry"></div>
        </section>
        <section class="panel">
          <div class="panel-heading"><h2>最近运行</h2><span>内存保留最近 20 次</span></div>
          <div id="recentRuns"></div>
        </section>
      </div>
    </section>
  </main>
`;

const apiBaseInput = requireElement<HTMLInputElement>('apiBase');
const refreshButton = requireElement<HTMLButtonElement>('refreshButton');
let refreshInFlight = false;
let eventSource: EventSource | null = null;
const eventLogItems: Array<{ type: string; message: string; emittedAt: string; runId?: string; taskId?: string; executorId?: string }> = [];

refreshButton.addEventListener('click', () => void refresh(true));
apiBaseInput.addEventListener('change', () => {
  localStorage.setItem('debug-api-base', apiBaseInput.value.trim());
  connectLiveEvents();
  void refresh(true);
});
window.addEventListener('storage', (event) => {
  if (event.key === 'runtime-active-run-id' || event.key === 'debug-api-base') {
    if (event.key === 'debug-api-base' && event.newValue) {
      apiBaseInput.value = event.newValue;
      connectLiveEvents();
    }
    void refresh(false);
  }
});

void refresh(false);
connectLiveEvents();
renderEventLog();
window.setInterval(() => void refresh(false), POLL_INTERVAL_MS);

function connectLiveEvents() {
  eventSource?.close();
  const liveHint = requireElement('liveHint');
  liveHint.textContent = '正在连接 SSE';
  const source = new EventSource(`${apiBaseInput.value.trim().replace(/\/$/, '')}/api/v1/runtime/events`);
  eventSource = source;
  source.onopen = () => {
    liveHint.textContent = 'SSE 已连接';
  };
  source.onerror = () => {
    liveHint.textContent = 'SSE 断开，浏览器将自动重连';
  };
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      const payload = parseEventData(event.data);
      if (!payload) return;
      eventLogItems.unshift({
        type,
        message: payload.message ?? type,
        emittedAt: payload.emittedAt ?? new Date().toISOString(),
        runId: payload.runId,
        taskId: payload.taskId,
        executorId: payload.executorId,
      });
      if (eventLogItems.length > 80) eventLogItems.length = 80;
      renderEventLog();
      void refresh(false);
    });
  }
}

function parseEventData(raw: string) {
  try {
    return JSON.parse(raw) as {
      message?: string;
      emittedAt?: string;
      runId?: string;
      taskId?: string;
      executorId?: string;
    };
  } catch {
    return null;
  }
}

function renderEventLog() {
  requireElement('eventLog').innerHTML = eventLogItems.length
    ? eventLogItems.map((item) => `
        <article class="live-event ${item.type}">
          <span class="event-kind">${escapeHtml(item.type)}</span>
          <strong>${escapeHtml(item.message)}</strong>
          <span>${escapeHtml(item.taskId ?? item.runId ?? formatDate(item.emittedAt))}</span>
        </article>
      `).join('')
    : empty('还没有 Scheduler 事件。左侧搜索一次后，这里会实时追加日志。');
}

async function refresh(manual: boolean) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const dot = requireElement('connectionDot');
  const text = requireElement('connectionText');
  if (manual) refreshButton.disabled = true;
  try {
    const snapshot = await fetchJson<RuntimeSnapshot>('/api/v1/runtime/snapshot');
    dot.className = 'status-dot online';
    text.textContent = 'Runtime API 在线';
    requireElement('capturedAt').textContent = `captured ${formatDate(snapshot.capturedAt)}`;
    renderSnapshot(snapshot);
  } catch (error) {
    dot.className = 'status-dot offline';
    text.textContent = error instanceof Error ? error.message : 'Runtime API 不可达';
    requireElement('capturedAt').textContent = '';
  } finally {
    refreshInFlight = false;
    refreshButton.disabled = false;
  }
}

function renderSnapshot(snapshot: RuntimeSnapshot) {
  const run = selectActiveRun(snapshot);
  const displayStatus = deriveDisplayStatus(run);
  requireElement('platformCount').textContent = `${snapshot.platforms.length} platforms`;
  requireElement('requirementCount').textContent = String(snapshot.missingRequirements.length);
  requireElement('telemetryCount').textContent = `${run?.telemetry.length ?? 0} samples`;
  requireElement('planStatus').textContent = run?.executionPlan?.status ?? 'no plan';
  requireElement('runSummary').innerHTML = run ? `
    <div><span class="summary-label">CURRENT RUN</span><strong>${escapeHtml(run.runId)}</strong></div>
    <div class="summary-goal"><span class="summary-label">GOAL</span><strong>${escapeHtml(run.goal)}</strong></div>
    <div><span class="summary-label">STATUS</span><strong class="status-pill ${statusClass(displayStatus)}">${escapeHtml(displayStatus)}</strong></div>
    <div><span class="summary-label">UPDATED</span><strong>${escapeHtml(formatDate(run.updatedAt))}</strong></div>
  ` : '<p>尚未捕获运行轨迹。从图片搜索页点「打开调度盘」，再运行一次真实搜索。</p>';
  renderLifecycle(run);
  renderResources(snapshot.platforms);
  renderPlatforms(snapshot.platforms);
  renderRequirements(snapshot.missingRequirements, run?.executionPlan?.missingRequirements ?? []);
  renderPlan(run);
  renderEvaluations(run);
  renderTelemetry(run);
  renderRecentRuns(snapshot.recentRuns, run?.runId);
}

function selectActiveRun(snapshot: RuntimeSnapshot) {
  const followedId = readRuntimeRunId();
  if (followedId) {
    return snapshot.recentRuns.find((item) => item.runId === followedId)
      ?? (snapshot.activeRun?.runId === followedId ? snapshot.activeRun : null)
      ?? snapshot.activeRun;
  }
  return snapshot.activeRun;
}

function deriveDisplayStatus(run: RuntimeRun | null) {
  if (!run) return 'idle';
  if (run.telemetry.some((item) => item.fallbackOccurred) || run.outcome?.includes('fallback')) {
    return 'fallback';
  }
  return run.status;
}

function renderLifecycle(run: RuntimeRun | null) {
  const stages = buildLifecycle(run);
  requireElement('lifecycleHint').textContent = run
    ? `${deriveDisplayStatus(run)} · ${stages.filter((item) => item.status !== 'pending' && item.status !== 'active').length}/5 stages`
    : '等待首次规划';
  requireElement('lifecycle').innerHTML = stages.map((stage, index) => `
    <article class="lifecycle-stage ${stage.status}">
      <span class="stage-index">${index + 1}</span>
      <strong>${escapeHtml(stage.label)}</strong>
      <span class="stage-status">${escapeHtml(stage.status)}</span>
      <p>${escapeHtml(stage.detail)}</p>
    </article>
  `).join('');
}

function buildLifecycle(run: RuntimeRun | null): LifecycleStage[] {
  const plan = run?.executionPlan;
  const hasPlan = Boolean(plan);
  const planBlocked = plan?.status === 'blocked';
  const hasAssignments = (plan?.assignments.length ?? 0) > 0;
  const hasOps = (run?.operationTimeline?.length ?? 0) > 0;
  const hasTelemetry = (run?.telemetry.length ?? 0) > 0;
  const failedVerify = (run?.verifications ?? []).some((item) => !item.passed);
  const hasVerify = (run?.verifications.length ?? 0) > 0;
  const hasReplan = (run?.replanEvents.length ?? 0) > 0;
  const executeDetail = hasOps
    ? `${run?.operationTimeline?.length} 个业务阶段`
    : planBlocked && !hasAssignments
      ? '无可用执行器，execute 未开始'
      : hasAssignments
        ? '已规划执行器，Runtime 尚未真正执行'
        : '等待规划';

  return [
    {
      id: 'plan',
      label: 'plan',
      status: !run ? 'pending' : hasPlan ? (planBlocked ? 'blocked' : 'done') : run.status === 'planning' ? 'active' : 'pending',
      detail: hasPlan ? formatDate(plan!.generatedAt) : '尚未生成 executionPlan',
    },
    {
      id: 'execute',
      label: 'execute',
      status: !hasPlan ? 'pending' : hasOps ? 'done' : planBlocked && !hasAssignments ? 'skipped' : hasAssignments ? 'active' : 'pending',
      detail: executeDetail,
    },
    {
      id: 'observe',
      label: 'observe',
      status: hasTelemetry ? 'done' : hasOps || hasAssignments ? 'pending' : 'pending',
      detail: hasTelemetry ? `${run?.telemetry.length} 条真实样本` : '还没有 Telemetry',
    },
    {
      id: 'verify',
      label: 'verify',
      status: failedVerify ? 'failed' : hasVerify ? 'done' : 'pending',
      detail: hasVerify ? `${run?.verifications.length} 次校验` : '尚未调用 /runtime/verify',
    },
    {
      id: 'replan',
      label: 'replan',
      status: hasReplan ? 'done' : 'pending',
      detail: hasReplan ? `${run?.replanEvents.length} 次重规划` : '尚未调用 /runtime/replan',
    },
  ];
}

function renderResources(platforms: PlatformSnapshot[]) {
  const host = platforms.find((item) => item.profile.platformId === 'host') ?? platforms[0];
  const cards = [
    resourceCard('CPU', host, 'cpuUtilizationPercent', '%', []),
    resourceCard('内存', host, 'freeMemoryMb', ' MB free', []),
    resourceCard('网络', host, 'networkLatencyMs', ' ms', ['NETWORK_THROUGHPUT_PROBE_NOT_CONFIGURED']),
    resourceCard('GPU', host, 'gpuUtilizationPercent', '%', ['GPU_EXECUTOR_NOT_DISCOVERED', 'GPU_UTILIZATION_SOURCE_NOT_CONFIGURED']),
    resourceCard('NPU', host, 'npuUtilizationPercent', '%', ['NPU_EXECUTOR_NOT_DISCOVERED', 'NPU_UTILIZATION_SOURCE_NOT_CONFIGURED']),
  ];
  requireElement('resourceGrid').innerHTML = host
    ? cards.join('')
    : empty('没有发现平台，无法读取 CPU / 内存 / 网络 / GPU / NPU');
}

function resourceCard(
  label: string,
  platform: PlatformSnapshot | undefined,
  key: string,
  suffix: string,
  extraCodes: string[],
) {
  const observation = asObservation(platform?.state[key]);
  const executorGap = platform?.executors.find((item) => !item.available && extraCodes.includes(item.availabilityReason ?? ''));
  const capabilityGap = platform?.profile.missingCapabilities.find((code) => extraCodes.includes(code));
  const available = observation?.available === true && observation.value != null;
  const reason = available
    ? (observation.source ?? 'observed')
    : observation?.reason ?? executorGap?.availabilityReason ?? capabilityGap ?? 'METRIC_UNAVAILABLE';
  return `
    <article class="resource-card ${available ? 'available' : 'missing'}">
      <span>${escapeHtml(label)}</span>
      <strong>${available ? `${escapeHtml(String(observation?.value))}${suffix}` : 'unavailable'}</strong>
      <small>${escapeHtml(reason)}</small>
    </article>
  `;
}

function renderPlatforms(platforms: PlatformSnapshot[]) {
  requireElement('platforms').innerHTML = platforms.length ? platforms.map((item) => {
    const executors = item.executors.map((executor) => `<span class="executor ${executor.available ? 'available' : 'unavailable'}">${escapeHtml(executor.executorId)} · ${escapeHtml(executor.backend)}${executor.available ? '' : ` · ${escapeHtml(executor.availabilityReason ?? 'unavailable')}`}</span>`).join('');
    return `<article class="platform-row"><div class="platform-title"><strong>${escapeHtml(item.profile.platformId)}</strong><span>${item.profile.available ? 'available' : 'unavailable'} · ${escapeHtml(item.profile.os ?? 'unknown')}</span></div><div class="executor-list">${executors || '<span class="muted">no executors</span>'}</div></article>`;
  }).join('') : empty('没有发现平台');
}

function renderRequirements(globalRequirements: Requirement[], planRequirements: Requirement[]) {
  const requirements = uniqueRequirements([...globalRequirements, ...planRequirements]);
  requireElement('requirements').innerHTML = requirements.length
    ? requirements.map((item) => `<div class="requirement"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.message)}</span></div>`).join('')
    : '<div class="success-line">当前没有已知阻断原因</div>';
}

function renderPlan(run: RuntimeRun | null) {
  const graph = run?.taskGraph;
  const plan = run?.executionPlan;
  if (!run || !graph) {
    requireElement('taskGraph').innerHTML = empty('当前运行没有可展示的 Task Graph');
    return;
  }
  const assignments = new Map((plan?.assignments ?? []).map((item) => [item.taskId, item]));
  requireElement('taskGraph').innerHTML = `<div class="graph-goal"><span>graphId</span><strong>${escapeHtml(graph.graphId)}</strong><p>${escapeHtml(graph.goal)}</p></div><div class="task-table">${graph.nodes.map((node) => {
    const assignment = assignments.get(node.taskId);
    const dependency = node.dependencies?.length ? node.dependencies.join(', ') : 'none';
    return `<div class="task-row"><div><strong>${escapeHtml(node.taskId)}</strong><span>${escapeHtml(node.toolId)}</span></div><span>${escapeHtml(dependency)}</span><span>${assignment ? `${escapeHtml(assignment.executorId)} · ${escapeHtml(assignment.placement)}` : '<em>blocked / not assigned</em>'}</span><span>${assignment ? formatScore(assignment.score?.totalScore) : '-'}</span></div>`;
  }).join('')}</div>`;
}

function renderEvaluations(run: RuntimeRun | null) {
  const grouped = Object.entries(run?.executionPlan?.evaluations ?? {});
  requireElement('evaluationCount').textContent = String(grouped.reduce((sum, [, items]) => sum + items.length, 0));
  if (!grouped.length) {
    requireElement('evaluations').innerHTML = empty('Scheduler 尚未生成候选评估');
    return;
  }
  requireElement('evaluations').innerHTML = grouped.map(([taskId, items]) => `
    <article class="score-table">
      <div class="score-table-title">
        <strong>${escapeHtml(taskId)}</strong>
        <span>${escapeHtml(run?.taskGraph?.nodes.find((node) => node.taskId === taskId)?.toolId ?? '')}</span>
      </div>
      <div class="score-head">
        <span>executor</span><span>backend</span><span>decision</span><span>total</span><span>latency</span><span>quality</span><span>energy</span><span>reliability</span><span>reasons</span>
      </div>
      ${items.map((item) => `
        <div class="score-row">
          <strong>${escapeHtml(item.executorId)}</strong>
          <span>${escapeHtml(item.backend)} / ${escapeHtml(item.placement)}</span>
          <span class="decision ${item.accepted ? 'accepted' : 'rejected'}">${item.accepted ? 'accepted' : 'rejected'}</span>
          <span>${formatScore(item.score?.totalScore)}</span>
          <span>${formatScore(item.score?.latencyScore)}</span>
          <span>${formatScore(item.score?.qualityScore)}</span>
          <span>${formatScore(item.score?.energyScore)}</span>
          <span>${formatScore(item.score?.reliabilityScore)}</span>
          <span>${escapeHtml(item.reasons.join(' · ') || '-')}</span>
        </div>
      `).join('')}
    </article>
  `).join('');
}

function renderTelemetry(run: RuntimeRun | null) {
  const telemetry = [...(run?.telemetry ?? [])].slice(-8).reverse();
  const verifies = run?.verifications ?? [];
  const replans = run?.replanEvents ?? [];
  requireElement('telemetry').innerHTML = telemetry.length || verifies.length || replans.length
    ? `${telemetry.map((item) => `<div class="event-row"><span class="event-kind telemetry-kind">TELEMETRY</span><strong>${escapeHtml(item.toolId)}</strong><span>${escapeHtml(item.executorId)} · ${formatMs(item.latencyMs)} · ${item.success ? 'success' : 'failed'}${item.fallbackOccurred ? ' · fallback' : ''}</span></div>`).join('')}${verifies.map((item) => `<div class="event-row"><span class="event-kind ${item.passed ? 'verify-pass' : 'verify-fail'}">VERIFY</span><strong>${escapeHtml(item.toolId)}</strong><span>${item.passed ? 'passed' : escapeHtml(item.reasons.join(' · '))}</span></div>`).join('')}${replans.map((item) => `<div class="event-row"><span class="event-kind replan-kind">REPLAN</span><strong>${escapeHtml(item.reason)}</strong><span>${item.telemetryCount} telemetry records</span></div>`).join('')}`
    : empty('还没有真实 Telemetry、Verify 或 Replan 事件');
}

function renderRecentRuns(runs: RuntimeRun[], activeId?: string) {
  requireElement('recentRuns').innerHTML = runs.length
    ? `<div class="recent-table">${runs.map((run) => `<div class="recent-row ${run.runId === activeId ? 'active-run' : ''}"><strong>${escapeHtml(run.runId)}</strong><span>${escapeHtml(run.goal)}</span><span class="status-text ${statusClass(deriveDisplayStatus(run))}">${escapeHtml(deriveDisplayStatus(run))}</span><span>${escapeHtml(formatDate(run.updatedAt))}</span></div>`).join('')}</div>`
    : empty('暂无历史运行');
}

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${apiBaseInput.value.trim().replace(/\/$/, '')}${path}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    const payload = await response.json() as ApiEnvelope<T> | T;
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (isEnvelope<T>(payload)) {
      if (!payload.success || payload.data === null) throw new Error(payload.error?.message ?? payload.error?.code ?? 'API_ERROR');
      return payload.data;
    }
    return payload;
  } finally { window.clearTimeout(timeout); }
}

function asObservation(value: unknown): MetricObservation | null {
  return typeof value === 'object' && value !== null ? value as MetricObservation : null;
}
function isEnvelope<T>(value: ApiEnvelope<T> | T): value is ApiEnvelope<T> { return typeof value === 'object' && value !== null && 'success' in value && 'data' in value; }
function requireElement<T extends HTMLElement = HTMLElement>(id: string) { const element = document.getElementById(id); if (!element) throw new Error(`Element not found: ${id}`); return element as T; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }
function formatMs(value: number) { return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`; }
function formatScore(value?: number) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-'; }
function statusClass(status: string) { return status === 'ready' || status === 'completed' || status === 'done' ? 'good' : status === 'blocked' || status === 'failed' || status === 'fallback' ? 'bad' : 'pending-text'; }
function empty(message: string) { return `<div class="empty-panel">${escapeHtml(message)}</div>`; }
function uniqueRequirements(items: Requirement[]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.code}:${item.taskId ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function escapeHtml(value: unknown) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
