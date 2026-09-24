import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '../../../common/utils/id';
import { toJsonString } from '../../../common/utils/json';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { CreateUserProfileBlockDto, UpdateUserProfileBlockDto } from '../dto/user-memory.dto';
import { UserProfileSchemaRegistryService } from './user-profile-schema-registry.service';
import {
  USER_MEMORY_PAYLOAD_ADAPTER,
  UserMemoryPayloadAdapter,
  UserProfileIndexData,
} from './user-memory-payload-adapter.interface';
import {
  USER_MEMORY_VIEW_ADAPTER,
  UserMemoryViewAdapter,
} from './user-memory-view-adapter.interface';

@Injectable()
export class UserMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schemaRegistry: UserProfileSchemaRegistryService,
    @Inject(USER_MEMORY_PAYLOAD_ADAPTER)
    private readonly payloadAdapter: UserMemoryPayloadAdapter,
    @Inject(USER_MEMORY_VIEW_ADAPTER)
    private readonly viewAdapter: UserMemoryViewAdapter,
  ) {}

  async getProfile(userId: string) {
    const blocks = await this.prisma.userProfileBlock.findMany({
      where: { userId, status: 'active' },
      orderBy: [{ scope: 'asc' }, { blockType: 'asc' }, { updatedAt: 'desc' }],
      include: { indexes: true },
    });
    return this.viewAdapter.toProfile(userId, blocks);
  }

  async getLocalShoeSizePreference(deviceId?: string) {
    const userId = await this.ensureLocalPreferenceUser(deviceId);
    const block = await this.prisma.userProfileBlock.findFirst({
      where: {
        userId,
        blockType: 'size_profile',
        scope: 'shoe',
        status: 'active',
      },
      orderBy: { updatedAt: 'desc' },
    });
    const payload = block ? this.payloadAdapter.parsePayload(block.payloadJson) : {};
    return {
      userId,
      deviceId: this.normalizeDeviceId(deviceId),
      shoeSize: typeof payload.shoeSize === 'string' ? payload.shoeSize : null,
      updatedAt: block?.updatedAt.toISOString() ?? null,
    };
  }

  async saveLocalShoeSizePreference(deviceId: string | undefined, shoeSize: string) {
    const normalizedSize = this.normalizeShoeSize(shoeSize);
    const userId = await this.ensureLocalPreferenceUser(deviceId);
    const payload = { shoeSize: normalizedSize };
    const existing = await this.prisma.userProfileBlock.findFirst({
      where: {
        userId,
        blockType: 'size_profile',
        scope: 'shoe',
        status: 'active',
      },
      orderBy: { updatedAt: 'desc' },
    });

    const block = existing
      ? await this.updateBlock(userId, existing.id, {
          blockType: 'size_profile',
          scope: 'shoe',
          payload,
          sensitivity: 'high',
        })
      : await this.createBlock(userId, {
          blockType: 'size_profile',
          scope: 'shoe',
          payload,
          source: 'mvp_local_preference',
          confidence: 1,
          sensitivity: 'high',
        });

    return {
      userId,
      deviceId: this.normalizeDeviceId(deviceId),
      shoeSize: normalizedSize,
      block,
    };
  }

  async createBlock(userId: string, dto: CreateUserProfileBlockDto) {
    this.payloadAdapter.validateBlockInput(dto);
    const blockType = dto.blockType;
    const scope = dto.scope ?? 'global';
    const schemaVersion = this.schemaRegistry.getSchemaVersion({ blockType, scope });
    const payload = dto.payload;
    const indexes = this.payloadAdapter.extractIndexes({
      userId,
      blockId: '',
      blockType,
      scope,
      payload,
    });
    const blockId = createId('profile_block');

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userProfileBlock.create({
        data: {
          id: blockId,
          userId,
          blockType,
          scope,
          payloadJson: toJsonString(payload),
          source: dto.source ?? 'user_edit',
          confidence: dto.confidence ?? 1,
          sensitivity: dto.sensitivity ?? this.payloadAdapter.inferSensitivity(blockType),
          schemaVersion,
        },
      });
      await this.createIndexes(tx, indexes.map((index) => ({ ...index, blockId })));
      await this.createAudit(tx, {
        userId,
        blockId,
        action: 'create_block',
        source: dto.source ?? 'user_edit',
        after: { blockType, scope, payload },
      });
      return created;
    });

    return this.viewAdapter.toBlockView(block);
  }

  async updateBlock(userId: string, blockId: string, dto: UpdateUserProfileBlockDto) {
    const existing = await this.prisma.userProfileBlock.findFirst({
      where: { id: blockId, userId, status: 'active' },
    });
    if (!existing) throw new NotFoundException('USER_PROFILE_BLOCK_NOT_FOUND');

    const blockType = dto.blockType ?? existing.blockType;
    const scope = dto.scope ?? existing.scope;
    const payload = dto.payload ?? this.payloadAdapter.parsePayload(existing.payloadJson);
    this.payloadAdapter.validateBlockInput({ blockType, scope, payload, sensitivity: dto.sensitivity });
    const schemaVersion = this.schemaRegistry.getSchemaVersion({ blockType, scope });
    const indexes = this.payloadAdapter.extractIndexes({ userId, blockId, blockType, scope, payload });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userProfileIndex.deleteMany({ where: { blockId } });
      const result = await tx.userProfileBlock.update({
        where: { id: blockId },
        data: {
          blockType,
          scope,
          payloadJson: toJsonString(payload),
          sensitivity: dto.sensitivity ?? existing.sensitivity,
          schemaVersion,
          status: dto.status ?? existing.status,
        },
      });
      await this.createIndexes(tx, indexes);
      await this.createAudit(tx, {
        userId,
        blockId,
        action: 'update_block',
        source: 'user_edit',
        before: this.viewAdapter.toBlockView(existing),
        after: { blockType, scope, payload },
      });
      return result;
    });

    return this.viewAdapter.toBlockView(updated);
  }

  async deleteBlock(userId: string, blockId: string) {
    const existing = await this.prisma.userProfileBlock.findFirst({
      where: { id: blockId, userId, status: 'active' },
    });
    if (!existing) throw new NotFoundException('USER_PROFILE_BLOCK_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.userProfileIndex.deleteMany({ where: { blockId } });
      await tx.userProfileBlock.update({ where: { id: blockId }, data: { status: 'deleted' } });
      await this.createAudit(tx, {
        userId,
        blockId,
        action: 'delete_block',
        source: 'user_edit',
        before: this.viewAdapter.toBlockView(existing),
      });
    });
    return { blockId, status: 'deleted' };
  }

  async listProposals(userId: string) {
    const proposals = await this.prisma.userMemoryProposal.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return { items: proposals.map((proposal) => this.viewAdapter.toProposalView(proposal)) };
  }

  async confirmProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.userMemoryProposal.findFirst({
      where: { id: proposalId, userId, status: 'pending' },
    });
    if (!proposal) throw new NotFoundException('USER_MEMORY_PROPOSAL_NOT_FOUND');
    const payload = this.payloadAdapter.parsePayload(proposal.payloadJson);
    const blockId = createId('profile_block');
    const indexes = this.payloadAdapter.extractIndexes({
      userId,
      blockId,
      blockType: proposal.blockType,
      scope: proposal.scope,
      payload,
    });

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userProfileBlock.create({
        data: {
          id: blockId,
          userId,
          blockType: proposal.blockType,
          scope: proposal.scope,
          payloadJson: proposal.payloadJson,
          source: 'user_confirmed_proposal',
          confidence: proposal.confidence,
          sensitivity: proposal.sensitivity,
          schemaVersion: proposal.schemaVersion,
        },
      });
      await this.createIndexes(tx, indexes);
      await tx.userMemoryProposal.update({
        where: { id: proposal.id },
        data: { status: 'confirmed' },
      });
      await this.createAudit(tx, {
        userId,
        blockId,
        proposalId,
        action: 'confirm_proposal',
        source: 'user_confirmation',
        after: { blockType: proposal.blockType, scope: proposal.scope, payload },
      });
      return created;
    });

    return {
      proposal: { ...this.viewAdapter.toProposalView(proposal), status: 'confirmed' },
      block: this.viewAdapter.toBlockView(block),
    };
  }

  async rejectProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.userMemoryProposal.findFirst({
      where: { id: proposalId, userId, status: 'pending' },
    });
    if (!proposal) throw new NotFoundException('USER_MEMORY_PROPOSAL_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.userMemoryProposal.update({ where: { id: proposal.id }, data: { status: 'rejected' } });
      await this.createAudit(tx, {
        userId,
        proposalId,
        action: 'reject_proposal',
        source: 'user_confirmation',
        before: this.viewAdapter.toProposalView(proposal),
      });
    });
    return { proposalId, status: 'rejected' };
  }

  async createProposal(input: {
    userId: string;
    sessionId?: string;
    turnIndex?: number;
    blockType: string;
    scope?: string;
    payload: Record<string, unknown>;
    sourceText?: string;
    reason?: string;
    confidence?: number;
    sensitivity?: string;
  }) {
    this.payloadAdapter.validateBlockInput({
      blockType: input.blockType,
      scope: input.scope,
      payload: input.payload,
      sensitivity: input.sensitivity as 'low' | 'medium' | 'high' | undefined,
    });
    const scope = input.scope ?? 'global';
    const schemaVersion = this.schemaRegistry.getSchemaVersion({ blockType: input.blockType, scope });
    const payloadJson = toJsonString(input.payload);
    const existingPending = await this.prisma.userMemoryProposal.findFirst({
      where: {
        userId: input.userId,
        blockType: input.blockType,
        scope,
        payloadJson,
        status: 'pending',
      },
    });
    if (existingPending) return null;
    const proposal = await this.prisma.userMemoryProposal.create({
      data: {
        id: createId('mem_prop'),
        userId: input.userId,
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        blockType: input.blockType,
        scope,
        payloadJson,
        sourceText: input.sourceText,
        reason: input.reason,
        confidence: input.confidence ?? 0.75,
        sensitivity: input.sensitivity ?? this.payloadAdapter.inferSensitivity(input.blockType),
        schemaVersion,
      },
    });
    return this.viewAdapter.toProposalView(proposal);
  }

  private async createIndexes(
    tx: Prisma.TransactionClient,
    indexes: UserProfileIndexData[],
  ) {
    if (indexes.length === 0) return;
    await tx.userProfileIndex.createMany({ data: indexes });
  }

  private async createAudit(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      blockId?: string;
      proposalId?: string;
      action: string;
      source: string;
      before?: unknown;
      after?: unknown;
    },
  ) {
    await tx.userMemoryAuditLog.create({
      data: {
        id: createId('mem_audit'),
        userId: input.userId,
        blockId: input.blockId,
        proposalId: input.proposalId,
        action: input.action,
        source: input.source,
        beforeJson: toJsonString(input.before ?? {}),
        afterJson: toJsonString(input.after ?? {}),
      },
    });
  }

  private async ensureLocalPreferenceUser(deviceId?: string) {
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const userId = `user_local_${normalizedDeviceId}`;
    await this.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${normalizedDeviceId}@local.mvp`,
        displayName: 'Local MVP User',
      },
    });
    return userId;
  }

  private normalizeDeviceId(deviceId?: string) {
    const raw = deviceId?.trim() || 'default_device';
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default_device';
  }

  private normalizeShoeSize(shoeSize: string) {
    if (typeof shoeSize !== 'string' || shoeSize.trim().length === 0) {
      throw new BadRequestException('SHOE_SIZE_REQUIRED');
    }
    const normalized = shoeSize.trim();
    if (!/^\d{2}(\.5)?$/.test(normalized)) {
      throw new BadRequestException('SHOE_SIZE_INVALID');
    }
    return normalized;
  }
}
