// General age-based sleep guidance — the starting baseline for the
// age -> personal -> prediction model. Every duration is stored in minutes.
// This is guidance only, never a medical assessment (see the UI disclaimer
// wired through analysis.ageGuide.disclaimer).

export type SleepGuideline = {
  minDays: number;
  maxDays: number;
  minAge: number;
  maxAge: number;
  ageUnit: "months" | "years";
  totalSleepMin: number;
  totalSleepMax: number;
  napsMin: number | null;
  napsMax: number | null;
  wakeWindowMin: number | null;
  wakeWindowMax: number | null;
};

const HOUR = 60;

// Infant ranges retain the original month-by-month guidance. From age one,
// the broad total-sleep bands follow the AASM/CDC ranges: 1-2 years
// (11-14h), 3-5 years (10-13h), and 6-10 years (9-12h). Those sources do
// not define general nap-count or wake-window ranges for older children, so
// those values deliberately remain null rather than presenting invented
// targets. Day cutoffs use the mean Gregorian year and tile with no gaps.
export const SLEEP_GUIDELINES: SleepGuideline[] = [
  { minDays: 0, maxDays: 30, minAge: 0, maxAge: 1, ageUnit: "months", totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 5, napsMax: 8, wakeWindowMin: 30, wakeWindowMax: 60 },
  { minDays: 31, maxDays: 60, minAge: 1, maxAge: 2, ageUnit: "months", totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 4, napsMax: 6, wakeWindowMin: 45, wakeWindowMax: 75 },
  { minDays: 61, maxDays: 90, minAge: 2, maxAge: 3, ageUnit: "months", totalSleepMin: 14 * HOUR, totalSleepMax: 17 * HOUR, napsMin: 4, napsMax: 5, wakeWindowMin: 60, wakeWindowMax: 90 },
  { minDays: 91, maxDays: 120, minAge: 3, maxAge: 4, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 4, napsMax: 5, wakeWindowMin: 60, wakeWindowMax: 120 },
  { minDays: 121, maxDays: 150, minAge: 4, maxAge: 5, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 4, wakeWindowMin: 90, wakeWindowMax: 150 },
  { minDays: 151, maxDays: 180, minAge: 5, maxAge: 6, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 4, wakeWindowMin: 120, wakeWindowMax: 150 },
  { minDays: 181, maxDays: 210, minAge: 6, maxAge: 7, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 3, napsMax: 3, wakeWindowMin: 120, wakeWindowMax: 180 },
  { minDays: 211, maxDays: 240, minAge: 7, maxAge: 8, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 3, wakeWindowMin: 120, wakeWindowMax: 180 },
  { minDays: 241, maxDays: 270, minAge: 8, maxAge: 9, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 3, wakeWindowMin: 150, wakeWindowMax: 210 },
  { minDays: 271, maxDays: 330, minAge: 9, maxAge: 11, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 2, wakeWindowMin: 150, wakeWindowMax: 240 },
  { minDays: 331, maxDays: 365, minAge: 11, maxAge: 12, ageUnit: "months", totalSleepMin: 12 * HOUR, totalSleepMax: 16 * HOUR, napsMin: 2, napsMax: 2, wakeWindowMin: 180, wakeWindowMax: 240 },
  { minDays: 366, maxDays: 1095, minAge: 1, maxAge: 2, ageUnit: "years", totalSleepMin: 11 * HOUR, totalSleepMax: 14 * HOUR, napsMin: null, napsMax: null, wakeWindowMin: null, wakeWindowMax: null },
  { minDays: 1096, maxDays: 2191, minAge: 3, maxAge: 5, ageUnit: "years", totalSleepMin: 10 * HOUR, totalSleepMax: 13 * HOUR, napsMin: null, napsMax: null, wakeWindowMin: null, wakeWindowMax: null },
  { minDays: 2192, maxDays: 4017, minAge: 6, maxAge: 10, ageUnit: "years", totalSleepMin: 9 * HOUR, totalSleepMax: 12 * HOUR, napsMin: null, napsMax: null, wakeWindowMin: null, wakeWindowMax: null },
];

// The last configured day covers children through age 10. Beyond this the
// UI must not silently reuse the last row.
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
