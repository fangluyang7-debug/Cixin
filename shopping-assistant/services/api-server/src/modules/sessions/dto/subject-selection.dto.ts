export interface NormalizedSubjectBoxDto {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  label?: string;
}

export interface UpdateSubjectSelectionDto {
  assetId?: string;
  box: NormalizedSubjectBoxDto;
  selectionSource?: 'user_adjusted' | 'manual' | 'auto';
}
