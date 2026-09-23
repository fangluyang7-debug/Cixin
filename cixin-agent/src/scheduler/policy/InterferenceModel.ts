interface PairSample {
  count: number;
  slowdown: number;
}

export class InterferenceModel {
  private readonly pairs: Map<string, PairSample> = new Map<string, PairSample>();

  public observe(first: string, second: string, actualMs: number,
    soloEstimateMs: number, soloSamples: number): void {
    if (soloSamples < 5 || !Number.isFinite(actualMs) || !Number.isFinite(soloEstimateMs) ||
      actualMs <= 0 || soloEstimateMs <= 0) { return; }
    const ratio: number = Math.max(0.5, Math.min(4, actualMs / soloEstimateMs));
    const key: string = this.key(first, second);
    let sample = this.pairs.get(key);
    if (sample === undefined) {
      if (this.pairs.size >= 128) { this.pairs.delete(Array.from(this.pairs.keys())[0]); }
      sample = { count: 0, slowdown: ratio };
      this.pairs.set(key, sample);
    } else {
      sample.slowdown = sample.slowdown * 0.75 + ratio * 0.25;
    }
    sample.count++;
  }

  public slowdown(first: string, second: string): number | null {
    const sample = this.pairs.get(this.key(first, second));
    return sample === undefined || sample.count < 3 ? null : sample.slowdown;
  }

  private key(first: string, second: string): string {
    return first < second ? `${first}|${second}` : `${second}|${first}`;
  }
}
