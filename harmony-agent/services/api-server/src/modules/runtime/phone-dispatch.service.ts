import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import sharp = require('sharp');
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { QueryImageCropResult } from '../sessions/application/query-image-content-adapter.interface';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const LEASE_MS = 60_000;
const CROP_WAIT_MS = 25_000;

interface CropInput {
  imageUrl: string;
  inputHash: string;
  region: { left: number; top: number; width: number; height: number };
  targetSize: number;
  jpegQuality: number;
  original: { width: number; height: number; format: string | null };
}

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

  // An explicit, off-by-default demo route for a real shopping image. The worker
  // must be recently polling; otherwise the normal cloud crop remains available.
  async cropForShopping(ownerUserId: string, imageUrl: string, imageBytes: Buffer,
    parameters: { box: { x: number; y: number; width: number; height: number };
      paddingRatio: number; targetSize: number; jpegQuality: number }, signal: AbortSignal):
    Promise<{ jobId: string; result: QueryImageCropResult } | null> {
    if (process.env.PHONE_DISPATCH_SHOPPING_DEMO_ENABLED !== 'true' ||
        process.env.PHONE_DISPATCH_EXPERIMENT_ENABLED !== 'true') return null;
    this.enabled();
    if (!/^https:\/\//.test(imageUrl) || imageUrl.length > 4096 || imageBytes.length > 8 * 1024 * 1024 ||
        !Number.isInteger(parameters.targetSize) || parameters.targetSize < 64 || parameters.targetSize > 1024) return null;
    const device = await this.prisma.phoneDispatchDevice.findFirst({
      where: { ownerUserId, status: 'active', lastSeenAt: { gt: new Date(Date.now() - 10_000) } },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (!device) return null;
    const active = await this.prisma.phoneDispatchJob.count({
      where: { deviceId: device.id, state: { in: ['PENDING', 'LEASED', 'STOP_REQUESTED'] } },
    });
    if (active > 0) return null;
    const metadata = await sharp(imageBytes, { limitInputPixels: 16 * 1024 * 1024 }).metadata();
    if (!metadata.width || !metadata.height) return null;
    const width = metadata.width, height = metadata.height, box = parameters.box;
    const cx = (box.x + box.width / 2) * width, cy = (box.y + box.height / 2) * height;
    const side = Math.min(Math.max(box.width * width, box.height * height) *
      (1 + parameters.paddingRatio * 2), Math.max(width, height));
    const left = Math.max(0, Math.min(width - 1, Math.round(cx - side / 2)));
    const top = Math.max(0, Math.min(height - 1, Math.round(cy - side / 2)));
    const right = Math.max(left + 1, Math.min(width, Math.round(cx + side / 2)));
    const bottom = Math.max(top + 1, Math.min(height, Math.round(cy + side / 2)));
    const input: CropInput = {
      imageUrl, inputHash: '',
      region: { left, top, width: right - left, height: bottom - top },
      targetSize: parameters.targetSize, jpegQuality: parameters.jpegQuality,
      original: { width, height, format: metadata.format ?? null },
    };
    // Hash raw bytes, not a signed URL whose query string can rotate.
    input.inputHash = createHash('sha256').update(imageBytes).digest('hex');
    const job = await this.prisma.phoneDispatchJob.create({
      data: { id: 'phonejob_' + randomUUID(), ownerUserId, workerUserId: device.workerUserId,
        deviceId: device.id, state: 'PENDING', kind: 'image.crop.v1',
        inputJson: JSON.stringify(input), inputHash: input.inputHash },
    });
    const deadline = Date.now() + CROP_WAIT_MS;
    try {
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const current = await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: job.id } });
        if (current.state === 'COMPLETED' && current.resultJson) {
          const stored = JSON.parse(current.resultJson) as { imageBase64: string };
          const bytes = Buffer.from(stored.imageBase64, 'base64');
          if (createHash('sha256').update(bytes).digest('hex') !== current.resultHash) {
            throw new Error('PHONE_CROP_RESULT_HASH_MISMATCH');
          }
          await this.prisma.phoneDispatchJob.update({ where: { id: job.id },
            data: { inputJson: '{}', resultJson: null } });
          return { jobId: job.id, result: {
            buffer: bytes, metadata: input.original, cropRegionPx: input.region,
            strategy: 'phone_crop_demo_' + device.id,
          } };
        }
        if (['FAILED', 'CANCELLED_SETTLED'].includes(current.state)) throw new Error('PHONE_CROP_FAILED');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('PHONE_CROP_TIMEOUT');
    } catch (error) {
      await this.cancel(ownerUserId, job.id);
      await this.prisma.phoneDispatchJob.update({ where: { id: job.id },
        data: { inputJson: '{}', resultJson: null } });
      throw error;
    }
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
    const active = await this.prisma.phoneDispatchJob.findFirst({
      where: { workerUserId, deviceId, state: 'LEASED' }, select: { id: true },
    });
    if (active) return { job: null, stopJobId: null };
    if (device.status !== 'active') return { job: null, stopJobId: null };
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await this.prisma.phoneDispatchJob.findFirst({
        where: { workerUserId, deviceId, state: 'PENDING' }, orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return { job: null, stopJobId: null };
      const now = new Date(), leaseUntil = new Date(now.getTime() + LEASE_MS);
      let updated;
      try {
        updated = await this.prisma.phoneDispatchJob.updateMany({
          where: { id: candidate.id, state: 'PENDING' },
          data: { state: 'LEASED', fence: { increment: 1 }, leasedAt: now, leaseUntil },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { job: null, stopJobId: null };
        }
        throw error;
      }
      if (updated.count === 1) return { job: { jobId: candidate.id, kind: candidate.kind,
        ...(candidate.kind === 'image.crop.v1'
          ? { crop: JSON.parse(candidate.inputJson) }
          : { rows: JSON.parse(candidate.inputJson) }),
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
    if (job.kind !== 'vector.norm.demo') throw new BadRequestException('RESULT_KIND_INVALID');
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

  async cropResult(workerUserId: string, deviceId: string, jobId: string, fence: number,
    imageBase64: string, inputHash: string, computedMs: number) {
    this.enabled();
    if (!Number.isSafeInteger(fence) || fence < 1 || !Number.isSafeInteger(computedMs) ||
        computedMs < 0 || computedMs > LEASE_MS || typeof imageBase64 !== 'string' ||
        imageBase64.length < 100 || imageBase64.length > 1_400_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new BadRequestException('CROP_RESULT_INVALID');
    const job = await this.prisma.phoneDispatchJob.findFirst({ where: { id: jobId, workerUserId, deviceId } });
    if (!job || job.kind !== 'image.crop.v1') throw new NotFoundException('JOB_NOT_FOUND');
    if (job.fence !== fence || !['LEASED', 'STOP_REQUESTED'].includes(job.state)) {
      throw new ConflictException('STALE_OR_REVOKED_LEASE');
    }
    if (job.state === 'STOP_REQUESTED' || !job.leaseUntil || job.leaseUntil.getTime() < Date.now()) {
      await this.prisma.phoneDispatchJob.updateMany({
        where: { id: jobId, fence, state: { in: ['LEASED', 'STOP_REQUESTED'] } },
        data: { state: 'CANCELLED_SETTLED', finishedAt: new Date() },
      });
      return this.publicJob(await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: jobId } }));
    }
    if (inputHash !== job.inputHash) throw new BadRequestException('CROP_INPUT_HASH_MISMATCH');
    const input = JSON.parse(job.inputJson) as CropInput;
    const bytes = Buffer.from(imageBase64, 'base64');
    if (bytes.length > 1_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new BadRequestException('CROP_IMAGE_INVALID');
    }
    const metadata = await sharp(bytes, { limitInputPixels: 1024 * 1024 }).metadata();
    if (metadata.format !== 'jpeg' || metadata.width !== input.targetSize ||
        metadata.height !== input.targetSize) throw new BadRequestException('CROP_DIMENSION_INVALID');
    const updated = await this.prisma.phoneDispatchJob.updateMany({
      where: { id: jobId, fence, state: 'LEASED' },
      data: { state: 'COMPLETED', resultHash: createHash('sha256').update(bytes).digest('hex'),
        resultJson: JSON.stringify({ imageBase64 }), computedMs, finishedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('STALE_OR_REVOKED_LEASE');
    return this.publicJob(await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: jobId } }));
  }

  async cropFailure(workerUserId: string, deviceId: string, jobId: string, fence: number) {
    this.enabled();
    if (!Number.isSafeInteger(fence) || fence < 1) throw new BadRequestException('FENCE_INVALID');
    const job = await this.prisma.phoneDispatchJob.findFirst({ where: { id: jobId, workerUserId, deviceId } });
    if (!job || job.kind !== 'image.crop.v1') throw new NotFoundException('JOB_NOT_FOUND');
    if (job.fence !== fence || !['LEASED', 'STOP_REQUESTED'].includes(job.state)) {
      throw new ConflictException('STALE_OR_REVOKED_LEASE');
    }
    const state = job.state === 'STOP_REQUESTED' || !job.leaseUntil || job.leaseUntil.getTime() < Date.now()
      ? 'CANCELLED_SETTLED' : 'FAILED';
    const updated = await this.prisma.phoneDispatchJob.updateMany({
      where: { id: jobId, workerUserId, deviceId, fence, state: job.state },
      data: { state, finishedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('STALE_OR_REVOKED_LEASE');
    return this.publicJob(await this.prisma.phoneDispatchJob.findUniqueOrThrow({ where: { id: jobId } }));
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
