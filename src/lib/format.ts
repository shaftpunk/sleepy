export { median, sameDay, startOfLocalDay as startOfDay, two } from "../analytics/time";

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;

  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}t`;

  return `${hours}t ${rest}m`;
}

export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function relativeDayLabel(ms: number): string {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(
    (new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / dayMs
  );

  if (diffDays === 0) return "I dag";
  if (diffDays === -1) return "I går";

  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ms));
}

export function stars(rate: number | null): string {
  if (rate == null || rate <= 0) return "-";
  return "★".repeat(Math.round(rate));
}
