import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const directory = await mkdtemp(join(tmpdir(), 'phone-dispatch-'));
process.env.DATABASE_URL = 'file:' + join(directory, 'test.db').replaceAll('\\', '/');
process.env.PHONE_DISPATCH_EXPERIMENT_ENABLED = 'true';
process.env.PHONE_DISPATCH_SHOPPING_DEMO_ENABLED = 'true';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
const { PhoneDispatchService } = require('../services/api-server/dist/src/modules/runtime/phone-dispatch.service.js');
const db = new PrismaClient();

async function migrate() {
  for (const name of ['000005_phone_dispatch', '000006_phone_dispatch_fence', '000007_phone_crop_demo']) {
    const sql = await readFile(new URL(`../services/api-server/prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
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
  const queuedBehind = await service.submit('owner-A', device.deviceId);
  assert.equal((await service.lease('worker-B', device.deviceId)).job, null);
  await service.cancel('owner-A', queuedBehind.jobId);
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
  const expired = await service.submit('owner-A', device.deviceId);
  const expiredLease = (await service.lease('worker-B', device.deviceId)).job;
  await db.phoneDispatchJob.update({ where: { id: expired.jobId },
    data: { leaseUntil: new Date(Date.now() - 1000) } });
  assert.equal((await service.lease('worker-B', device.deviceId)).stopJobId, expired.jobId);
  assert.equal((await service.get('owner-A', expired.jobId)).state, 'STOP_REQUESTED');
  assert.equal((await service.get('owner-A', expired.jobId)).finishedAt, null);
  await service.acknowledgeStop('worker-B', device.deviceId, expired.jobId, expiredLease.fence);
  const concurrentA = await service.submit('owner-A', device.deviceId);
  const concurrentB = await service.submit('owner-A', device.deviceId);
  const concurrentLeases = await Promise.all([
    service.lease('worker-B', device.deviceId), service.lease('worker-B', device.deviceId),
  ]);
  assert.equal(concurrentLeases.filter(item => item.job !== null).length, 1);
  const activeLease = concurrentLeases.find(item => item.job !== null).job;
  await service.cancel('owner-A', activeLease.jobId);
  await service.acknowledgeStop('worker-B', device.deviceId, activeLease.jobId, activeLease.fence);
  await service.cancel('owner-A', activeLease.jobId === concurrentA.jobId ? concurrentB.jobId : concurrentA.jobId);
  const imageBytes = await sharp({ create: { width: 80, height: 80, channels: 3,
    background: { r: 35, g: 65, b: 95 } } }).jpeg().toBuffer();
  await service.lease('worker-B', device.deviceId); // refresh the worker heartbeat
  const cropPromise = service.cropForShopping('owner-A', 'https://example.test/image.jpg', imageBytes,
    { box: { x: 0, y: 0, width: 1, height: 1 }, paddingRatio: 0, targetSize: 64, jpegQuality: 80 },
    new AbortController().signal);
  let cropJob;
  for (let i = 0; i < 30; i++) {
    cropJob = await db.phoneDispatchJob.findFirst({ where: { kind: 'image.crop.v1' } });
    if (cropJob) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(cropJob);
  const cropLease = (await service.lease('worker-B', device.deviceId)).job;
  assert.equal(cropLease.kind, 'image.crop.v1');
  assert.equal(cropLease.crop.inputHash, cropJob.inputHash);
  const cropOutput = await sharp(imageBytes).resize(64, 64).jpeg().toBuffer();
  await assert.rejects(service.cropResult('worker-B', device.deviceId, cropJob.id,
    cropLease.fence, cropOutput.toString('base64'), 'wrong-hash', 4));
  const cropReceipt = await service.cropResult('worker-B', device.deviceId, cropJob.id,
    cropLease.fence, cropOutput.toString('base64'), cropJob.inputHash, 4);
  assert.equal(cropReceipt.state, 'COMPLETED');
  const cropped = await cropPromise;
  assert.equal(cropped.jobId, cropJob.id);
  assert.deepEqual(cropped.result.buffer, cropOutput);
  const failedCropPromise = service.cropForShopping('owner-A', 'https://example.test/image.jpg', imageBytes,
    { box: { x: 0, y: 0, width: 1, height: 1 }, paddingRatio: 0, targetSize: 64, jpegQuality: 80 },
    new AbortController().signal);
  let failedCrop;
  for (let i = 0; i < 30; i++) {
    failedCrop = await db.phoneDispatchJob.findFirst({ where: { kind: 'image.crop.v1', state: 'PENDING' } });
    if (failedCrop) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(failedCrop);
  const failedLease = (await service.lease('worker-B', device.deviceId)).job;
  assert.equal((await service.cropFailure('worker-B', device.deviceId, failedCrop.id, failedLease.fence)).state, 'FAILED');
  await assert.rejects(failedCropPromise);
  const revokedJob = await service.submit('owner-A', device.deviceId);
  const revokedLease = (await service.lease('worker-B', device.deviceId)).job;
  await service.revoke('owner-A', device.deviceId);
  assert.equal((await service.lease('worker-B', device.deviceId)).stopJobId, revokedJob.jobId);
  await service.acknowledgeStop('worker-B', device.deviceId, revokedJob.jobId, revokedLease.fence);
  await assert.rejects(service.submit('owner-A', device.deviceId));
  console.log('phone-dispatch: pairing, ownership, lease, crop, result, cancel, expiry, revoke PASS');
} finally {
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
