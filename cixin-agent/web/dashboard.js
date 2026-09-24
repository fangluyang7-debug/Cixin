import { $, api, bindConnection, connected, escape, facts, finite, ms, notice, number, short, status, time } from '/client.js';

let snapshot;
let selectedRun;
let timer;
let generation = 0;
let paused = false;
const samples = [];
const percent = value => finite(value) ? `${number(value)}%` : '--';
const memory = value => finite(value) ? `${number(value / 1024)} GiB` : '--';
const fieldTime = (state, field) => time(state?.sampledAt?.[field]);
const write = (id, value) => { $(id).textContent = value; };
function meter(id, value) { $(id).hidden = !finite(value); $(id).value = finite(value) ? value : 0; }
function connection(label, tone) { write('connectionState', label); $('connectionLed').className = `led ${tone}`; }

function render(data) {
  snapshot = data;
  const local = data.nodes.find(node => node.local);
  const state = local?.snapshot?.state;
  const metrics = data.scheduler;
  const identity = local?.snapshot?.identity;
  const availablePercent = finite(state?.availableMemoryMb) && state.totalMemoryMb > 0
    ? state.availableMemoryMb / state.totalMemoryMb * 100 : null;
  write('identity', `${data.coordinatorId} · ${identity?.os ?? '--'} / ${identity?.arch ?? '--'} · 内核 ${identity?.kernel ?? '--'}`);
  write('mode', data.mode);
  write('cpu', percent(state?.systemCpuUsage)); meter('cpuMeter', state?.systemCpuUsage);
  write('cpuSource', `来源 ${state?.source ?? '--'} · ${fieldTime(state, 'systemCpuUsage')}`);
  write('thermal', state?.thermalLevel ?? '--');
  write('thermalSource', state?.thermalLevel === 'UNKNOWN' ? '未获得有效温度观测' : `热等级 · ${fieldTime(state, 'thermalLevel')}`);
  write('memory', memory(state?.availableMemoryMb)); meter('memoryMeter', availablePercent);
  write('memorySource', `总量 ${memory(state?.totalMemoryMb)} · ${state?.memoryPressure ?? '--'}`);
  write('queue', `${metrics.runningCount} / ${metrics.queuedCount}`);
  write('queueSource', `本地并发上限 ${data.limits.maxConcurrentLocalTasks} · 暂停 ${metrics.pausedCount}`);
  write('latency', metrics.taskCount > 0 ? ms(metrics.p95LatencyMs) : '--');
  write('latencySource', `本地终态 ${metrics.taskCount} · 均值 ${metrics.taskCount > 0 ? ms(metrics.averageLatencyMs) : '--'}`);
  write('nodesCount', `${data.nodes.filter(node => node.status === 'observed').length} / ${data.nodes.length}`);
  write('capturedAt', time(data.capturedAt));
  write('footerStatus', `采集 ${time(data.capturedAt)} · ${state?.source ?? '--'} · ${identity?.model ?? '--'}`);
  renderNodes(data.nodes);
  if (!data.runs.some(run => run.runId === selectedRun)) selectedRun = data.runs[0]?.runId;
  renderRuns(); renderDetails(); renderAttempts(data.attempts);
  $('capabilities').innerHTML = facts([
    ['已探测执行后端', state?.availableBackends?.join(' / ') || '--'],
    ['CPU worker 预算', data.limits.cpuWorkerBudget],
    ['远端最少样本', data.limits.minRemoteSamples],
    ['本地审计', data.storage.audit],
    ['云端数据库', data.storage.cloudDatabase === 'not-configured' ? '未接入' : data.storage.cloudDatabase],
    ['电池', state?.batteryApplicable === false ? '不适用（板卡 / 主机）' : percent(state?.batteryPercent)],
    ['功耗 / GPU 利用率', '未采集'],
  ]).replace(/^<dl class="facts">|<\/dl>$/g, '');
  $('missing').innerHTML = (local?.snapshot?.missingCapabilities ?? []).map(reason => `<p>${escape(reason)}</p>`).join('');
  if (state && samples.at(-1)?.at !== state.capturedAt) {
    samples.push({ at: state.capturedAt, cpu: state.systemCpuUsage, available: availablePercent });
    if (samples.length > 60) samples.shift();
  }
  drawChart();
  const unavailable = data.nodes.filter(node => node.status !== 'observed').length;
  const age = Date.now() - data.capturedAt;
  document.body.classList.toggle('stale', age > 10000 || !state);
  connection(age > 10000 ? '快照已过期' : unavailable ? '部分节点读取失败' : '已连接', unavailable || age > 10000 ? 'amber' : 'green');
  notice(age > 10000 ? `快照已过期 · ${time(data.capturedAt)}` :
    `采集时间 ${time(data.capturedAt)} · 本地实时状态 / 远端 HTTP 快照 · ${data.mode}`, age > 10000 || unavailable ? 'warn' : '');
}

