export class CreateUserProfileBlockDto {
  blockType: string;
  scope?: string;
  payload: Record<string, unknown>;
  source?: string;
  confidence?: number;
  sensitivity?: 'low' | 'medium' | 'high';
}

export class UpdateUserProfileBlockDto {
  blockType?: string;
  scope?: string;
  payload?: Record<string, unknown>;
  sensitivity?: 'low' | 'medium' | 'high';
  status?: 'active' | 'deleted';
}

export class SaveShoeSizePreferenceDto {
  deviceId?: string;
  shoeSize: string;
}
