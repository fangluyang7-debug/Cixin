export type UserProfileBlockType =
  | 'identity_basic'
  | 'body_measurements'
  | 'size_profile'
  | 'shopping_preferences'
  | 'platform_preferences'
  | 'brand_store_preferences'
  | 'category_preferences'
  | 'delivery_preferences'
  | 'interaction_preferences';

export type UserProfileSensitivity = 'normal' | 'sensitive';

export type UserProfileBlockContract = {
  userId: string;
  blockType: UserProfileBlockType;
  scope: string;
  payload: Record<string, unknown>;
  source: string;
  confidence: number;
  sensitivity: UserProfileSensitivity;
  schemaVersion: string;
  status: 'active' | 'archived' | 'pending';
  createdAt?: string;
  updatedAt?: string;
};

export type UserMemoryProposalContract = {
  userId: string;
  sessionId?: string | null;
  proposalType: 'create' | 'update' | 'delete';
  targetBlockType: UserProfileBlockType;
  targetScope: string;
  payload: Record<string, unknown>;
  confidence: number;
  sensitivity: UserProfileSensitivity;
  reason: string;
  raw: Record<string, unknown>;
};
