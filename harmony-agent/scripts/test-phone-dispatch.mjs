import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const directory = await mkdtemp(join(tmpdir(), 'phone-dispatch-'));
process.env.DATABASE_URL = 'file:' + join(directory, 'test.db').replaceAll('\\', '/');
process.env.PHONE_DISPATCH_EXPERIMENT_ENABLED = 'true';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PhoneDispatchService } = require('../services/api-server/dist/src/modules/runtime/phone-dispatch.service.js');
const db = new PrismaClient();

async function migrate() {
  const sql = await readFile(new URL('../services/api-server/prisma/migrations/000005_phone_dispatch/migration.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
}

try {
  await migrate();
  const service = new PhoneDispatchService(db);
  const pairing = await service.createPairing('owner-A');
  await assert.rejects(service.claimPairing('owner-A', pairing.code));
  const device = await service.claimPairing('worker-B', pairing.code);
  await assert.rejects(service.claimPairing('worker-C', pairing.code));
  await assert.rejects(service.submit('stranger', device.deviceId));
  const pending = await service.submit('owner-A', device.deviceId);
  await assert.rejects(service.get('stranger', pending.jobId));
  const leased = await service.lease('worker-B', device.deviceId);
  assert.equal(leased.job.jobId, pending.jobId);
  assert.equal(leased.job.rows.length, 512);
  assert.equal((await service.lease('worker-B', device.deviceId)).job, null);
  assert.equal((await service.cancel('owner-A', pending.jobId)).state, 'STOP_REQUESTED');
  assert.equal((await service.get('owner-A', pending.jobId)).finishedAt, null);
  assert.equal((await service.lease('worker-B', device.deviceId)).stopJobId, pending.jobId);
  await assert.rejects(service.acknowledgeStop('stranger', device.deviceId, pending.jobId, leased.job.fence));
  assert.equal((await service.acknowledgeStop('worker-B', device.deviceId, pending.jobId, leased.job.fence)).state,
    'CANCELLED_SETTLED');
  await assert.rejects(service.result('worker-B', device.deviceId, pending.jobId,
    leased.job.fence, Array(512).fill(0), 1));
  const completed = await service.submit('owner-A', device.deviceId);
  const work = (await service.lease('worker-B', device.deviceId)).job;
  const norms = work.rows.map(row => Math.hypot(...row));
  const receipt = await service.result('worker-B', device.deviceId, completed.jobId, work.fence, norms, 20);
  assert.equal(receipt.state, 'COMPLETED');
  assert.ok(receipt.resultHash);
  const revokedJob = await service.submit('owner-A', device.deviceId);
  const revokedLease = (await service.lease('worker-B', device.deviceId)).job;
  await service.revoke('owner-A', device.deviceId);
  assert.equal((await service.lease('worker-B', device.deviceId)).stopJobId, revokedJob.jobId);
  await service.acknowledgeStop('worker-B', device.deviceId, revokedJob.jobId, revokedLease.fence);
  await assert.rejects(service.submit('owner-A', device.deviceId));
  console.log('phone-dispatch: pairing, ownership, lease, result, cancel, revoke PASS');
} finally {
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
