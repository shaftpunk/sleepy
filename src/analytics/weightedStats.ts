export type WeightedValue = { value: number; weight: number };
// Inverse weighted empirical CDF: returns an observed value (no invented count).
export function weightedPercentile(samples: WeightedValue[], percentile: number): number | null {
  const sorted = samples.filter(s => Number.isFinite(s.value) && Number.isFinite(s.weight) && s.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!sorted.length || !Number.isFinite(percentile)) return null;
  const target = Math.max(0, Math.min(1, percentile)) * sorted.reduce((sum, s) => sum + s.weight, 0);
  let cumulative = 0;
  for (const s of sorted) { cumulative += s.weight; if (cumulative >= target) return s.value; }
  return sorted[sorted.length - 1].value;
}
export const weightedMedian = (samples: WeightedValue[]) => weightedPercentile(samples, 0.5);
export function weightedMean(samples: WeightedValue[]): number | null {
  const valid = samples.filter(s => Number.isFinite(s.value) && Number.isFinite(s.weight) && s.weight > 0);
  const total = valid.reduce((sum, s) => sum + s.weight, 0);
  return total ? valid.reduce((sum, s) => sum + s.value * s.weight, 0) / total : null;
}
export function weightedDistribution<T>(samples: { value: T; weight: number }[]): Map<T, number> {
  const result = new Map<T, number>();
  for (const s of samples) if (Number.isFinite(s.weight) && s.weight > 0) result.set(s.value, (result.get(s.value) ?? 0) + s.weight);
  return result;
}
const clockDistance = (a: number, b: number) => ((a - b + 2160) % 1440) - 720;
// Circular L1 medoid chooses an observed clock time minimizing weighted distance.
// Unlike a circular mean it resists isolated extremes and cannot land in a gap
// between two timing clusters. Ties use clock order, independent of input order.
export function weightedClockMedian(samples: WeightedValue[]): number | null {
  const valid = samples.filter(s => Number.isFinite(s.value) && Number.isFinite(s.weight) && s.weight > 0);
  if (!valid.length) return null;
  let best = Infinity, result = 0;
  for (const candidate of [...new Set(valid.map(s => s.value))].sort((a, b) => a - b)) {
    const cost = valid.reduce((sum, s) => sum + s.weight * Math.abs(clockDistance(candidate, s.value)), 0);
    if (cost < best) { best = cost; result = candidate; }
  }
  return result;
}
export function weightedClockDeviation(samples: WeightedValue[], pivot: number): number | null {
  const variance = weightedMean(samples.map(s => ({ value: clockDistance(s.value, pivot) ** 2, weight: s.weight })));
  return variance == null ? null : Math.sqrt(variance);
}
