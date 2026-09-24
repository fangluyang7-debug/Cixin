export const USER_MEMORY_PAYLOAD_ADAPTER = Symbol('USER_MEMORY_PAYLOAD_ADAPTER');

export interface UserProfileBlockInput {
  blockType: string;
  scope?: string;
  payload: Record<string, unknown>;
  sensitivity?: string;
}

export interface UserProfileIndexData {
  id: string;
  userId: string;
  blockId: string;
  key: string;
  value: string;
  scope: string;
  blockType: string;
}

export interface UserMemoryPayloadAdapter {
  parsePayload(payloadJson: string): Record<string, unknown>;
  validateBlockInput(input: UserProfileBlockInput): void;
  inferSensitivity(blockType: string): string;
  extractIndexes(input: {
    userId: string;
    blockId: string;
    blockType: string;
    scope: string;
    payload: Record<string, unknown>;
  }): UserProfileIndexData[];
}
