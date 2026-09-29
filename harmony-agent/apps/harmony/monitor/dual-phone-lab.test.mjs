import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 18766;
const child = spawn(process.execPath, ['apps/harmony/monitor/dual-phone-lab.mjs'], {
  cwd: new URL('../../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  env: { ...process.env, DUAL_PHONE_LAB_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let token = '';
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  output += chunk;
  token = output.match(/Pairing code: ([\w-]+)/)?.[1] || token;
});
try {
  for (let i = 0; i < 50 && !token; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(token, 'coordinator did not start: ' + output);
  const request = async (method, path, data, auth = token) => {
    const response = await fetch('http://127.0.0.1:' + port + path, {
      method, headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('POST', '/jobs', { rows: [[3, 4, 0, 0, 0, 0, 0, 0]] }, 'wrong')).status, 401);
  assert.equal((await request('POST', '/jobs', { rows: [[1, 2]] })).status, 400);
  const created = await request('POST', '/jobs', { rows: [[3, 4, 0, 0, 0, 0, 0, 0]] });
  assert.equal(created.status, 201);
  const lease = (await request('POST', '/lease', { workerId: 'phone-B' })).body.job;
  assert.equal(lease.jobId, created.body.jobId);
  assert.equal(lease.rows.length, 1);
  const completed = await request('POST', '/result', {
    jobId: lease.jobId, workerId: 'phone-B', fence: lease.fence, norms: [5], computeMs: 1
  });
  assert.equal(completed.body.state, 'COMPLETED');
  assert.equal((await request('POST', '/result', {
    jobId: lease.jobId, workerId: 'phone-B', fence: lease.fence, norms: [5], computeMs: 1
  })).status, 409);
  const second = await request('POST', '/jobs', { rows: [[3, 4, 0, 0, 0, 0, 0, 0]] });
  const secondLease = (await request('POST', '/lease', { workerId: 'phone-B' })).body.job;
  assert.equal(second.body.jobId, secondLease.jobId);
  assert.equal((await request('POST', '/cancel', { jobId: secondLease.jobId })).body.state, 'CANCELLED');
  assert.equal((await request('POST', '/result', {
    jobId: secondLease.jobId, workerId: 'phone-B', fence: secondLease.fence, norms: [5], computeMs: 1
  })).status, 409);
  assert.equal((await request('GET', '/jobs/' + secondLease.jobId)).body.state, 'CANCELLED');
  console.log('dual-phone-lab protocol tests passed');
} finally {
  child.kill();
  await once(child, 'exit').catch(() => {});
}
