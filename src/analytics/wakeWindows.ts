import { dayKeyOf, median } from "./time";
import type { SleepSession } from "./types";

// Gaps longer than this are missing-data holes (a forgotten log), not real
// wake windows.
export const MAX_WAKE_MIN = 480;

export type WakeWindow = {
  index: number;
  dayKey: string;
  minutes: number;
  startTs: number;
  endTs: number;
};

export type WakeWindowResult = {
  windows: WakeWindow[];
  excludedGapCount: number;
  skippedOverlapCount: number;
};

export type WakeWindowGroupLabel = "1st" | "2nd" | "3rd" | "4th+";

export type WakeWindowGroup = {
  label: WakeWindowGroupLabel;
  medianMinutes: number | null;
  count: number;
};

// Anchor day for a window is the local calendar day of the PRECEDING
// session's end (the day whose sleep just ended) — a window from 23:50 to
// 00:20 the next day belongs to the first day's count, not the second's.
export function computeWakeWindows(sessions: SleepSession[]): WakeWindowResult {
  const sorted = [...sessions].sort((a, b) => a.startMs - b.startMs);

  const windows: WakeWindow[] = [];
  let excludedGapCount = 0;
  let skippedOverlapCount = 0;
  const dayCounters = new Map<string, number>();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gapMin = (curr.startMs - prev.endMs) / 60000;

    if (gapMin < 0) {
      skippedOverlapCount++;
      continue;
    }

    if (gapMin > MAX_WAKE_MIN) {
      excludedGapCount++;
      continue;
    }

    const anchorDayKey = dayKeyOf(prev.endMs);
    const idx = dayCounters.get(anchorDayKey) ?? 0;

    windows.push({
      index: idx,
      dayKey: anchorDayKey,
      minutes: gapMin,
      startTs: prev.endMs,
      endTs: curr.startMs,
    });

    dayCounters.set(anchorDayKey, idx + 1);
  }

  return { windows, excludedGapCount, skippedOverlapCount };
}

// Always returns all 4 groups, even with count 0 — lets the UI decide
// whether to hide an empty group.
export function groupWakeWindows(windows: WakeWindow[]): WakeWindowGroup[] {
  const buckets: number[][] = [[], [], [], []];

  for (const w of windows) {
    buckets[Math.min(w.index, 3)].push(w.minutes);
  }

  const labels: WakeWindowGroupLabel[] = ["1st", "2nd", "3rd", "4th+"];

  return buckets.map((arr, i) => ({
    label: labels[i],
    medianMinutes: arr.length ? median(arr) : null,
    count: arr.length,
  }));
}
