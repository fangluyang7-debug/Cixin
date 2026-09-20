import { Injectable } from '@nestjs/common';
import { UserMemoryProposal } from '@prisma/client';
import { fromJson } from '../../../common/utils/json';
import {
  UserMemoryViewAdapter,
  UserProfileBlockRecord,
} from './user-memory-view-adapter.interface';

@Injectable()
export class StandardUserMemoryViewAdapterService implements UserMemoryViewAdapter {
  toProfile(userId: string, blocks: UserProfileBlockRecord[]): Record<string, unknown> {
    return {
      userId,
      blocks: blocks.map((block) => this.toBlockView(block)),
    };
  }

  toBlockView(block: UserProfileBlockRecord): Record<string, unknown> {
    return {
      blockId: block.id,
      blockType: block.blockType,
      scope: block.scope,
      payload: fromJson<Record<string, unknown>>(block.payloadJson, {}),
      source: block.source,
      confidence: block.confidence,
      sensitivity: block.sensitivity,
      schemaVersion: block.schemaVersion,
      status: block.status,
      indexes: block.indexes?.map((index) => ({
        key: index.key,
        value: index.value,
        scope: index.scope,
      })),
      createdAt: block.createdAt.toISOString(),
      updatedAt: block.updatedAt.toISOString(),
    };
  }

  toProposalView(proposal: UserMemoryProposal): Record<string, unknown> {
    return {
      proposalId: proposal.id,
      userId: proposal.userId,
      sessionId: proposal.sessionId,
      turnIndex: proposal.turnIndex,
      blockType: proposal.blockType,
      scope: proposal.scope,
      payload: fromJson<Record<string, unknown>>(proposal.payloadJson, {}),
      sourceText: proposal.sourceText,
      reason: proposal.reason,
      status: proposal.status,
      confidence: proposal.confidence,
      sensitivity: proposal.sensitivity,
      schemaVersion: proposal.schemaVersion,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
    };
  }
}
