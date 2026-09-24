export const $ = id => document.getElementById(id);
export const escape = value => String(value ?? '--').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const number = (value, digits = 1) => finite(value) ? value.toFixed(digits) : '--';
export const ms = value => finite(value) ? `${number(value)} ms` : '--';
export const time = value => finite(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--';
export const short = value => value ? String(value).slice(0, 12) : '--';
const statusNames = { completed: '已完成', running: '运行中', planning: '规划中', blocked: '已阻断',
  failed: '失败', unknown: '未确认', cancelled: '已取消', rejected: '已拒绝', accepted: '已接收' };
export const status = value => `<span class="status-${Object.hasOwn(statusNames, value) ? value : 'unknown'}">${escape(statusNames[value] ?? value ?? '--')}</span>`;
export const facts = rows => `<dl class="facts">${rows.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
export function notice(message, tone = '') { $('notice').textContent = message; $('notice').className = `notice ${tone}`; }

let token = '';
try { token = sessionStorage.getItem('cixin-console-token') ?? ''; } catch { /* Storage may be disabled. */ }
export const connected = () => token.length > 0;
export async function api(path, options = {}) {
  if (!token) throw new Error('请先连接 Runtime');
  const response = await fetch(path, { ...options, cache: 'no-store', redirect: 'error',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? '令牌无效或已过期' : value.error ?? `HTTP ${response.status}`);
  return value;
}
export function bindConnection(onConnect, onDisconnect) {
  $('token').value = token;
  $('authForm').addEventListener('submit', event => {
    event.preventDefault(); token = $('token').value.trim();
    try { sessionStorage.setItem('cixin-console-token', token); } catch { /* Keep the in-memory token. */ }
    onConnect();
  });
  $('forgetToken').addEventListener('click', () => {
    token = ''; $('token').value = '';
    try { sessionStorage.removeItem('cixin-console-token'); } catch { /* No persistent session. */ }
    onDisconnect();
  });
  if (token) onConnect();
}
