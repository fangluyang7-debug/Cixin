// USB-only dual-phone dispatch experiment. Synthetic vectors only; no shopping data.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.DUAL_PHONE_LAB_PORT || 8766);
const token = process.env.DUAL_PHONE_LAB_TOKEN || randomBytes(18).toString('base64url');
if (token.length < 24) throw new Error('DUAL_PHONE_LAB_TOKEN must contain at least 24 characters');
const jobs = new Map();
const MAX_BODY = 128 * 1024;
const TTL_MS = 60_000;
const KEEP_MS = 10 * 60_000;

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
}
function authorized(req) {
  const got = req.headers.authorization?.replace(/^Bearer /, '') || '';
  const a = Buffer.from(got), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function json(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function validRows(rows) {
  return Array.isArray(rows) && rows.length >= 1 && rows.length <= 512 &&
    rows.every(row => Array.isArray(row) && row.length === 8 &&
      row.every(value => Number.isFinite(value) && Math.abs(value) <= 1000));
}
function publicJob(job) {
  return { jobId: job.id, state: job.state, workerId: job.workerId,
    createdAt: job.createdAt, leasedAt: job.leasedAt, finishedAt: job.finishedAt,
    computeMs: job.computeMs, inputHash: job.inputHash, resultHash: job.resultHash,
    error: job.error };
}
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: 'UNAUTHORIZED' });
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > KEEP_MS) jobs.delete(id);
      else if ((job.state === 'LEASED' && now - job.leasedAt > TTL_MS) ||
          (job.state === 'PENDING' && now - job.createdAt > TTL_MS * 2)) {
        job.state = 'EXPIRED'; job.error = 'LEASE_TIMEOUT'; job.finishedAt = now; job.rows = null;
      }
    }
    if (req.url === '/jobs' && req.method === 'POST') {
      const body = await json(req);
      if (!validRows(body.rows)) return send(res, 400, { error: 'INVALID_INPUT' });
      if (jobs.size >= 128) return send(res, 503, { error: 'JOB_CAPACITY_FULL' });
      const id = randomUUID(), inputHash = createHash('sha256').update(JSON.stringify(body.rows)).digest('hex');
      const job = { id, rows: body.rows, inputHash, state: 'PENDING', workerId: null,
        createdAt: Date.now(), leasedAt: null, finishedAt: null, computeMs: null,
        resultHash: null, error: null, fence: 0 };
      jobs.set(id, job);
      return send(res, 201, { jobId: id, state: job.state, inputHash });
    }
    if (req.url === '/lease' && req.method === 'POST') {
      const body = await json(req);
      if (typeof body.workerId !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(body.workerId))
        return send(res, 400, { error: 'INVALID_WORKER' });
      const job = [...jobs.values()].find(item => item.state === 'PENDING');
      if (!job) return send(res, 200, { job: null });
      job.state = 'LEASED'; job.workerId = body.workerId; job.leasedAt = now; job.fence += 1;
      return send(res, 200, { job: { jobId: job.id, rows: job.rows, inputHash: job.inputHash,
        fence: job.fence, deadlineAt: now + TTL_MS } });
    }
    if (req.url === '/result' && req.method === 'POST') {
      const body = await json(req), job = jobs.get(body.jobId);
      if (!job) return send(res, 404, { error: 'JOB_NOT_FOUND' });
      if (job.state !== 'LEASED' || body.fence !== job.fence ||
          body.workerId !== job.workerId || Date.now() - job.leasedAt > TTL_MS)
        return send(res, 409, { error: 'STALE_OR_REVOKED_LEASE' });
      if (!Array.isArray(body.norms) || body.norms.length !== job.rows.length ||
          !body.norms.every(Number.isFinite) || !Number.isFinite(body.computeMs) || body.computeMs < 0)
        return send(res, 400, { error: 'INVALID_RESULT' });
      const verified = body.norms.every((norm, index) => {
        const expected = Math.hypot(...job.rows[index]);
        return Math.abs(norm - expected) <= 1e-8 * Math.max(1, expected);
      });
      job.finishedAt = Date.now(); job.computeMs = body.computeMs;
      job.state = verified ? 'COMPLETED' : 'FAILED';
      job.error = verified ? null : 'RESULT_MISMATCH';
      job.resultHash = verified ? createHash('sha256').update(JSON.stringify(body.norms)).digest('hex') : null;
      job.rows = null;
      return send(res, verified ? 200 : 422, publicJob(job));
    }
    if (req.url?.startsWith('/jobs/') && req.method === 'GET') {
      const job = jobs.get(req.url.slice(6));
      return job ? send(res, 200, publicJob(job)) : send(res, 404, { error: 'JOB_NOT_FOUND' });
    }
    if ((req.url?.startsWith('/jobs/') && req.method === 'DELETE') ||
        (req.url === '/cancel' && req.method === 'POST')) {
      const id = req.url === '/cancel' ? (await json(req)).jobId : req.url.slice(6);
      const job = jobs.get(id);
      if (!job) return send(res, 404, { error: 'JOB_NOT_FOUND' });
      if (job.state === 'PENDING' || job.state === 'LEASED') {
        job.state = 'CANCELLED'; job.error = 'CANCELLED'; job.finishedAt = Date.now(); job.rows = null;
      }
      return send(res, 200, publicJob(job));
    }
    return send(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    return send(res, error.message === 'BODY_TOO_LARGE' ? 413 : 400,
      { error: error.message === 'BODY_TOO_LARGE' ? error.message : 'BAD_REQUEST' });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log('Dual-phone lab (loopback only) listening on 127.0.0.1:' + port);
  console.log('Pairing code: ' + token);
});
