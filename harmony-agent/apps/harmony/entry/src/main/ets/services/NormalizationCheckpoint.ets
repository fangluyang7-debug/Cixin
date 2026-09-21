export interface NormalizationProgress {
  cursor: number;
  dimension: number;
  modelVersion: string;
  norms: number[];
}

export function validateNormalizationProgress(progress: NormalizationProgress,
  modelVersion: string, dimension: number, count: number): void {
  if (progress.modelVersion !== modelVersion || progress.dimension !== dimension ||
    !Number.isInteger(progress.cursor) || progress.cursor < 0 || progress.cursor !== progress.norms.length ||
    progress.cursor > count) { throw new Error('Checkpoint does not match the current index.'); }
}

export function appendNormalizationValues(progress: NormalizationProgress, values: number[], end: number): void {
  if (values.length !== end - progress.cursor || values.some((value: number) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Invalid norm chunk.');
  }
  values.forEach((value: number) => progress.norms.push(value));
  progress.cursor = end;
}
