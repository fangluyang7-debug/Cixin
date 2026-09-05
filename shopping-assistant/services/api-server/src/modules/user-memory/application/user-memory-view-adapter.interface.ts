import {
  UserMemoryProposal,
  UserProfileBlock,
  UserProfileIndex,
} from '@prisma/client';

export const USER_MEMORY_VIEW_ADAPTER = Symbol('USER_MEMORY_VIEW_ADAPTER');

export type UserProfileBlockRecord = UserProfileBlock & {
  indexes?: Array<Pick<UserProfileIndex, 'key' | 'value' | 'scope'>>;
};

export interface UserMemoryViewAdapter {
  toProfile(userId: string, blocks: UserProfileBlockRecord[]): Record<string, unknown>;
  toBlockView(block: UserProfileBlockRecord): Record<string, unknown>;
  toProposalView(proposal: UserMemoryProposal): Record<string, unknown>;
}
