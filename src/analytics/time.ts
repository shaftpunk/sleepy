export function two(n: number): string {
  return String(n).padStart(2, "0");
}

// Plain average of the two middle values for even-length input (no rank
// interpolation) — every caller here already gates on a minimum sample size
// before calling this, so empty input (NaN) should never surface in the UI.
export function median(numbers: number[]): number {
  if (numbers.length === 0) return NaN;

  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[mid];

  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sameDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// Ascending oldest -> today (inclusive). n=7 => 7 keys.
export function lastNLocalDayKeys(now: number, n: number): string[] {
  const todayStart = startOfLocalDay(now);
  const out: string[] = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    out.push(dayKeyOf(d.getTime()));
  }

  return out;
}

export function minutesSinceLocalMidnight(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function minutesToClockLabel(minutesSinceMidnight: number): string {
  const total = ((Math.round(minutesSinceMidnight) % 1440) + 1440) % 1440;
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

// Circular mean of a list of "minutes since local midnight" values. Averaging
// clock times naively would put 23:50 and 00:10 at noon; this treats each
// time as an angle on a 24h circle instead.
//
// Degenerate case: if inputs are perfectly bimodal/opposed, sin/cos sums both
// tend to 0 and atan2(0,0)===0 silently returns midnight — a real but rare
// edge case, not specially flagged in the return value.
export function circularMeanTimeOfDay(minutesList: number[]): number {
  if (minutesList.length === 0) return NaN;

  let sinSum = 0;
  let cosSum = 0;

  for (const m of minutesList) {
    const angle = (m / 1440) * 2 * Math.PI;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }

  const meanAngle = Math.atan2(
    sinSum / minutesList.length,
    cosSum / minutesList.length
  );

  let minutes = (meanAngle / (2 * Math.PI)) * 1440;
  if (minutes < 0) minutes += 1440;

  return minutes;
}

export function average(numbers: number[]): number {
  if (numbers.length === 0) return NaN;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}
