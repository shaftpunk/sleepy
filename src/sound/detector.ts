export type Sensitivity = "low" | "medium" | "high";
// RMS amplitude, not calibrated decibels. Device gain affects these values.
export const THRESHOLDS: Record<Sensitivity, number> = { low: 0.12, medium: 0.06, high: 0.025 };
export type SoundObservation = {
  started_at: string;
  ended_at: string;
  avg_level: number;
  max_level: number;
};

export class SoundDetector {
  private start: number | null = null;
  private quietSince: number | null = null;
  private last: number | null = null;
  private sum = 0;
  private count = 0;
  private peak = 0;
  detected = false;

  private threshold: number;
  private emit: (event: SoundObservation) => void;
  constructor(threshold: number, emit: (event: SoundObservation) => void) {
    this.threshold = threshold; this.emit = emit;
  }

  sample(level: number, now: number) {
    if (!Number.isFinite(level) || !Number.isFinite(now)) return;
    // Never bridge a suspended tab or a stalled sampling loop.
    if (this.last !== null && (now - this.last > 1000 || now < this.last)) this.flush(this.last);
    this.last = now;
    level = Math.max(0, Math.min(1, level));
    if (level >= this.threshold) {
      if (this.start === null) this.start = now;
      this.quietSince = null;
      this.sum += level;
      this.count++;
      this.peak = Math.max(this.peak, level);
      if (now - this.start >= 2000) this.detected = true;
    } else if (this.detected) {
      if (this.quietSince === null) this.quietSince = now;
      if (now - this.quietSince >= 2500) this.flush(this.quietSince);
      else { this.sum += level; this.count++; }
    } else {
      this.reset(); // A click or short noise is not a sustained event.
    }
  }

  flush(now: number) {
    if (this.detected && this.start !== null && this.count > 0) {
      this.emit({ started_at: new Date(this.start).toISOString(),
        ended_at: new Date(Math.max(this.start, Math.min(now, this.quietSince ?? now))).toISOString(),
        avg_level: this.sum / this.count, max_level: this.peak });
    }
    this.reset();
    this.last = null;
  }

  private reset() {
    this.start = null; this.quietSince = null; this.sum = 0;
    this.count = 0; this.peak = 0; this.detected = false;
  }
}
