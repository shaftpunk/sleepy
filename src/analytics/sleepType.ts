import type { ResolvedSleepType, SleepSession } from "./types";

// Trusts a session's own sleep_type if it's already "night"/"nap"; otherwise
// infers from the start hour (19:00-06:59 -> night). Resolved per-row rather
// than as one dataset-wide switch: identical behavior to a literal reading of
// the spec for today's real data (sleep_type is always the literal "sleep",
// so every row falls through to inference), but robust to a future dataset
// where only some rows have sleep_type populated.
export function resolveSleepType(
  session: Pick<SleepSession, "sleepTypeRaw" | "startMs">
): ResolvedSleepType {
  const raw = session.sleepTypeRaw?.trim().toLowerCase();

  if (raw === "night" || raw === "nap") return raw;

  const hour = new Date(session.startMs).getHours();

  return hour >= 19 || hour < 7 ? "night" : "nap";
}
