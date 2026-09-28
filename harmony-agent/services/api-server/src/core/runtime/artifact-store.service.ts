import { encodeShoppingPayload } from './shopping-payload';
import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { createId } from '../../common/utils/id';
import { ArtifactManifest, ArtifactRef, validArtifactRef } from './scheduling-protocol';

// Canonical JSON v1: UTF-8, sorted object keys, JSON scalar encoding, array order retained.
// Reject values JSON would silently drop/coerce. Decimal money remains a string.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new BadRequestException('ARTIFACT_NON_JSON_VALUE');
}
export const contentHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

@Injectable()
export class ArtifactStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async publishImage(ownerId: string, assetId: string, bytes: Buffer, mediaType: string): Promise<ArtifactRef> {
    if (!ownerId || bytes.length === 0) throw new BadRequestException('ARTIFACT_INVALID_CONTENT');
    const record = await this.prisma.artifactRecord.create({ data: {
      id: createId('artifact'), ownerId, kind: 'shopping.image', schemaId: 'shopping.image', schemaVersion: 1,
      contentVersion: 1, contentHash: contentHash(bytes), sizeBytes: bytes.length, mediaType,
      state: 'COMMITTED', expiresAt: new Date(Date.now() + 7 * 86400000), locatorJson: canonicalJson({ assetId }), dependenciesJson: '[]',
    } });
    return this.ref(record);
  }

  async publishObject(ownerId: string, locator: { bucketGroup: string; objectKey: string }, bytes: Buffer, mediaType: string): Promise<ArtifactRef> {
    if (!ownerId || !locator.bucketGroup || !locator.objectKey || bytes.length === 0) throw new BadRequestException('ARTIFACT_INVALID_CONTENT');
    const row = await this.prisma.artifactRecord.create({ data: { id: createId('artifact'), ownerId, kind: 'shopping.image',
      schemaId: 'shopping.image', schemaVersion: 1, contentVersion: 1, contentHash: contentHash(bytes), sizeBytes: bytes.length,
      mediaType, state: 'COMMITTED', expiresAt: new Date(Date.now() + 7 * 86400000), locatorJson: canonicalJson(locator), dependenciesJson: '[]' } });
    return this.ref(row);
  }

  async publishJson(ownerId: string, schemaId: string, value: unknown, dependencies: ArtifactRef[] = []): Promise<ArtifactRef> {
    if (!ownerId || !/^[a-z][a-z0-9_.-]{0,127}$/.test(schemaId)) throw new BadRequestException('ARTIFACT_SCHEMA_INVALID');
    const payloadJson = canonicalJson(encodeShoppingPayload(schemaId, value));
    if (Buffer.byteLength(payloadJson) > 1024 * 1024) throw new BadRequestException('ARTIFACT_INLINE_TOO_LARGE');
    for (const dependency of dependencies) await this.read(ownerId, dependency);
    const record = await this.prisma.artifactRecord.create({ data: {
      id: createId('artifact'), ownerId, kind: schemaId, schemaId, schemaVersion: 1, contentVersion: 1,
      contentHash: contentHash(Buffer.from(payloadJson)), sizeBytes: Buffer.byteLength(payloadJson),
      mediaType: 'application/json', state: 'COMMITTED', expiresAt: new Date(Date.now() + 7 * 86400000), locatorJson: '{}', payloadJson,
      dependenciesJson: canonicalJson(dependencies),
    } });
    return this.ref(record);
  }

  async read(ownerId: string, reference: ArtifactRef) {
    if (!ownerId || !validArtifactRef(reference)) throw new BadRequestException('ARTIFACT_REF_INVALID');
    const record = await this.prisma.artifactRecord.findFirst({ where: { id: reference.artifactId, ownerId,
      state: 'COMMITTED', contentVersion: reference.contentVersion, contentHash: reference.contentHash,
      schemaId: reference.schemaId, schemaVersion: reference.schemaVersion } });
    if (!record || (record.expiresAt && record.expiresAt.getTime() <= Date.now())) throw new NotFoundException('ARTIFACT_NOT_FOUND');
    if (record.payloadJson !== null && (Buffer.byteLength(record.payloadJson) !== record.sizeBytes ||
      contentHash(Buffer.from(record.payloadJson)) !== record.contentHash)) throw new NotFoundException('ARTIFACT_NOT_FOUND');
    return record;
  }

  async imageAsset(ownerId: string, reference: ArtifactRef): Promise<string> {
    const record = await this.read(ownerId, reference);
    if (record.kind !== 'shopping.image') throw new BadRequestException('ARTIFACT_KIND_INVALID');
    const locator = JSON.parse(record.locatorJson) as { assetId: string };
    const asset = await this.prisma.imageAsset.findFirst({ where: { id: locator.assetId, ownerUserId: ownerId, uploadStatus: 'uploaded' } });
    if (!asset) throw new NotFoundException('ARTIFACT_NOT_FOUND');
    return asset.id;
  }

  async manifest(ownerId: string, reference: ArtifactRef): Promise<ArtifactManifest> {
    const record = await this.read(ownerId, reference);
    return { protocolVersion: 1, ref: this.ref(record), kind: record.kind, state: 'COMMITTED',
      sizeBytes: record.sizeBytes, hashAlgorithm: 'sha256', mediaType: record.mediaType, ownerId,
      privacy: 'AUTHORIZED_REMOTE', locations: [{ deviceId: 'cloud-runtime', resolver: record.payloadJson === null ? 'object_store' : 'database', locatorId: record.id }],
      dependencies: JSON.parse(record.dependenciesJson) as ArtifactRef[], createdAt: record.createdAt.getTime(),
      expiresAt: record.expiresAt?.getTime() ?? null };
  }

  async pin(ownerId: string, reference: ArtifactRef, holderId: string, visited = new Set<string>()): Promise<void> {
    if (visited.has(reference.artifactId)) return;
    visited.add(reference.artifactId);
    const record = await this.read(ownerId, reference);
    for (const dependency of JSON.parse(record.dependenciesJson) as ArtifactRef[]) await this.pin(ownerId, dependency, holderId, visited);
    await this.prisma.artifactPin.upsert({ where: { artifactId_holderId: { artifactId: reference.artifactId, holderId } },
      create: { artifactId: reference.artifactId, holderId, ownerId }, update: {} });
  }
  async retireTerminalWorkflows(now = new Date()): Promise<number> {
    const before=new Date(now.getTime()-7*86400000);
    return this.prisma.publication(async()=>{
      const terminal=await this.prisma.workflowExecution.findMany({where:{state:{in:['COMMITTED','CANCELLED','EXPIRED']},updatedAt:{lt:before}},select:{id:true,ownerId:true}});
      let count=0;
      for(const workflow of terminal) count+=(await this.prisma.artifactPin.deleteMany({where:{holderId:workflow.id,ownerId:workflow.ownerId}})).count;
      return count;
    });
  }
  async release(ownerId: string, holderId: string): Promise<void> {
    await this.prisma.artifactPin.deleteMany({ where: { ownerId, holderId } });
  }
  async expireUnpinned(before: Date): Promise<number> {
    return this.prisma.publication(async () => {
      const pinned = await this.prisma.artifactPin.findMany({ select: { artifactId: true } });
      const result = await this.prisma.artifactRecord.updateMany({ where: { state: 'COMMITTED',
        id: { notIn: pinned.map(item => item.artifactId) }, expiresAt: { lte: before } }, data: { state: 'EXPIRED' } });
      return result.count;
    });
  }

  private ref(record: { id: string; contentVersion: number; contentHash: string; schemaId: string; schemaVersion: number }): ArtifactRef {
    return { artifactId: record.id, contentVersion: record.contentVersion, contentHash: record.contentHash,
      schemaId: record.schemaId, schemaVersion: record.schemaVersion };
  }
}
