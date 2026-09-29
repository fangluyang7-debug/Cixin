import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../persistence/prisma/prisma.service';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const LEASE_MS = 60_000;

function fixture(): number[][] {
  return Array.from({ length: 512 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => ((i * 37 + j * 19) % 997 - 498) / 10));
}

@Injectable()
export class PhoneDispatchService {
  constructor(private readonly prisma: PrismaService) {}

  private enabled(): void {
    if (process.env.PHONE_DISPATCH_EXPERIMENT_ENABLED !== 'true') {
      throw new ServiceUnavailableException('PHONE_DISPATCH_EXPERIMENT_DISABLED');
    }
  }

  async createPairing(ownerUserId: string) {
    this.enabled();
    const active = await this.prisma.phoneDispatchPairing.count({
      where: { ownerUserId, claimedAt: null, expiresAt: { gt: new Date() } },
    });
    if (active >= 3) throw new ConflictException('PAIRING_LIMIT_REACHED');
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.prisma.phoneDispatchPairing.create({
      data: { id: randomUUID(), ownerUserId, codeHash: hash(code), expiresAt },
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async claimPairing(workerUserId: string, code: string) {
    this.enabled();
    if (!/^[A-Za-z0-9_-]{24}$/.test(code)) throw new BadRequestException('PAIRING_CODE_INVALID');
    const codeHash = hash(code), now = new Date();
    const pairing = await this.prisma.phoneDispatchPairing.findUnique({ where: { codeHash } });
    if (!pairing || pairing.claimedAt || pairing.expiresAt <= now || pairing.ownerUserId === workerUserId) {
      throw new ForbiddenException('PAIRING_UNAVAILABLE');
    }
    const deviceId = 'phone_' + randomUUID();
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.phoneDispatchPairing.updateMany({
        where: { id: pairing.id, claimedAt: null, expiresAt: { gt: now } },
        data: { claimedAt: now },
      });
      if (claimed.count !== 1) throw new ConflictException('PAIRING_ALREADY_CLAIMED');
      await tx.phoneDispatchDevice.create({
        data: { id: deviceId, ownerUserId: pairing.ownerUserId, workerUserId },
      });
    });
    return { deviceId, ownerUserId: pairing.ownerUserId };
  }

  async devices(ownerUserId: string) {
    this.enabled();
    return this.prisma.phoneDispatchDevice.findMany({
      where: { ownerUserId, status: 'active' },
      select: { id: true, status: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 8,
    });
  }

  async revoke(ownerUserId: string, deviceId: string) {
    this.enabled();
    const changed = await this.prisma.phoneDispatchDevice.updateMany({
      where: { id: deviceId, ownerUserId, status: 'active' }, data: { status: 'revoked' },
    });
    if (changed.count !== 1) throw new NotFoundException('DEVICE_NOT_FOUND');
    // A leased task is not physically settled merely because the device was revoked.
    await this.prisma.phoneDispatchJob.updateMany({
      where: { deviceId, state: 'LEASED' }, data: { state: 'STOP_REQUESTED' },
    });
    await this.prisma.phoneDispatchJob.updateMany({
      where: { deviceId, state: 'PENDING' }, data: { state: 'CANCELLED_SETTLED', finishedAt: new Date() },
    });
    return { deviceId, status: 'revoked' };
  }

  async submit(ownerUserId: string, deviceId: string) {
    this.enabled();
    const outstanding = await this.prisma.phoneDispatchJob.count({
      where: { ownerUserId, state: { in: ['PENDING', 'LEASED', 'STOP_REQUESTED'] } },
    });
    if (outstanding >= 3) throw new ConflictException('JOB_LIMIT_REACHED');
    const device = await this.prisma.phoneDispatchDevice.findFirst({
      where: { id: deviceId, ownerUserId, status: 'active' },
    });
    if (!device) throw new NotFoundException('DEVICE_NOT_FOUND');
    const inputJson = JSON.stringify(fixture());
    const job = await this.prisma.phoneDispatchJob.create({
      data: { id: 'phonejob_' + randomUUID(), ownerUserId, workerUserId: device.workerUserId,
        deviceId, state: 'PENDING', inputJson, inputHash: hash(inputJson) },
    });
    return this.publicJob(job);
  }

  async get(ownerUserId: string, jobId: string) {
    this.enabled();
    const job = await this.prisma.phoneDispatchJob.findFirst({ where: { id: jobId, ownerUserId } });
    if (!job) throw new NotFoundException('JOB_NOT_FOUND');
    return this.publicJob(job);
  }

  async cancel(ownerUserId: string, jobId: string) {
    this.enabled();
    const job = await this.prisma.phoneDispatchJob.findFirst({ where: { id: jobId, ownerUserId } });
    if (!job) throw new NotFoundException('JOB_NOT_FOUND');
    if (job.state === 'PENDING') {
      await this.prisma.phoneDispatchJob.updateMany({
        where: { id: jobId, state: 'PENDING' },
        data: { state: 'CANCELLED_SETTLED', finishedAt: new Date() },
      });
    } else if (job.state === 'LEASED') {
      await this.prisma.phoneDispatchJob.updateMany({
        where: { id: jobId, state: 'LEASED' }, data: { state: 'STOP_REQUESTED' },
      });
    }
    return this.get(ownerUserId, jobId);
  }

  async lease(workerUserId: string, deviceId: string) {
    this.enabled();
    const device = await this.prisma.phoneDispatchDevice.findFirst({
      where: { id: deviceId, workerUserId },
    });
    if (!device) throw new ForbiddenException('DEVICE_NOT_OWNED');
    await this.prisma.phoneDispatchDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
    // Expiry requests a stop; it cannot claim that execution has physically ended.
    await this.prisma.phoneDispatchJob.updateMany({
      where: { workerUserId, deviceId, state: 'LEASED', leaseUntil: { lt: new Date() } },
      data: { state: 'STOP_REQUESTED' },
    });
    const stop = await this.prisma.phoneDispatchJob.findFirst({
      where: { workerUserId, deviceId, state: 'STOP_REQUESTED' }, orderBy: { createdAt: 'asc' },
    });
    if (stop) return { job: null, stopJobId: stop.id, fence: stop.fence };
    if (device.status !== 'active') return { job: null, stopJobId: null };
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await this.prisma.phoneDispatchJob.findFirst({
        where: { workerUserId, deviceId, state: 'PENDING' }, orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return { job: null, stopJobId: null };
      const now = new Date(), leaseUntil = new Date(now.getTime() + LEASE_MS);
      const updated = await this.prisma.phoneDispatchJob.updateMany({
        where: { id: candidate.id, state: 'PENDING' },
        data: { state: 'LEASED', fence: { increment: 1 }, leasedAt: now, leaseUntil },
      });
      if (updated.count === 1) return { job: { jobId: candidate.id, rows: JSON.parse(candidate.inputJson),
        inputHash: candidate.inputHash, fence: candidate.fence + 1, deadlineAt: leaseUntil.toISOString() },
        stopJobId: null };
    }
    return { job: null, stopJobId: null };
  }

  async result(workerUserId: string, deviceId: string, jobId: string, fence: number,
    norms: number[], computedMs: number) {
    this.enabled();
    if (!Number.isSafeInteger(fence) || fence < 1 || !Number.isSafeInteger(computedMs) ||
        computedMs < 0 || computedMs > LEASE_MS ||
        !Array.isArray(norms) || norms.length !== 512 || !norms.every(Number.isFinite)) {
      throw new BadRequestException('RESULT_INVALID');
    }
    const job = await this.prisma.phoneDispatchJob.findFirst({ where: { id: jobId, workerUserId, deviceId } });
    if (!job) throw new NotFoundException('JOB_NOT_FOUND');
    if (job.fence !== fence || !['LEASED', 'STOP_REQUESTED'].includes(job.state)) {
      throw new ConflictException('STALE_OR_REVOKED_LEASE');
    }
    if (job.state === 'STOP_REQUESTED' || !job.leaseUntil || job.leaseUntil.getTime() < Date.now()) {
      await this.prisma.phoneDispatchJob.updateMany({
        where: { id: jobId, fence, state: { in: ['LEASED', 'STOP_REQUESTED'] } },
        data: { state: 'CANCELLED_SETTLED', finishedAt: new Date() },
      });
      return this.publicJob((await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: jobId } })));
    }
    const rows = JSON.parse(job.inputJson) as number[][];
    const matches = norms.every((norm, i) =>
      Math.abs(norm - Math.hypot(...rows[i])) <= 1e-8 * Math.max(1, Math.hypot(...rows[i])));
    const updated = await this.prisma.phoneDispatchJob.updateMany({
      where: { id: jobId, fence, state: 'LEASED' },
      data: { state: matches ? 'COMPLETED' : 'FAILED', resultHash: matches ? hash(JSON.stringify(norms)) : null,
        computedMs, finishedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('STALE_OR_REVOKED_LEASE');
    return this.publicJob((await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: jobId } })));
  }

  async acknowledgeStop(workerUserId: string, deviceId: string, jobId: string, fence: number) {
    this.enabled();
    const updated = await this.prisma.phoneDispatchJob.updateMany({
      where: { id: jobId, workerUserId, deviceId, fence, state: 'STOP_REQUESTED' },
      data: { state: 'CANCELLED_SETTLED', finishedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('STOP_ACK_REJECTED');
    return { jobId, state: 'CANCELLED_SETTLED' };
  }

  private publicJob(job: { id: string; deviceId: string; state: string; fence: number;
    inputHash: string; resultHash: string | null; computedMs: number | null;
    createdAt: Date; leasedAt: Date | null; finishedAt: Date | null }) {
    return { jobId: job.id, deviceId: job.deviceId, state: job.state, fence: job.fence,
      inputHash: job.inputHash, resultHash: job.resultHash, computedMs: job.computedMs,
      createdAt: job.createdAt, leasedAt: job.leasedAt, finishedAt: job.finishedAt };
  }
}
