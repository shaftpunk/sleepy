import { cleanPersonalSleepSessions, MIN_DAYS_FOR_LOW_CONFIDENCE, PERSONAL_SLEEP_LOOKBACK_DAYS } from "./personalSleepProfile";
import { dayKeyOf, median } from "./time";
import type { SleepSession } from "./types";

export type ActiveSleepClassification = "SHORT_SLEEP_LIKE" | "LONG_SLEEP_LIKE" | "UNCERTAIN";
export type ActiveSleepIdentity = { id: string; startMs: number; sleepTypeRaw: string };
export type PersonalSleepClassification = {
  classification: ActiveSleepClassification;
  reason: "explicit-type" | "personal-pattern" | "insufficient-evidence";
  shortDays: number;
  longDays: number;
  shortSamples: SleepSession[];
};

const MIN_DURATION_GAP_MINUTES = 60;
const MIN_BOUNDARY_RATIO = 1.5;
const MIN_MEDIAN_RATIO = 3;
const NEARBY_START_MINUTES = 90;
const MIN_SUPPORT_RATIO = 2;

function distinctDays(sessions: SleepSession[]): number {
  return new Set(sessions.map(session => dayKeyOf(session.startMs))).size;
}

function explicitType(value: string): "nap" | "night" | null {
  const type = value.trim().toLowerCase();
  return type === "nap" || type === "night" ? type : null;
}

function clockMinutes(time: number): number {
  const date = new Date(time);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function clockDistance(first: number, second: number): number {
  const difference = Math.abs(clockMinutes(first) - clockMinutes(second));
  return Math.min(difference, 1440 - difference);
}

function closestPerDay(sessions: SleepSession[], start: number): SleepSession[] {
  const nearest = new Map<string, SleepSession>();
  for (const session of sessions) {
    if (clockDistance(session.startMs, start) > NEARBY_START_MINUTES) continue;
    const day = dayKeyOf(session.startMs);
    const previous = nearest.get(day);
    if (!previous || clockDistance(session.startMs, start) < clockDistance(previous.startMs, start)) nearest.set(day, session);
  }
  return Array.from(nearest.values());
}

// Infer duration groups only with substantial separation and support across
// multiple days. Clock time never assigns a historical label.
function durationBoundary(history: SleepSession[]): number | null {
  const sorted = [...history].sort((first, second) => first.durationMin - second.durationMin);
  let best: { duration: number; ratio: number } | null = null;
  for (let index = 1; index < sorted.length; index++) {
    const lower = sorted[index - 1].durationMin;
    const upper = sorted[index].durationMin;
    const ratio = upper / lower;
    if (upper - lower < MIN_DURATION_GAP_MINUTES || ratio < MIN_BOUNDARY_RATIO) continue;
    const short = sorted.slice(0, index);
    const long = sorted.slice(index);
    if (distinctDays(short) < MIN_DAYS_FOR_LOW_CONFIDENCE || distinctDays(long) < MIN_DAYS_FOR_LOW_CONFIDENCE) continue;
    if (median(long.map(session => session.durationMin)) < MIN_MEDIAN_RATIO * median(short.map(session => session.durationMin))) continue;
    // Equal ratios keep the lower-duration boundary, deterministically.
    if (!best || ratio > best.ratio) best = { duration: lower, ratio };
  }
  return best?.duration ?? null;
}

export function classifyPersonalSleep(history: SleepSession[], active: ActiveSleepIdentity): PersonalSleepClassification {
  const empty: PersonalSleepClassification = {
    classification: "UNCERTAIN", reason: "insufficient-evidence", shortDays: 0, longDays: 0, shortSamples: [],
  };
  if (!Number.isFinite(active.startMs)) return empty;
  const cutoff = active.startMs - PERSONAL_SLEEP_LOOKBACK_DAYS * 86400000;
  const eligible = history.filter(session => session.id !== active.id &&
    session.startMs >= cutoff && session.endMs <= active.startMs &&
    [session.startMs, session.endMs, session.durationMin].every(Number.isFinite) && session.endMs > session.startMs);
  eligible.sort((first, second) => first.startMs - second.startMs || first.id.localeCompare(second.id));
  const cleaned = cleanPersonalSleepSessions(eligible);
  const boundary = durationBoundary(cleaned);
  const short = cleaned.filter(session => explicitType(session.sleepTypeRaw) === "nap" ||
    (explicitType(session.sleepTypeRaw) === null && boundary !== null && session.durationMin <= boundary));
  const long = cleaned.filter(session => explicitType(session.sleepTypeRaw) === "night" ||
    (explicitType(session.sleepTypeRaw) === null && boundary !== null && session.durationMin > boundary));
  const type = explicitType(active.sleepTypeRaw);
  if (type === "night") return { ...empty, classification: "LONG_SLEEP_LIKE", reason: "explicit-type" };
  if (type === "nap") {
    const days = distinctDays(short);
    if (days >= MIN_DAYS_FOR_LOW_CONFIDENCE) {
      return { ...empty, classification: "SHORT_SLEEP_LIKE", reason: "explicit-type", shortDays: days, shortSamples: short };
    }
    return empty;
  }
  const nearbyShort = closestPerDay(short, active.startMs);
  const nearbyLong = closestPerDay(long, active.startMs);
  const evidence = { ...empty, shortDays: nearbyShort.length, longDays: nearbyLong.length };
  if (nearbyShort.length >= MIN_DAYS_FOR_LOW_CONFIDENCE && nearbyShort.length >= MIN_SUPPORT_RATIO * nearbyLong.length) {
    return { ...evidence, classification: "SHORT_SLEEP_LIKE", reason: "personal-pattern", shortSamples: nearbyShort };
  }
  if (nearbyLong.length >= MIN_DAYS_FOR_LOW_CONFIDENCE && nearbyLong.length >= MIN_SUPPORT_RATIO * nearbyShort.length) {
    return { ...evidence, classification: "LONG_SLEEP_LIKE", reason: "personal-pattern" };
  }
  return evidence;
}
