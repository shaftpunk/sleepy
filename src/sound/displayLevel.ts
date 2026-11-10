// Visual calibration only. Detection/persisted RMS must never use these values.
export function soundDisplayTarget(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const dbFS = 20 * Math.log10(Math.min(1, rms));
  const normalized = Math.max(0, Math.min(1, (dbFS + 70) / 60));
  return normalized ** 1.4; // Quiet floor stays subtle; speech expands clearly.
}
export class SoundDisplayEnvelope {
  private value = 0;
  update(rms: number, elapsedMs = 60): number {
    const target = soundDisplayTarget(rms);
    const timeConstant = target >= this.value ? 25 : 180;
    const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / timeConstant);
    this.value += (target - this.value) * alpha;
    return Math.max(0, Math.min(1, this.value));
  }
}