function renderNodes(nodes) {
  $('nodes').classList.remove('empty');
  $('nodes').innerHTML = nodes.map(node => {
    const item = node.snapshot;
    const state = item?.state;
    return `<article class="node-row"><div class="node-title"><i class="led ${item ? 'green' : 'red'}"></i><strong>${escape(node.deviceId)}</strong><span class="badge">${node.local ? '协调节点' : '远端节点'}</span></div>
      ${item ? `<p class="node-sub">${escape(item.identity.model)} · ${escape(item.identity.os)} / ${escape(item.identity.arch)}</p>
      <div class="node-metrics"><span class="cyan-text">CPU ${percent(state.systemCpuUsage)}</span><span class="green-text">可用 ${memory(state.availableMemoryMb)}</span><span>${escape(state.thermalLevel)}</span></div>
      <p class="node-sub">${escape(item.tools.map(tool => tool.toolId).join(' · ') || '无可用工具')}</p>
      <p class="node-sub">资源采样 ${time(state.capturedAt)} · 来源 ${escape(state.source)} · ${node.local ? '本地采集用时' : 'HTTP 快照请求用时'} ${ms(node.requestDurationMs)}</p>` :
      `<p class="status-failed">读取失败 · ${escape(node.error)}</p><p class="node-sub">检查时间 ${time(node.receivedAt)} · 无可用快照</p>`}</article>`;
  }).join('');
}

function renderRuns() {
  const focusedId = $('runs').contains(document.activeElement) ? document.activeElement.dataset.run : undefined;
  const runs = snapshot?.runs ?? [];
  write('runCount', `${runs.length} RUNS`);
  $('runs').classList.toggle('empty', runs.length === 0);
  $('runs').innerHTML = runs.length ? runs.map(run => `<button type="button" class="run-row" data-run="${escape(run.runId)}" aria-pressed="${run.runId === selectedRun}"><span class="run-id mono">${escape(short(run.runId))}</span>${status(run.status)}<small>${escape(run.targetDeviceId ?? run.decision?.selectedDeviceId ?? '等待决策')}</small><small>${time(run.updatedAt)}</small></button>`).join('') : '尚无任务记录';
  if (focusedId) [...$('runs').querySelectorAll('[data-run]')].find(button => button.dataset.run === focusedId)?.focus({ preventScroll: true });
}

function decisionView(run) {
  const decision = run.decision;
  if (!decision) return `<p class="empty">${escape(run.reason ?? '尚无放置决策')}</p>`;
  return facts([['运行 ID', run.runId], ['决策模式', decision.mode], ['已选择', decision.selectedDeviceId], ['建议节点', decision.suggestedDeviceId]]) +
    `<div class="table-scroll"><table><thead><tr><th>候选节点</th><th>准入</th><th>预测总耗时</th><th>不确定余量</th></tr></thead><tbody>${decision.candidates.map(candidate => `<tr><td>${escape(candidate.deviceId)}</td><td>${candidate.accepted ? '通过' : '拒绝'}</td><td>${ms(candidate.totalMs)}</td><td>${ms(candidate.uncertaintyMs)}</td></tr>`).join('')}</tbody></table></div>` +
    `<ul class="reason-list">${decision.candidates.map(candidate => {
      const quote = candidate.quote;
      return `<li><strong>${escape(candidate.deviceId)}</strong> · 预测计算 ${ms(quote?.computeMs)} · 预测传输 ${ms(candidate.transferMs)} · 样本 ${escape(quote?.sampleCount ?? '--')}<br>预测来源 ${escape(quote?.plan?.prediction?.source ?? '--')} · 报价接收 ${time(quote?.receivedAt)}<br>${escape([...new Set([...candidate.reasons, ...(quote?.reasons ?? [])])].join(' / ') || '--')}</li>`;
    }).join('')}</ul>`;
}

function renderDetails() {
  const run = snapshot?.runs.find(item => item.runId === selectedRun);
  if (!run) {
    $('decision').innerHTML = '<p class="empty">选择一条任务记录</p>';
    $('receipt').innerHTML = '<p class="empty">尚无执行回执</p>';
    $('pipeline').innerHTML = '<p class="empty">尚未选择任务图</p>'; return;
  }
  ['decision', 'receipt', 'pipeline'].forEach(id => $(id).classList.remove('empty'));
  const child = run.graph ? run.nodes.at(-1) : undefined;
  $('decision').innerHTML = decisionView(child ?? run);
  const result = (child ?? run).result?.result;
  $('receipt').innerHTML = `<p>${status((child ?? run).status)}</p>` + facts([
    ['实际目标', (child ?? run).targetDeviceId],
    ['实测排队', ms(result?.queueDurationMs)], ['实测执行', ms(result?.executionDurationMs)],
    ['执行端实测总耗时', ms(result?.totalDurationMs)], ['执行档位', result?.plan?.profile?.id],
    ['执行后端', result?.plan?.profile?.backend],
    ['执行器确认', result ? result.plan?.actualConfirmed ? '已确认' : '未确认' : '--'],
    ['状态原因', (child ?? run).reason ?? result?.errorCode ?? '--'],
  ]);
  $('pipeline').innerHTML = run.graph ? run.graph.nodes.map((node, index) => {
    const record = run.nodes.find(item => item.taskId === node.taskId);
    return `<div class="pipeline-step"><span class="badge">${index + 1}</span><div>${escape(node.taskId)} · ${record ? status(record.status) : '尚无执行记录'}<small>${escape(node.toolId)}</small><small>依赖 ${escape(node.dependencies.join(', ') || '无')} · ${escape(record?.targetDeviceId ?? '--')}</small></div></div>`;
  }).join('') : `<p class="empty">单任务 · ${escape(short(run.runId))}</p>`;
}

