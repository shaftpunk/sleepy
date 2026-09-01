import { getGuidelineForAgeDays, type SleepGuideline } from "./sleepGuidelines";
import {
  MAX_PLAUSIBLE_SESSION_MINUTES,
  MIN_DAYS_FOR_MEDIUM_CONFIDENCE,
  timeOfDayBucket,
  type PersonalSleepProfile,
} from "./personalSleepProfile";
import type { ActiveSleep, SleepSession } from "./types";

export type PredictionConfidence = "low" | "medium" | "high";

export type PredictionBasisId =
  | "age-guideline"
  | "personal-pattern"
  | "time-of-day-pattern"
  | "limited-history";

export type PredictionBasisEntry = {
  id: PredictionBasisId;
  days?: number;
};

export type SleepPrediction = {
  earliestSleepMs: number;
  likelySleepMs: number;
  latestSleepMs: number;
  confidence: PredictionConfidence;
  basis: PredictionBasisEntry[];
  lastWakeMs: number;
  wakeWindowMinutes: number;
};

export type SleepPredictionResult =
  | { status: "sleeping" }
  | { status: "unavailable" }
  | { status: "ready"; prediction: SleepPrediction };

// History-weight tiers (checked from the top down, first match wins): as
// more personal history accumulates, the personal median wake window is
// weighted more heavily than the age-based guideline. Mirrors
// personalSleepProfile.ts's confidence thresholds (MIN_DAYS_FOR_*).
const WEIGHT_TIERS: {
  minDays: number;
  ageWeight: number;
  personalWeight: number;
  confidence: PredictionConfidence;
}[] = [
  { minDays: 14, ageWeight: 0.25, personalWeight: 0.75, confidence: "high" },
  { minDays: 7, ageWeight: 0.4, personalWeight: 0.6, confidence: "medium" },
  { minDays: 3, ageWeight: 0.7, personalWeight: 0.3, confidence: "low" },
  { minDays: 0, ageWeight: 1, personalWeight: 0, confidence: "low" },
];

// A single unusual session must not produce an absurd prediction: the final
// window is always clamped to a multiple of the age guideline's own range,
// or a fixed fallback when no guideline exists at all (e.g. birth date
// unknown or child older than the configured guide).
const NO_GUIDELINE_FALLBACK_MIN_MINUTES = 30;
const NO_GUIDELINE_FALLBACK_MAX_MINUTES = 300;
const GUIDELINE_CLAMP_MIN_RATIO = 0.5;
const GUIDELINE_CLAMP_MAX_RATIO = 1.5;

// Spread used to derive an earliest/latest bound around a single point
// estimate (the age midpoint, or the personal median) when that side of the
// blend has no richer min/max range of its own to draw from.
const POINT_ESTIMATE_SPREAD_RATIO = 0.2;

function weightsForHistoryDays(historyDays: number) {
  return WEIGHT_TIERS.find((tier) => historyDays >= tier.minDays) ?? WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
}

// When only one side of the age/personal blend has a value, use it outright
// instead of treating the missing side as 0 (which would silently drag the
// estimate down).
function blend(
  ageValue: number | null,
  personalValue: number | null,
  ageWeight: number,
  personalWeight: number
): number | null {
  if (ageValue != null && personalValue != null) {
    return ageValue * ageWeight + personalValue * personalWeight;
  }
  return personalValue ?? ageValue;
}

function clampToSafeRange(minutes: number, guideline: SleepGuideline | null): number {
  const min = guideline
    ? guideline.wakeWindowMin * GUIDELINE_CLAMP_MIN_RATIO
    : NO_GUIDELINE_FALLBACK_MIN_MINUTES;

  const max = guideline
    ? guideline.wakeWindowMax * GUIDELINE_CLAMP_MAX_RATIO
    : NO_GUIDELINE_FALLBACK_MAX_MINUTES;

  return Math.min(Math.max(minutes, min), max);
}

