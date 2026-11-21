export type OnsetPeak = {
  peakTime: number;
  windowStart: number;
  windowEnd: number;
  effectiveDays: number;
  anchorEnd: number;
};

type Evidence = { minutes: number; weight: number; dayKey: string; similarity: number };
const minute = 60000;
const grid = 5 * minute;

/** Relative onset density, conditional on the current wake interval still being open. */
export function estimateOnsetPeak(samples: Evidence[], anchorEnd: number, now: number,
  lower: number, upper: number, caution: number, deviation: number): OnsetPeak | undefined {
  const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const weights = new Map<string, number>();
  for (const sample of samples) weights.set(sample.dayKey, (weights.get(sample.dayKey) ?? 0) + sample.weight);
  const effectiveDays = total ** 2 / [...weights.values()].reduce((sum, w) => sum + w ** 2, 0);
  if (!(effectiveDays >= 5) || samples.reduce((sum, s) => sum + s.weight * s.similarity, 0) < .65 * total) return;

  const bandwidth = 5 + 5 * caution + 10 / Math.sqrt(effectiveDays) + deviation / 3;
  const points: { time: number; score: number }[] = [];
  for (let time = lower; time <= upper; time += grid) {
    const horizon = (time - now) / minute;
    const width = bandwidth + Math.max(0, horizon) / 90;
    const score = samples.reduce((sum, s) => {
      const distance = ((time - anchorEnd) / minute - s.minutes) / width;
      return sum + s.weight * Math.exp(-.5 * distance ** 2);
    }, 0) / (total * width);
    points.push({ time, score });
  }
  const best = points.reduce((a,b) => a.score > b.score ? a : b);
  const index = points.indexOf(best);
  if (index === 0 || index === points.length - 1 || best.time <= now) return;
  if (points.some((p,i) => Math.abs(i-index) >= 2 && p.score >= .8 * best.score &&
    p.score >= (points[i-1]?.score ?? 0) && p.score >= (points[i+1]?.score ?? 0))) return;
  let left = index, right = index;
  while (left > 0 && points[left-1].score >= .5 * best.score) left--;
  while (right+1 < points.length && points[right+1].score >= .5 * best.score) right++;
  if (left === 0 || right === points.length-1 || points[right].time - points[left].time > 60 * minute) return;
  return { peakTime: best.time, windowStart: points[left-1].time, windowEnd: points[right+1].time, effectiveDays, anchorEnd };
}
