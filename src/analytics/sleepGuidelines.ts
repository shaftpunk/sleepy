// General age-based sleep guidance — the starting baseline for the
// age -> personal -> prediction model. Every duration is stored in minutes.
// This is guidance only, never a medical assessment (see the UI disclaimer
// wired through analysis.ageGuide.disclaimer).

export type SleepGuideline = {
  minDays: number;
  maxDays: number;
  minMonths: number;
  maxMonths: number;
  totalSleepMin: number;
  totalSleepMax: number;
  napsMin: number;
  napsMax: number;
  wakeWindowMin: number;
  wakeWindowMax: number;
};

const HOUR = 60;

// Month ranges converted to day ranges at 30 days/month so the eleven
// intervals tile 0-365 days (the first year) with no gaps or overlaps.
export const SLEEP_GUIDELINES: SleepGuideline[] = [
  { minDays: 0, maxDays: 30, minMonths: 0, maxMonths: 1, totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 5, napsMax: 8, wakeWindowMin: 30, wakeWindowMax: 60 },
  { minDays: 31, maxDays: 60, minMonths: 1, maxMonths: 2, totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 4, napsMax: 6, wakeWindowMin: 45, wakeWindowMax: 75 },
  { minDays: 61, maxDays: 90, minMonths: 2, maxMonths: 3, totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 4, napsMax: 5, wakeWindowMin: 60, wakeWindowMax: 90 },
  { minDays: 91, maxDays: 120, minMonths: 3, maxMonths: 4, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 4, napsMax: 5, wakeWindowMin: 60, wakeWindowMax: 120 },
  { minDays: 121, maxDays: 150, minMonths: 4, maxMonths: 5, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 4, wakeWindowMin: 90, wakeWindowMax: 150 },
  { minDays: 151, maxDays: 180, minMonths: 5, maxMonths: 6, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 4, wakeWindowMin: 120, wakeWindowMax: 150 },
  { minDays: 181, maxDays: 210, minMonths: 6, maxMonths: 7, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 3, wakeWindowMin: 120, wakeWindowMax: 180 },
  { minDays: 211, maxDays: 240, minMonths: 7, maxMonths: 8, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 3, wakeWindowMin: 120, wakeWindowMax: 180 },
  { minDays: 241, maxDays: 270, minMonths: 8, maxMonths: 9, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 3, wakeWindowMin: 150, wakeWindowMax: 210 },
  { minDays: 271, maxDays: 330, minMonths: 9, maxMonths: 11, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 2, wakeWindowMin: 150, wakeWindowMax: 240 },
  { minDays: 331, maxDays: 365, minMonths: 11, maxMonths: 12, totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 2, wakeWindowMin: 180, wakeWindowMax: 240 },
];

// The last configured day covered by the table — beyond this the UI must
// say the guide only covers the first year, not silently reuse the last row.
export const MAX_GUIDELINE_DAYS = SLEEP_GUIDELINES[SLEEP_GUIDELINES.length - 1].maxDays;

export type GuidelineLookup =
  | { status: "found"; guideline: SleepGuideline }
  | { status: "too-old" }
  | { status: "unknown" };

// `ageDays` is null when there's no valid birth date at all (unknown), vs. a
// non-null age past MAX_GUIDELINE_DAYS (too-old) — the UI shows a different
// empty state for each.
export function getGuidelineForAgeDays(ageDays: number | null): GuidelineLookup {
  if (ageDays == null || ageDays < 0) return { status: "unknown" };
  if (ageDays > MAX_GUIDELINE_DAYS) return { status: "too-old" };

  const guideline = SLEEP_GUIDELINES.find(
    (g) => ageDays >= g.minDays && ageDays <= g.maxDays
  );

  return guideline ? { status: "found", guideline } : { status: "too-old" };
}

export type ComparisonStatus = "below" | "within" | "above" | "insufficient-data";

export function compareToRange(
  value: number | null,
  min: number,
  max: number
): ComparisonStatus {
  if (value == null) return "insufficient-data";
  if (value < min) return "below";
  if (value > max) return "above";
  return "within";
}
