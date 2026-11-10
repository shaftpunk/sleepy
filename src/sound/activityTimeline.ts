import type { SleepRecord } from "../services/sleepService";
import type { SoundEvent } from "../services/soundEventService";

// Presentation calibration only; never feed these cutoffs into sound detection.
export function soundActivityIntensity(maxLevel: number): "low" | "medium" | "high" {
  return maxLevel >= 0.2 ? "high" : maxLevel >= 0.08 ? "medium" : "low";
}

export function soundActivityTimeline(sleep: Pick<SleepRecord, "id" | "baby_id" | "starttime" | "endtime">, events: SoundEvent[], width = 240) {
  const start = Date.parse(sleep.starttime), end = Date.parse(sleep.endtime ?? "");
  const span = end - start;
  const valid = Number.isFinite(start) && Number.isFinite(end) && span > 0;
  const pixels = Number.isFinite(width) ? Math.max(1, width) : 240;
  const seen = new Set<string>();
  const visible = valid ? events.flatMap(event => {
    const from = Date.parse(event.started_at), to = Date.parse(event.ended_at);
    const displayStart = Math.max(from, start), displayEnd = Math.min(to, end);
    if (event.sleep_id !== sleep.id || event.baby_id !== sleep.baby_id || seen.has(event.id) ||
      !Number.isFinite(from) || !Number.isFinite(to) || displayEnd <= displayStart) return [];
    seen.add(event.id);
    return [{ event, from, to, displayStart, displayEnd, durationMs: to - from,
      visibleDurationMs: displayEnd - displayStart, intensity: soundActivityIntensity(event.max_level) }];
  }).sort((a, b) => a.displayStart - b.displayStart || a.event.id.localeCompare(b.event.id)) : [];

  let totalMs = 0, mergedStart = 0, mergedEnd = 0;
  const laneEnds: number[] = [];
  const items = visible.map((item, index) => {
    if (index === 0 || item.displayStart > mergedEnd) {
      if (index) totalMs += mergedEnd - mergedStart;
      mergedStart = item.displayStart; mergedEnd = item.displayEnd;
    } else mergedEnd = Math.max(mergedEnd, item.displayEnd);
    const trueLeft = (item.displayStart - start) / span * pixels;
    const trueWidth = item.visibleDurationMs / span * pixels;
    // Tiny intervals expand around their true center, contained within the track.
    const visualWidth = Math.min(pixels, Math.max(5, trueWidth));
    const visualLeft = Math.max(0, Math.min(pixels - visualWidth, trueLeft + trueWidth / 2 - visualWidth / 2));
    const hitWidth = Math.min(pixels, Math.max(28, visualWidth));
    const hitLeft = Math.max(0, Math.min(pixels - hitWidth, visualLeft + visualWidth / 2 - hitWidth / 2));
    // Allocate against hit regions too, so short overlapping events remain tappable.
    let lane = laneEnds.findIndex(right => right <= hitLeft);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = hitLeft + hitWidth + 2;
    return { ...item, lane, left: visualLeft / pixels * 100, width: visualWidth / pixels * 100,
      hitLeft: hitLeft / pixels * 100, hitWidth: hitWidth / pixels * 100 };
  });
  if (items.length) totalMs += mergedEnd - mergedStart;
  const fractions = span >= 2 * 3600000 ? [0, .25, .5, .75, 1] : span >= 120000 ? [0, .5, 1] : [0, 1];
  return { valid, start, end, span, items, totalMs, lanes: Math.max(1, laneEnds.length),
    markers: valid ? fractions.map(fraction => ({ fraction, time: start + span * fraction })) : [] };
}
