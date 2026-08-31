// Raw row shapes (mirror the Supabase columns used by services/sleepService.ts
// and services/feedService.ts). Kept local so this module never imports from
// ../services/* or ../lib/supabase — it must stay pure and testable.

export type RawSleepRow = {
  id: string;
  starttime: string;
  endtime: string | null;
  durationminutes: number | null;
  rate: string | null;
  note?: string | null;
  sleep_type: string;
};

export type RawFeedRow = {
  id: string;
  feedtype: "bottle" | "breast" | "food";
  side: "left" | "right" | "both" | null;
  amountml: number | null;
  starttime: string;
  endtime: string | null;
  durationminutes: number | null;
  note: string | null;
};

// Normalized domain types. All times are epoch ms (never Date/string) so the
// module stays trivially testable and serialization-agnostic.

export type SleepSession = {
  id: string;
  startMs: number;
  endMs: number;
  durationMin: number;
  rate: number | null;
  note: string | null;
  sleepTypeRaw: string;
};

export type ActiveSleep = {
  id: string;
  startMs: number;
};

export type FeedEvent = {
  id: string;
  startMs: number;
  endMs: number | null;
  durationMin: number | null;
  feedType: "bottle" | "breast" | "food";
  side: "left" | "right" | "both" | null;
  amountMl: number | null;
  note: string | null;
};

export type ResolvedSleepType = "night" | "nap";

export type InsightId =
  | "busiest-window"
  | "typical-rhythm"
  | "bedtime-consistency"
  | "best-day-last-7"
  | "night-share"
  | "avg-duration-comparison"
  | "quality-average"
  | "quality-trend"
  | "nap-consistency"
  | "median-wake-window"
  | "wake-window-trend"
  | "missing-data"
  | "long-sleep-milestone"
  | "daily-share"
  | "fallback-no-data";

export type Insight = {
  id: InsightId;
  payload: Record<string, number | string | null>;
};
