import { $, api, bindConnection, connected, escape, facts, ms, notice, status } from '/client.js';

let run;
let pending = false;
let timer;
let generation = 0;
let importedConstraints = {};
let ready = false;

function controls() {
  $('submit').disabled = !ready || pending || ['running', 'planning'].includes(run?.status);
  $('tool').disabled = !ready || pending;
  $('cancel').disabled = !ready || pending || !run?.attemptKey || run.status !== 'running';
  $('reconcile').disabled = !ready || pending || !run?.attemptKey || run.status !== 'unknown';
  $('retryRead').disabled = !ready || pending || !run;
}
function renderRun(value) {
  run = value;
  $('taskStatus').innerHTML = status(run.status);
  const result = run.result?.result;
  $('runFacts').innerHTML = facts([
    ['运行 ID', run.runId], ['执行目标', run.targetDeviceId], ['调度模式', run.decision?.mode],
    ['实测排队', ms(result?.queueDurationMs)], ['实测执行', ms(result?.executionDurationMs)],
    ['实测总耗时（执行端）', ms(result?.totalDurationMs)], ['原因', run.reason ?? run.result?.reason ?? result?.errorCode ?? '--'],
  ]).replace(/^<dl class="facts">|<\/dl>$/g, '');
  const refused = run.decision?.candidates.filter(candidate => !candidate.accepted);
  $('output').textContent = result?.output !== null && result?.output !== undefined
    ? JSON.stringify(result.output, null, 2) : run.status === 'blocked'
      ? JSON.stringify(refused?.map(candidate => ({ deviceId: candidate.deviceId, reasons: candidate.reasons })), null, 2)
      : '暂无可交付结果';
  $('output').classList.remove('empty'); controls();
}
async function readRun(epoch = generation) {
  clearTimeout(timer);
  if (!run || !connected()) return;
  const requestedId = run.runId;
  try {
    const value = await api(`/api/v1/runtime/runs/${encodeURIComponent(requestedId)}`);
    if (epoch !== generation || run?.runId !== requestedId || value.updatedAt < run.updatedAt) return;
    renderRun(value); notice(`任务 ${run.runId} · ${run.status}`);
    if (['running', 'planning'].includes(run.status)) timer = setTimeout(() => readRun(epoch), 700);
  } catch (error) { if (epoch === generation && run?.runId === requestedId) notice(`读取状态失败：${error.message}。任务状态未确认。`, 'error'); }
}
async function connect() {
  const epoch = ++generation; ready = false; controls();
  try {
    const tools = await api('/api/v1/runtime/tools');
    const node = await api('/api/v1/runtime/snapshot');
    if (epoch !== generation) return;
    const selected = $('tool').value;
    $('tool').innerHTML = tools.map(tool => `<option value="${escape(tool.descriptor.toolId)}">${escape(tool.descriptor.toolId)}</option>`).join('');
    if (tools.some(tool => tool.descriptor.toolId === selected)) $('tool').value = selected;
    $('connectionState').textContent = `已连接 ${node.identity.deviceId}`;
    $('demoMode').textContent = `执行模式 ${node.mode}`;
    ready = true; controls(); notice(`${node.identity.deviceId} · 已注册 ${tools.length} 个工具`);
    if (run) void readRun(epoch);
  } catch (error) { if (epoch === generation) { $('connectionState').textContent = '连接失败'; notice(error.message, 'error'); } }
}

$('taskFile').addEventListener('change', async () => {
  const file = $('taskFile').files[0];
  if (!file) return;
  try {
    if (file.size > 512 * 1024) throw new Error('输入文件超过 512 KiB');
    const task = JSON.parse(await file.text());
    if (typeof task.toolId !== 'string' || !Object.hasOwn(task, 'input')) throw new Error('需要 toolId 和 input 字段');
    if (![...$('tool').options].some(option => option.value === task.toolId)) throw new Error('此 Runtime 未注册该工具，请先连接后再导入');
    const constraints = task.constraints ?? {};
    if (typeof constraints !== 'object' || Array.isArray(constraints)) throw new Error('constraints 必须为对象');
    $('tool').value = task.toolId; $('payload').value = JSON.stringify(task.input, null, 2);
    importedConstraints = constraints;
    $('deadline').value = importedConstraints.deadlineMs ?? 10000;
    $('allowRemote').checked = importedConstraints.allowRemote === true;
    $('inputOrigin').textContent = `已导入 ${file.name} · ${file.size} bytes · 其他约束 ${JSON.stringify(importedConstraints)}`;
    notice(`已载入 ${file.name}`);
  } catch (error) { notice(error.message, 'error'); }
});
$('payload').addEventListener('input', () => { $('inputOrigin').textContent = '用户编辑的任务输入'; });
$('taskForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!ready || pending) return;
  let task;
  try {
    task = { toolId: $('tool').value, input: JSON.parse($('payload').value),
      constraints: { ...importedConstraints, deadlineMs: Number($('deadline').value), allowRemote: $('allowRemote').checked } };
    if (new TextEncoder().encode(JSON.stringify(task.input)).length > 512 * 1024) throw new Error('输入超过 512 KiB');
  } catch (error) { notice(`输入无效：${error.message}`, 'error'); return; }
  const epoch = generation; pending = true; controls();
  try {
    const value = await api('/api/v1/runtime/tasks', { method: 'POST', body: JSON.stringify(task) });
    if (epoch !== generation) return;
    renderRun(value); notice(`已接收 ${value.runId}`); void readRun(epoch);
  } catch (error) { if (epoch === generation) notice(`提交未确认：${error.message}。请先核对调度盘记录，再决定是否重新提交。`, 'error'); }
  finally { pending = false; controls(); }
});
async function action(name) {
  if (!run || pending) return;
  pending = true; controls(); const epoch = generation;
  try {
    await api(`/api/v1/runtime/runs/${encodeURIComponent(run.runId)}/${name}`, { method: 'POST', body: '{}' });
    if (epoch !== generation) return;
    notice(name === 'cancel' ? '取消请求已发送，等待执行器回执' : '已查询回执'); await readRun(epoch);
  } catch (error) { if (epoch === generation) notice(error.message, 'error'); }
  finally { pending = false; controls(); }
}
$('cancel').addEventListener('click', () => action('cancel'));
$('reconcile').addEventListener('click', () => action('reconcile'));
$('retryRead').addEventListener('click', () => readRun());
bindConnection(connect, () => {
  generation++; clearTimeout(timer); ready = false; controls();
  $('connectionState').textContent = '已断开'; notice('已断开，任务执行状态以 Runtime 回执为准', 'warn');
});
