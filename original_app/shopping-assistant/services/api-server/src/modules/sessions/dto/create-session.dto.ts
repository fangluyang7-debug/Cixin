import { NormalizedSubjectBoxDto } from "./subject-selection.dto";

export interface InitialSubjectSelectionDto {
  box: NormalizedSubjectBoxDto;
  selectionSource?: "user_initial" | "manual" | "auto";
}

export class CreateSessionDto {
  assetId: string;
  entrySource?: "android_app" | "judge_demo" | "unknown";
  categoryHint?: string;
  filters?: Record<string, unknown>;
  initialSubjectSelection?: InitialSubjectSelectionDto;
}