// Estimates a window for the next likely sleep, not one exact minute.
// Deliberately deterministic and fully explainable (no ML, no external
// service) — every weight and threshold is a named constant above.
export function computeSleepPrediction(input: {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
  ageDays: number | null;
  profile: PersonalSleepProfile;
}): SleepPredictionResult {
  const { sessions, active, now, ageDays, profile } = input;

  // Currently sleeping: no "next sleep" prediction is meaningful until wake-up.
  if (active) return { status: "sleeping" };

  const completed = sessions.filter(
    (s) => s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES
  );
  if (completed.length === 0) return { status: "unavailable" };

  const lastSession = completed.reduce((latest, s) => (s.endMs > latest.endMs ? s : latest));
  const lastWakeMs = lastSession.endMs;

  if (lastWakeMs > now) return { status: "unavailable" }; // clock-skew guard

  const guidelineLookup = getGuidelineForAgeDays(ageDays);
  const guideline = guidelineLookup.status === "found" ? guidelineLookup.guideline : null;

  const ageWakeWindow = guideline ? (guideline.wakeWindowMin + guideline.wakeWindowMax) / 2 : null;

  const bucket = timeOfDayBucket(new Date(now).getHours());
  const timeOfDayWindow =
    bucket === "morning"
      ? profile.morningWakeWindow
      : bucket === "midday"
        ? profile.middayWakeWindow
        : profile.eveningWakeWindow;

  const personalWakeWindow = timeOfDayWindow ?? profile.medianWakeWindow;

  // Nothing to base a prediction on at all (no birth date/guideline AND no
  // usable personal pattern yet).
  if (ageWakeWindow == null && personalWakeWindow == null) {
    return { status: "unavailable" };
  }

  const tier = weightsForHistoryDays(personalWakeWindow != null ? profile.historyDays : 0);

  // If there's no usable personal wake window at all (regardless of how
  // much history exists — e.g. only naps ever logged, no wake-window data),
  // the prediction is fully age-based and confidence is capped at "low".
  const ageWeight = personalWakeWindow != null ? tier.ageWeight : 1;
  const personalWeight = personalWakeWindow != null ? tier.personalWeight : 0;
  const confidence: PredictionConfidence = personalWakeWindow != null ? tier.confidence : "low";

  const likelyMinutes = blend(ageWakeWindow, personalWakeWindow, ageWeight, personalWeight);
  if (likelyMinutes == null) return { status: "unavailable" };

  const ageEarliest = guideline
    ? guideline.wakeWindowMin
    : ageWakeWindow != null
      ? ageWakeWindow * (1 - POINT_ESTIMATE_SPREAD_RATIO)
      : null;

  const ageLatest = guideline
    ? guideline.wakeWindowMax
    : ageWakeWindow != null
      ? ageWakeWindow * (1 + POINT_ESTIMATE_SPREAD_RATIO)
      : null;

  const personalEarliest =
    personalWakeWindow != null ? personalWakeWindow * (1 - POINT_ESTIMATE_SPREAD_RATIO) : null;

  const personalLatest =
    personalWakeWindow != null ? personalWakeWindow * (1 + POINT_ESTIMATE_SPREAD_RATIO) : null;

  const earliestMinutes =
    blend(ageEarliest, personalEarliest, ageWeight, personalWeight) ?? likelyMinutes;

  const latestMinutes =
    blend(ageLatest, personalLatest, ageWeight, personalWeight) ?? likelyMinutes;

  const clampedLikely = clampToSafeRange(likelyMinutes, guideline);
  const clampedEarliest = Math.min(clampToSafeRange(earliestMinutes, guideline), clampedLikely);
  const clampedLatest = Math.max(clampToSafeRange(latestMinutes, guideline), clampedLikely);

  const basis: PredictionBasisEntry[] = [];

  if (guideline) basis.push({ id: "age-guideline" });

  if (timeOfDayWindow != null) {
    basis.push({ id: "time-of-day-pattern" });
  } else if (profile.medianWakeWindow != null) {
    basis.push({ id: "personal-pattern", days: profile.historyDays });
  }

  if (personalWakeWindow != null && profile.historyDays < MIN_DAYS_FOR_MEDIUM_CONFIDENCE) {
    basis.push({ id: "limited-history", days: profile.historyDays });
  }

  return {
    status: "ready",
    prediction: {
      earliestSleepMs: lastWakeMs + clampedEarliest * 60000,
      likelySleepMs: lastWakeMs + clampedLikely * 60000,
      latestSleepMs: lastWakeMs + clampedLatest * 60000,
      confidence,
      basis,
      lastWakeMs,
      wakeWindowMinutes: Math.round(clampedLikely),
    },
  };
}