function renderAttempts(attempts) {
  $('attempts').classList.toggle('empty', attempts.length === 0);
  $('attempts').innerHTML = attempts.length ? attempts.slice(0, 12).map(attempt => `<article class="attempt"><time>${time(attempt.updatedAt)}</time>${status(attempt.status)}<p class="mono">${escape(short(attempt.key))} · 来源 ${escape(attempt.originDeviceId)}</p><p>${escape(attempt.reason ?? attempt.result?.errorCode ?? '--')} · 实测执行 ${ms(attempt.result?.executionDurationMs)}</p></article>`).join('') : '尚无执行尝试';
}

function drawChart() {
  const canvas = $('history');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.round(rect.height * dpr);
  const context = canvas.getContext('2d'); context.scale(dpr, dpr);
  const width = rect.width, height = rect.height, left = 30, top = 10, bottom = height - 24;
  context.font = '10px Consolas, monospace';
  for (const value of [0, 50, 100]) {
    const y = bottom - value / 100 * (bottom - top);
    context.fillStyle = '#a3a7ad'; context.fillText(`${value}%`, 0, y + 3);
    context.strokeStyle = '#393b3e'; context.beginPath(); context.moveTo(left, y); context.lineTo(width, y); context.stroke();
  }
  if (!samples.length) { context.fillText('等待真实采样', left + 12, height / 2); return; }
  const start = samples[0].at, duration = Math.max(1, samples.at(-1).at - start);
  for (const [field, color] of [['cpu', '#00daf3'], ['available', '#4edea3']]) {
    let line = false; context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 1.6; context.beginPath();
    for (const sample of samples) {
      if (!finite(sample[field])) { line = false; continue; }
      const x = left + (sample.at - start) / duration * (width - left - 4), y = bottom - sample[field] / 100 * (bottom - top);
      if (line) context.lineTo(x, y); else context.moveTo(x, y);
      context.fillRect(x - 1.5, y - 1.5, 3, 3); line = true;
    }
    context.stroke();
  }
  context.fillStyle = '#a3a7ad'; context.fillText(time(start), left, height - 5);
  context.textAlign = 'right'; context.fillText(time(samples.at(-1).at), width - 2, height - 5);
}

async function poll(epoch) {
  if (!connected() || paused || epoch !== generation) return;
  try {
    const data = await api('/api/v1/runtime/dashboard');
    if (epoch !== generation || paused) return;
    render(data);
  } catch (error) {
    if (epoch !== generation || paused) return;
    connection('连接失败', 'red'); document.body.classList.add('stale');
    notice(`${error.message} · 最后成功采集 ${time(snapshot?.capturedAt)}`, 'error');
  } finally {
    if (epoch === generation && !paused && connected()) timer = setTimeout(() => poll(epoch), Number($('interval').value));
  }
}

function restart() {
  clearTimeout(timer); generation++; paused = false;
  $('pause').disabled = false; $('pause').textContent = '暂停刷新';
  void poll(generation);
}
$('runs').addEventListener('click', event => {
  const button = event.target.closest('[data-run]');
  if (!button) return; selectedRun = button.dataset.run; renderRuns(); renderDetails();
});
$('pause').addEventListener('click', () => {
  if (paused) { restart(); return; }
  paused = true; generation++; clearTimeout(timer); $('pause').textContent = '恢复刷新';
  document.body.classList.add('stale'); connection('刷新已暂停', 'amber'); notice(`已暂停刷新 · 最后采集 ${time(snapshot?.capturedAt)}`, 'warn');
});
$('interval').addEventListener('change', () => { if (connected() && !paused) restart(); });
new ResizeObserver(drawChart).observe($('history'));
bindConnection(restart, () => {
  clearTimeout(timer); generation++; $('pause').disabled = true;
  document.body.classList.add('stale'); connection('已断开', 'off'); notice(`已断开 · 保留最后快照 ${time(snapshot?.capturedAt)}`, 'warn');
});
