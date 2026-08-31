import { dayKeyOf, lastNLocalDayKeys, median } from "./time";
import type { FeedEvent } from "./types";

const MAX_FEED_GAP_MIN = 720; // 12h — same "data hole" pattern as wake windows

export function computeFeedsPerDayAvg(
  feeds: FeedEvent[],
  now: number,
  days = 7
): number | null {
  const keys = new Set(lastNLocalDayKeys(now, days));
  const counts = new Map<string, number>();

  for (const f of feeds) {
    const key = dayKeyOf(f.startMs);
    if (!keys.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  return [...counts.values()].reduce((a, b) => a + b, 0) / counts.size;
}

export type TypicalFeedInterval = {
  medianMinutes: number | null;
  excludedCount: number;
};

// Gaps are start-to-start (unlike sleep's end-to-start wake windows) since
// a feed's own duration isn't relevant to "how often does feeding happen".
export function computeTypicalFeedInterval(feeds: FeedEvent[]): TypicalFeedInterval {
  const sorted = [...feeds].sort((a, b) => a.startMs - b.startMs);

  const gaps: number[] = [];
  let excludedCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gapMin = (sorted[i].startMs - sorted[i - 1].startMs) / 60000;

    if (gapMin > MAX_FEED_GAP_MIN) {
      excludedCount++;
      continue;
    }

    gaps.push(gapMin);
  }

  return {
    medianMinutes: gaps.length ? median(gaps) : null,
    excludedCount,
  };
}

export function computeAtNightFeedPct(feeds: FeedEvent[]): number | null {
  if (feeds.length === 0) return null;

  const nightCount = feeds.filter((f) => {
    const hour = new Date(f.startMs).getHours();
    return hour >= 19 || hour < 7;
  }).length;

  return (nightCount / feeds.length) * 100;
}

export type FeedCountBar = {
  dayKey: string;
  count: number;
  pctOfMax: number;
};

export function computeFeedsPerDayLast7(
  feeds: FeedEvent[],
  now: number
): FeedCountBar[] {
  const keys = lastNLocalDayKeys(now, 7);

  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, 0);

  for (const f of feeds) {
    const key = dayKeyOf(f.startMs);
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maxCount = Math.max(1, ...counts.values());

  return keys.map((key) => ({
    dayKey: key,
    count: counts.get(key) ?? 0,
    pctOfMax: ((counts.get(key) ?? 0) / maxCount) * 100,
  }));
}

export type FeedDistributionLabel = "venstre" | "høyre" | "begge" | "flaske" | "pumpet";

export type FeedDistributionRow = {
  label: FeedDistributionLabel;
  count: number;
  sharePct: number;
};

// Share denominator is ALL feeds (including "food", which gets no row of its
// own). "pumpet" has no data source in this app today (no pumped feedtype)
// so it's always 0 and skipped, same as any other empty row.
export function computeFeedDistribution(feeds: FeedEvent[]): FeedDistributionRow[] {
  const total = feeds.length;
  if (total === 0) return [];

  const counts: Record<FeedDistributionLabel, number> = {
    venstre: 0,
    høyre: 0,
    begge: 0,
    flaske: 0,
    pumpet: 0,
  };

  for (const f of feeds) {
    if (f.feedType === "breast") {
      if (f.side === "left") counts.venstre++;
      else if (f.side === "right") counts["høyre"]++;
      else if (f.side === "both") counts.begge++;
    } else if (f.feedType === "bottle") {
      counts.flaske++;
    }
  }

  return (Object.keys(counts) as FeedDistributionLabel[])
    .filter((label) => counts[label] > 0)
    .map((label) => ({
      label,
      count: counts[label],
      sharePct: (counts[label] / total) * 100,
    }));
}
